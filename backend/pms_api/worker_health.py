"""System-only worker heartbeats, without access to hotel operational records."""

from flask import current_app
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from .core_models import Tenant, utcnow
from .extensions import db

KINDS = ("channels", "housekeeping")


class WorkerHeartbeat(db.Model):
    __tablename__ = "worker_heartbeats"
    worker_key = db.Column(db.String(80), primary_key=True)
    kind = db.Column(db.String(20), nullable=False)
    tenant_id = db.Column(db.String(40))
    interval_seconds = db.Column(db.Integer, nullable=False)
    last_seen_at = db.Column(db.DateTime(timezone=True), nullable=False)
    last_success_at = db.Column(db.DateTime(timezone=True))
    __table_args__ = (
        db.CheckConstraint("kind IN ('channels','housekeeping')", name="kind"),
        db.CheckConstraint("interval_seconds BETWEEN 5 AND 86400", name="interval"),
    )


def record_worker_heartbeat(kind, *, tenant_id=None, interval=15, succeeded=False):
    """Persist independently so telemetry never commits the caller's unit of work."""
    if (
        kind not in KINDS
        or type(interval) is not int
        or not 5 <= interval <= 86400
        or (
            tenant_id is not None
            and (not isinstance(tenant_id, str) or not 1 <= len(tenant_id) <= 40)
        )
    ):
        raise ValueError("Invalid worker heartbeat scope or interval")
    values = {
        "worker_key": f"{kind}:tenant:{tenant_id}" if tenant_id else f"{kind}:all",
        "kind": kind,
        "tenant_id": tenant_id,
        "interval_seconds": interval,
        "last_seen_at": utcnow(),
    }
    if succeeded:
        values["last_success_at"] = values["last_seen_at"]
    statement = insert(WorkerHeartbeat).values(**values)
    try:
        with db.engine.begin() as connection:
            connection.execute(text("SELECT set_config('app.is_system','true',true)"))
            connection.execute(
                statement.on_conflict_do_update(
                    index_elements=[WorkerHeartbeat.worker_key],
                    set_={key: value for key, value in values.items() if key != "worker_key"},
                )
            )
        return True
    except SQLAlchemyError:
        current_app.logger.warning("worker_heartbeat_unavailable kind=%s", kind)
        return False


def _age(now, when):
    return max(0, int((now - when).total_seconds())) if when else None


def operations_status():
    now = utcnow()
    hotel_tenants = set(db.session.scalars(select(Tenant.id).where(Tenant.status == "active")))
    workers = {}
    for kind in KINDS:
        rows = list(db.session.scalars(select(WorkerHeartbeat).where(WorkerHeartbeat.kind == kind)))
        # Channel enablement is private hotel configuration. SaaS telemetry describes
        # only workers which have reported, without consulting hotel connections.
        required = (
            hotel_tenants
            if kind == "housekeeping"
            else {row.tenant_id for row in rows if row.tenant_id in hotel_tenants}
        )
        instances, covered = [], set()
        for row in rows:
            age = _age(now, row.last_seen_at)
            stale_after = max(120, row.interval_seconds * 3)
            fresh = age <= stale_after
            if fresh:
                covered.update(required if row.tenant_id is None else {row.tenant_id})
            instances.append(
                {
                    "tenantId": row.tenant_id,
                    "status": "ok" if fresh else "stale",
                    "lastSeenAt": row.last_seen_at.isoformat(),
                    "ageSeconds": age,
                    "lastSuccessAt": row.last_success_at.isoformat()
                    if row.last_success_at
                    else None,
                    "lastSuccessAgeSeconds": _age(now, row.last_success_at),
                    "staleAfterSeconds": stale_after,
                }
            )
        missing = len(required - covered)
        status = (
            "missing"
            if not instances
            else "stale"
            if all(row["status"] == "stale" for row in instances)
            else "partial"
            if missing
            else "ok"
        )
        workers[kind] = {
            "status": status,
            "required": bool(required),
            "uncoveredTenantCount": missing,
            "instances": instances,
        }
    return {"checkedAt": now.isoformat(), "workers": workers}
