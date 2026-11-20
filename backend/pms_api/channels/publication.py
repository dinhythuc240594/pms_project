"""Serialize publishers while releasing the hotel mutation lock during ARI I/O."""

from contextlib import contextmanager
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from hashlib import sha256

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from pms_api.ports import runtime

from ..core_models import User
from ..extensions import db
from ..security import set_context
from ..subscriptions import lock_tenant
from .client import ProviderError
from .models import ChannelConnection, ChannelJob


@contextmanager
def publisher_lock(tenant_id):
    # A dedicated connection owns this session lock across business commits.
    key = int.from_bytes(sha256(("loha-channel:" + tenant_id).encode()).digest()[:8], signed=True)
    with db.engine.connect() as owner:
        acquired = owner.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": key})
        try:
            yield acquired
        finally:
            if acquired:
                try:
                    released = owner.scalar(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
                    if not released:
                        owner.invalidate()
                        runtime().logger.warning("channel_publisher_lock_lost")
                except SQLAlchemyError:
                    owner.invalidate()
                    runtime().logger.warning("channel_publisher_unlock_unavailable")


def recover_publications(tenant_id):
    """Owning the publisher lock proves any committed processing claim is abandoned."""
    from .service import utcnow

    set_context(tenant_id=tenant_id)
    lock_tenant(tenant_id)
    stranded = list(
        db.session.scalars(
            select(ChannelJob).where(
                ChannelJob.tenant_id == tenant_id,
                ChannelJob.kind.in_(["push_ari", "load_bookings"]),
                ChannelJob.status == "processing",
            )
        )
    )
    for job in stranded:
        loading = job.kind == "load_bookings"
        job.error_code = "channel_load_interrupted" if loading else "channel_publish_interrupted"
        job.status = "failed" if loading or job.attempts >= 5 else "queued"
        job.completed_at = utcnow() if job.status == "failed" else None
    if stranded:
        db.session.commit()
    else:
        db.session.rollback()


def target_identity(connection):
    return (
        connection.environment,
        connection.property_id,
        connection.credential_ref,
        connection.secrets_ciphertext,
        connection.actor_id,
        connection.verified_at,
        connection.inventory_revision,
        connection.inventory_reconciled_at,
    )


class CachedCatalog:
    def __init__(self, values):
        self.values = values

    def catalog(self, resource, property_id):
        return self.values[resource]


def stage_ari(client, availability, restrictions):
    # Close room inventory first: derived plans need not inherit parent stop-sell.
    client.push_availability([{**row, "availability": 0} for row in availability])
    dates = [row["date"] for row in restrictions]
    closed = client.availability(restrictions[0]["property_id"], min(dates), max(dates))
    for row in availability:
        room = closed.get(row["room_type_id"], {}) if isinstance(closed, dict) else {}
        count = room.get(row["date"]) if isinstance(room, dict) else None
        if type(count) is not int or count != 0:
            raise ProviderError("channel_inventory_unverified", retryable=True)
    client.push_restrictions(restrictions)
    stored = client.restrictions(restrictions[0]["property_id"], min(dates), max(dates))
    for expected in restrictions:
        plan = stored.get(expected["rate_plan_id"], {}) if isinstance(stored, dict) else {}
        actual = plan.get(expected["date"], {}) if isinstance(plan, dict) else {}
        try:
            verified = (
                isinstance(actual, dict)
                and actual.get("stop_sell") is expected["stop_sell"]
                and (
                    "rate" not in expected
                    or (
                        not isinstance(actual.get("rate"), bool)
                        and Decimal(str(actual.get("rate"))).is_finite()
                        and Decimal(str(actual.get("rate"))) == Decimal(expected["rate"])
                    )
                )
            )
        except InvalidOperation, ValueError, TypeError:
            verified = False
        if not verified:
            raise ProviderError("channel_rate_unverified", retryable=True)


def publish_ari(tenant_id, job, connection, client):
    from .onboarding import require_reconciled
    from .service import (
        ari_snapshot,
        authorize_actor,
        booking_inventory_hold,
        prepare_publication,
        utcnow,
    )

    require_reconciled(connection)
    job_id, actor_id = job.id, job.actor_id
    identity, property_id, details = (
        target_identity(connection),
        connection.property_id,
        dict(job.payload),
    )
    job.status, job.attempts = "processing", job.attempts + 1
    attempt = job.attempts
    # Reserve pacing before releasing the lock, including process/DB failures.
    connection.ari_available_at = utcnow() + timedelta(seconds=60)
    db.session.commit()

    catalogs = CachedCatalog(
        {
            resource: client.catalog(resource, property_id)
            for resource in ("room_types", "rate_plans")
        }
    )

    set_context(tenant_id=tenant_id)
    runtime().state.tenant = lock_tenant(tenant_id)
    authorize_actor(tenant_id, actor_id)
    connection = db.session.scalar(
        select(ChannelConnection).where(ChannelConnection.tenant_id == tenant_id)
    )
    if not connection or not connection.active or target_identity(connection) != identity:
        raise ProviderError("channel_configuration_changed", retryable=True)
    job = db.session.get(ChannelJob, job_id)
    if job.status != "processing" or job.attempts != attempt:
        raise ProviderError("channel_job_changed")
    availability, restrictions = ari_snapshot(tenant_id, connection, catalogs, details)
    prepare_publication(tenant_id, job, connection, catalogs, validate=False)
    connection.ari_available_at = utcnow() + timedelta(seconds=60)
    db.session.commit()

    stage_ari(client, availability, restrictions)
    catalogs = CachedCatalog(
        {
            resource: client.catalog(resource, property_id)
            for resource in ("room_types", "rate_plans")
        }
    )

    set_context(tenant_id=tenant_id)
    runtime().state.tenant = lock_tenant(tenant_id)
    authorize_actor(tenant_id, actor_id)
    connection = db.session.scalar(
        select(ChannelConnection).where(ChannelConnection.tenant_id == tenant_id)
    )
    job = db.session.get(ChannelJob, job_id)
    if (
        not connection
        or not connection.active
        or target_identity(connection) != identity
        or job.status != "processing"
        or job.attempts != attempt
    ):
        raise ProviderError("channel_configuration_changed", retryable=True)
    if ari_snapshot(tenant_id, connection, catalogs, details) != (availability, restrictions):
        raise ProviderError("channel_snapshot_changed", retryable=True)
    if db.session.scalar(select(booking_inventory_hold(tenant_id))):
        raise ProviderError("channel_bookings_pending", retryable=True)
    # Keep the mutation lock for the final open so a booking cannot overtake it.
    if any(row["availability"] > 0 for row in availability):
        client.push_availability(availability)
    runtime().state.user = db.session.get(User, actor_id)
    return job, connection
