"""Durable bounded work; imports and ACK jobs commit before any remote ACK.

Publishers serialize per hotel; ARI network calls release the tenant mutation
lock after persisting a claim, publication footprint and cooldown. New hotel
writes enqueue a fresh job while the previous snapshot is in flight.
"""

from collections import defaultdict
from datetime import date, timedelta
from urllib.parse import quote

from flask import current_app, g
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import SQLAlchemyError

from ..bookings.models import ReservationRoom
from ..catalog.models import DailyRate, PhysicalRoom, RoomBlock, RoomType
from ..catalog.routes import date_range, money_value
from ..core_models import TenantUser, User, utcnow
from ..extensions import db
from ..pricing.engine import business_date
from ..security import GLOBAL_ROLES, ApiError, audit, set_context
from ..subscriptions import enforce_entitlements, entitlement, feature_enabled, lock_tenant
from .client import ChannexClient, ProviderError, remote_id
from .credentials import load_credentials
from .models import (
    ChannelBookingReview,
    ChannelConnection,
    ChannelJob,
    ChannelMapping,
    ChannelRevision,
)

ARI_KINDS = ("push_ari", "pause_mapping")
ACK_OUTCOMES = ("imported", "stale", "cancelled")
DEFERRED = object()


def window(start, end):
    days = date_range(start, end)
    if len(days) > 31:
        raise ApiError(
            422, "channel_window_too_large", "Đồng bộ giá/phòng tối đa 31 ngày mỗi tác vụ."
        )
    return days


def queue_job(tenant_id, actor_id, kind, details, dedupe=None, *, retry_failed=False):
    existing = None
    if dedupe:
        existing = db.session.scalar(
            select(ChannelJob).where(
                ChannelJob.tenant_id == tenant_id, ChannelJob.dedupe_key == dedupe
            )
        )
        if existing and not (retry_failed and existing.status == "failed"):
            return existing
    if kind in {"push_ari", "setup_webhook"} or (
        kind == "pull_bookings" and not details.get("revisionId")
    ):
        job_payload = (
            ChannelJob.payload.op("-")("priority") if kind == "push_ari" else ChannelJob.payload
        )
        existing = db.session.scalar(
            select(ChannelJob).where(
                ChannelJob.tenant_id == tenant_id,
                ChannelJob.kind == kind,
                ChannelJob.status == "queued",
                job_payload == details,
            )
        )
        if existing:
            # Coalescing with the daily baseline must retain an inventory change's priority.
            if kind == "push_ari" and (not dedupe or existing.dedupe_key is None):
                existing.payload = {**existing.payload, "priority": "change"}
            if dedupe and existing.dedupe_key is None:
                existing.dedupe_key = dedupe
            return existing
    pending = db.session.scalar(
        select(func.count())
        .select_from(ChannelJob)
        .where(ChannelJob.tenant_id == tenant_id, ChannelJob.status.in_(["queued", "processing"]))
    )
    if pending >= 500:
        raise ApiError(
            409, "channel_queue_full", "Hàng đợi đồng bộ đã đầy; cần xử lý các tác vụ đang chờ."
        )
    if existing is not None:
        existing.status = "queued"
        existing.error_code = existing.completed_at = None
        existing.available_at, existing.attempts, existing.actor_id = utcnow(), 0, actor_id
        audit("channel.retried", "channel_job", existing.id)
        return existing
    row = ChannelJob(
        tenant_id=tenant_id, actor_id=actor_id, kind=kind, payload=details, dedupe_key=dedupe
    )
    db.session.add(row)
    db.session.flush()
    return row


def authorize_actor(tenant_id, actor_id, *, operation=None):
    user = db.session.get(User, actor_id)
    membership = db.session.scalar(
        select(TenantUser).where(
            TenantUser.tenant_id == tenant_id,
            TenantUser.user_id == actor_id,
            TenantUser.active.is_(True),
            TenantUser.role == "HOTEL_OWNER",
        )
    )
    if not user or not user.active or (not membership and user.global_role not in GLOBAL_ROLES):
        raise ApiError(403, "channel_actor_revoked", "Người cấu hình kênh không còn quyền đồng bộ.")
    g.user, g.role = user, "HOTEL_OWNER"
    # System support jobs use the existing background scope for this hotel only.
    # HTTP requests always keep their actor and use the narrower OTA policies.
    set_context("" if user.global_role in GLOBAL_ROLES else user.id, tenant_id)
    if g.tenant.status != "active":
        raise ApiError(403, "tenant_suspended", "Khách sạn đang bị tạm ngưng.")
    enforce_entitlements("channels.write", operation=operation)


def enqueue_audit(entry):
    """An outbox job is part of the same transaction as the initiating mutation."""
    if not entry.tenant_id:
        return
    reservation_event = entry.event in {
        "reservation.created",
        "reservation.updated",
        "reservation.status",
    }
    bounded = reservation_event or entry.event in {"rates.saved", "room.blocked", "room.unblocked"}
    rolling = entry.event in {
        "room.maintenance",
        "room.clean",
        "room.dirty",
        "room.inspection",
        "channel.mapped",
        "channel.configured",
    } or (
        entry.event in {"master.saved", "master.toggled"}
        and entry.entity_type in {"rooms", "roomTypes"}
    )
    if not bounded and not rolling:
        return
    connection = db.session.scalar(
        select(ChannelConnection).where(
            ChannelConnection.tenant_id == entry.tenant_id, ChannelConnection.active.is_(True)
        )
    )
    if not connection or not feature_enabled("OTA_SYNC", for_write=True):
        return
    if not db.session.scalar(
        select(ChannelMapping.id)
        .where(ChannelMapping.tenant_id == entry.tenant_id, ChannelMapping.active.is_(True))
        .limit(1)
    ):
        return
    today = business_date(g.tenant)
    ranges = []
    details = entry.details or {}
    for start_key, end_key in (
        ("start", "end"),
        ("checkIn", "checkOut"),
        ("oldCheckIn", "oldCheckOut"),
    ):
        if details.get(start_key) and details.get(end_key):
            ranges.append(
                (date.fromisoformat(details[start_key]), date.fromisoformat(details[end_key]))
            )
    if rolling or not ranges:
        ranges.append((today, today + timedelta(days=366)))
    for first, last in ranges:
        first = max(today, first)
        if first >= last:
            continue
        if connection.inventory_reconciled_at is None:
            connection.pending_ari_start = min(connection.pending_ari_start or first, first)
            connection.pending_ari_end = max(connection.pending_ari_end or last, last)
            connection.pending_ari_since = connection.pending_ari_since or utcnow()
            continue
        while first < last:
            end = min(last, first + timedelta(days=31))
            try:
                queue_job(
                    entry.tenant_id,
                    connection.actor_id,
                    "push_ari",
                    {"start": first.isoformat(), "end": end.isoformat()},
                )
            except ApiError as error:
                if error.code != "channel_queue_full":
                    raise
                # Keep inventory intent in the booking transaction even under backpressure.
                connection.pending_ari_start = min(connection.pending_ari_start or first, first)
                connection.pending_ari_end = max(connection.pending_ari_end or last, last)
                connection.pending_ari_since = connection.pending_ari_since or utcnow()
                break
            first = end


def drain_pending_ari(connection):
    if connection.inventory_reconciled_at is None:
        return
    first, last = connection.pending_ari_start, connection.pending_ari_end
    if first is None:
        return
    first = max(first, business_date(g.tenant))
    while first < last:
        end = min(last, first + timedelta(days=31))
        try:
            queue_job(
                connection.tenant_id,
                connection.actor_id,
                "push_ari",
                {
                    "start": first.isoformat(),
                    "end": end.isoformat(),
                },
            )
        except ApiError as error:
            if error.code != "channel_queue_full":
                raise
            break
        first = end
    if first >= last:
        connection.pending_ari_start = connection.pending_ari_end = None
        connection.pending_ari_since = None
    else:
        connection.pending_ari_start = first


def _relationship(entity, key):
    try:
        return entity["relationships"][key]["data"]["id"]
    except (KeyError, TypeError):
        raise ProviderError("channel_mapping_invalid") from None


def _catalog_index(entities):
    if not isinstance(entities, list) or any(
        not isinstance(e, dict) or not isinstance(e.get("attributes"), dict) for e in entities
    ):
        raise ProviderError("provider_invalid_response")
    result = {remote_id(e.get("id")): e for e in entities}
    if len(result) != len(entities):
        raise ProviderError("provider_invalid_response")
    return result


def supported_rate_plan(attributes, currency):
    return (
        attributes.get("sell_mode") == "per_room"
        and attributes.get("rate_mode") == "manual"
        and attributes.get("currency") == currency
        and attributes.get("inherit_rate", False) is False
    )


def catalog_options(connection, client, currency, *, remote_view=False):
    return catalog_values(
        client.catalog("room_types", connection.property_id),
        client.catalog("rate_plans", connection.property_id),
        connection.property_id,
        currency,
        remote_view=remote_view,
    )


def rate_defaults(attributes):
    options = attributes.get("options")
    if options is None:
        return None, False
    if not isinstance(options, list) or len(options) > 50:
        raise ProviderError("provider_invalid_response")
    primary, seen = [], set()
    for option in options:
        if (
            not isinstance(option, dict)
            or type(option.get("occupancy")) is not int
            or not 1 <= option["occupancy"] <= 50
            or not isinstance(option.get("is_primary"), bool)
            or option["occupancy"] in seen
        ):
            raise ProviderError("provider_invalid_response")
        seen.add(option["occupancy"])
        if option["is_primary"]:
            primary.append(option)
    if options and len(primary) != 1:
        raise ProviderError("provider_invalid_response")
    value = primary[0].get("rate") if primary else None
    if value is not None:
        if (
            not isinstance(value, (str, int, float))
            or isinstance(value, bool)
            or len(str(value)) > 50
        ):
            raise ProviderError("provider_invalid_response")
        try:
            value = format(money_value(value), ".4f")
        except ApiError:
            raise ProviderError("provider_invalid_response") from None
    editable = (
        len(options) == 1
        and supported_rate_plan(attributes, attributes.get("currency"))
        and attributes.get("ui_read_only", False) is False
        and options[0].get("derived_option") in (None, {})
    )
    return value, editable


def catalog_values(room_entities, rate_entities, property_id, currency, *, remote_view=False):
    rooms = _catalog_index(room_entities)
    rates = _catalog_index(rate_entities)
    room_types, rate_plans = [], []
    for index, output in ((rooms, room_types), (rates, rate_plans)):
        for identifier, entity in index.items():
            attributes = entity["attributes"]
            title = attributes.get("title")
            if (
                not isinstance(title, str)
                or not title.strip()
                or len(title) > 500
                or _relationship(entity, "property") != property_id
            ):
                raise ProviderError("provider_invalid_response")
            value = {"id": identifier, "name": title}
            if remote_view:
                expected_type = "room_type" if index is rooms else "rate_plan"
                if entity.get("type") != expected_type:
                    raise ProviderError("provider_invalid_response")
                if index is rooms:
                    for source, target in (
                        ("count_of_rooms", "countOfRooms"),
                        ("occ_adults", "adults"),
                        ("occ_children", "children"),
                        ("occ_infants", "infants"),
                    ):
                        count = attributes.get(source)
                        if count is not None and (
                            type(count) is not int or not 0 <= count <= 2**31 - 1
                        ):
                            raise ProviderError("provider_invalid_response")
                        value[target] = count
            if index is rates:
                room_type_id = remote_id(_relationship(entity, "room_type"))
                rate_currency = attributes.get("currency")
                if (
                    room_type_id not in rooms
                    or not isinstance(rate_currency, str)
                    or len(rate_currency) != 3
                    or not rate_currency.isascii()
                    or not rate_currency.isalpha()
                    or not rate_currency.isupper()
                    or not isinstance(attributes.get("sell_mode"), str)
                    or not isinstance(attributes.get("rate_mode"), str)
                    or not isinstance(attributes.get("inherit_rate", False), bool)
                ):
                    raise ProviderError("provider_invalid_response")
                value.update(
                    roomTypeId=room_type_id,
                    currency=rate_currency,
                    supported=supported_rate_plan(attributes, currency),
                )
                if remote_view:
                    for source, target in (("sell_mode", "sellMode"), ("rate_mode", "rateMode")):
                        mode = attributes[source]
                        if not mode.strip() or len(mode) > 100:
                            raise ProviderError("provider_invalid_response")
                        value[target] = mode
                    value["rate"], value["editable"] = rate_defaults(attributes)
            output.append(value)
    return {"roomTypes": room_types, "ratePlans": rate_plans}


def publication_ranges(ranges):
    """Merge exclusive date windows; keep future windows outside the rolling baseline."""
    merged = []
    for start, end in sorted(
        (date.fromisoformat(r["start"]), date.fromisoformat(r["end"])) for r in ranges
    ):
        if end <= start:
            raise ProviderError("channel_mapping_invalid")
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return [{"start": start.isoformat(), "end": end.isoformat()} for start, end in merged]


def prepare_publication(tenant_id, job, connection, client, *, validate=True):
    if job.kind != "push_ari":
        return False
    mappings = list(
        db.session.scalars(
            select(ChannelMapping).where(
                ChannelMapping.tenant_id == tenant_id, ChannelMapping.active.is_(True)
            )
        )
    )
    if not mappings:
        return False
    recorded = {
        mapping.id: publication_ranges(
            [
                *mapping.published_ranges,
                {"start": job.payload["start"], "end": job.payload["end"]},
            ]
        )
        for mapping in mappings
    }
    if all(
        mapping.used_at is not None and mapping.published_ranges == recorded[mapping.id]
        for mapping in mappings
    ):
        return False
    if validate:
        ari_snapshot(tenant_id, connection, client, job.payload)
    for mapping in mappings:
        mapping.used_at = mapping.used_at or utcnow()
        mapping.published_ranges = recorded[mapping.id]
    return True


def pause_mapping(tenant_id, job, connection, client):
    mapping = db.session.scalar(
        select(ChannelMapping).where(
            ChannelMapping.tenant_id == tenant_id, ChannelMapping.id == job.payload.get("mappingId")
        )
    )
    if not mapping or not mapping.pause_requested:
        raise ProviderError("channel_mapping_pause_pending")
    rooms = _catalog_index(client.catalog("room_types", connection.property_id))
    rates = _catalog_index(client.catalog("rate_plans", connection.property_id))
    room, rate = rooms.get(mapping.remote_room_type_id), rates.get(mapping.remote_rate_plan_id)
    if (
        not room
        or not rate
        or _relationship(room, "property") != connection.property_id
        or _relationship(rate, "property") != connection.property_id
        or _relationship(rate, "room_type") != mapping.remote_room_type_id
    ):
        raise ProviderError("channel_mapping_invalid")
    today = business_date(g.tenant)
    ranges = publication_ranges(
        [
            *mapping.published_ranges,
            {"start": today.isoformat(), "end": (today + timedelta(days=366)).isoformat()},
        ]
    )
    values = [
        {
            "property_id": connection.property_id,
            "date_from": max(today, date.fromisoformat(r["start"])).isoformat(),
            "date_to": (date.fromisoformat(r["end"]) - timedelta(days=1)).isoformat(),
        }
        for r in ranges
        if date.fromisoformat(r["end"]) > today
    ]
    client.push_availability(
        [
            {**value, "room_type_id": mapping.remote_room_type_id, "availability": 0}
            for value in values
        ]
    )
    client.push_restrictions(
        [
            {**value, "rate_plan_id": mapping.remote_rate_plan_id, "stop_sell": True}
            for value in values
        ]
    )
    mapping.active, mapping.pause_requested = False, False
    audit("channel.paused", "room_type", mapping.room_type_id)


def validate_mapping_target(connection, client, room_id, rate_id, inbound_ids, currency):
    rooms = _catalog_index(client.catalog("room_types", connection.property_id))
    rates = _catalog_index(client.catalog("rate_plans", connection.property_id))
    if room_id not in rooms or _relationship(rooms[room_id], "property") != connection.property_id:
        raise ProviderError("channel_mapping_invalid")
    for identifier in [rate_id, *inbound_ids]:
        rate = rates.get(identifier)
        if (
            not rate
            or _relationship(rate, "property") != connection.property_id
            or _relationship(rate, "room_type") != room_id
            or rate["attributes"].get("currency") != currency
        ):
            raise ProviderError("channel_mapping_invalid")
        if identifier == rate_id and not supported_rate_plan(rate["attributes"], currency):
            raise ProviderError("channel_rate_plan_unsupported")


def booking_inventory_hold(tenant_id):
    """An unimported OTA revision can consume stock outside the locally recorded stay."""
    return or_(
        select(ChannelBookingReview.id)
        .where(
            ChannelBookingReview.tenant_id == tenant_id,
            ChannelBookingReview.resolved_at.is_(None),
        )
        .exists(),
        select(ChannelJob.id)
        .where(
            ChannelJob.tenant_id == tenant_id,
            ChannelJob.kind == "pull_bookings",
            ChannelJob.status.in_(["queued", "processing", "failed"]),
            ChannelJob.payload["revisionId"].astext.is_not(None),
            ~select(ChannelRevision.id)
            .where(
                ChannelRevision.tenant_id == tenant_id,
                ChannelRevision.revision_id == ChannelJob.payload["revisionId"].astext,
            )
            .correlate(ChannelJob)
            .exists(),
        )
        .exists(),
    )


def ari_snapshot(tenant_id, connection, client, details):
    from .onboarding import require_reconciled

    require_reconciled(connection)
    days = window(details.get("start"), details.get("end"))
    targets = list(
        db.session.execute(
            select(ChannelMapping, booking_inventory_hold(tenant_id))
            .where(ChannelMapping.tenant_id == tenant_id, ChannelMapping.active.is_(True))
            .order_by(ChannelMapping.id)
        )
    )
    mappings = [mapping for mapping, _hold in targets]
    inventory_hold = any(hold for _mapping, hold in targets)
    if not mappings or len(mappings) > 50:
        raise ProviderError("channel_mapping_required")
    # Validate property ownership and per-room manual rate currency before sending
    # amounts. A UUID by itself is not sufficient evidence of a correct mapping.
    remote_rooms = _catalog_index(client.catalog("room_types", connection.property_id))
    remote_rates = _catalog_index(client.catalog("rate_plans", connection.property_id))
    availability, restrictions = [], []
    currency = (g.tenant.settings or {}).get("currency", "VND")
    type_ids = {mapping.room_type_id for mapping in mappings}
    room_types = {
        r.id: r
        for r in db.session.scalars(
            select(RoomType).where(
                RoomType.tenant_id == tenant_id,
                RoomType.id.in_(type_ids),
            )
        )
    }
    overrides = {
        (r.room_type_id, r.date): r
        for r in db.session.scalars(
            select(DailyRate).where(
                DailyRate.tenant_id == tenant_id,
                DailyRate.room_type_id.in_(type_ids),
                DailyRate.date.in_(days),
            )
        )
    }
    rooms_by_type = defaultdict(set)
    for room_id, type_id in db.session.execute(
        select(PhysicalRoom.id, PhysicalRoom.room_type_id).where(
            PhysicalRoom.tenant_id == tenant_id,
            PhysicalRoom.room_type_id.in_(type_ids),
            PhysicalRoom.active.is_(True),
            PhysicalRoom.condition != "maintenance",
        )
    ):
        rooms_by_type[type_id].add(room_id)
    blocked, booked = defaultdict(set), defaultdict(int)
    for block in db.session.scalars(
        select(RoomBlock).where(
            RoomBlock.tenant_id == tenant_id,
            RoomBlock.start_date <= days[-1],
            RoomBlock.end_date > days[0],
        )
    ):
        for day in days:
            if block.start_date <= day < block.end_date:
                blocked[day].add(block.room_id)
    for type_id, start, end in db.session.execute(
        select(
            ReservationRoom.room_type_id,
            ReservationRoom.check_in,
            ReservationRoom.check_out,
        ).where(
            ReservationRoom.tenant_id == tenant_id,
            ReservationRoom.room_type_id.in_(type_ids),
            ReservationRoom.active.is_(True),
            ReservationRoom.check_in <= days[-1],
            ReservationRoom.check_out > days[0],
        )
    ):
        for day in days:
            if start <= day < end:
                booked[type_id, day] += 1
    for mapping in mappings:
        remote_room, remote_rate = (
            remote_rooms.get(mapping.remote_room_type_id),
            remote_rates.get(mapping.remote_rate_plan_id),
        )
        if (
            not remote_room
            or not remote_rate
            or _relationship(remote_room, "property") != connection.property_id
            or _relationship(remote_rate, "property") != connection.property_id
            or _relationship(remote_rate, "room_type") != mapping.remote_room_type_id
        ):
            raise ProviderError("channel_mapping_invalid")
        attributes = remote_rate.get("attributes", {})
        if not supported_rate_plan(attributes, currency):
            raise ProviderError("channel_rate_plan_unsupported")
        room_type = room_types[mapping.room_type_id]
        for day in days:
            capacity = len(rooms_by_type[room_type.id] - blocked[day]) if room_type.active else 0
            available = capacity - booked[room_type.id, day]
            if available < 0 and not inventory_hold:
                raise ProviderError("channel_inventory_inconsistent")
            override = overrides.get((room_type.id, day))
            stop_sell = (
                inventory_hold
                or mapping.pause_requested
                or not room_type.active
                or bool(override and override.stop_sell)
            )
            price = override.price if override else room_type.base_price
            if price <= 0 and not stop_sell:
                raise ProviderError("channel_rate_invalid")
            availability.append(
                {
                    "property_id": connection.property_id,
                    "room_type_id": mapping.remote_room_type_id,
                    "date": day.isoformat(),
                    "availability": 0 if stop_sell else available,
                }
            )
            restriction = {
                "property_id": connection.property_id,
                "rate_plan_id": mapping.remote_rate_plan_id,
                "date": day.isoformat(),
                "stop_sell": stop_sell,
            }
            if price > 0:
                restriction["rate"] = str(price)
            restrictions.append(restriction)
    return availability, restrictions


def verify_cancellation(client, entity, property_id):
    """An all-properties key is not evidence that a booking belongs to this hotel."""
    from .importer import invalid, revision_identity

    try:
        requested = revision_identity(entity, property_id)
        booking = client.booking(requested["bookingId"])
        if (
            not isinstance(booking, dict)
            or booking.get("id") != requested["bookingId"]
            or booking.get("type") != "booking"
            or not isinstance(booking.get("attributes"), dict)
            or booking["attributes"].get("status") != "cancelled"
            or booking["attributes"].get("property_id", property_id) != property_id
        ):
            invalid("channel_cancellation_unverified")
        latest_id = remote_id(booking["attributes"].get("revision_id"))
        latest = revision_identity(
            entity if latest_id == requested["id"] else client.revision(latest_id), property_id
        )
        if (
            latest["id"] != latest_id
            or latest["bookingId"] != requested["bookingId"]
            or latest["status"] != "cancelled"
            or latest["insertedAt"] < requested["insertedAt"]
        ):
            invalid("channel_cancellation_unverified")
        return latest
    except ProviderError as error:
        if error.retryable:
            raise
        invalid("channel_cancellation_unverified")
    except ApiError:
        invalid("channel_cancellation_unverified")


def _run_job(tenant_id, job, connection, client):
    if job.kind == "load_bookings":
        from .onboarding import validate_load

        validate_load(client, connection, job.payload.get("channelId"), job.payload.get("target"))
        client.load_future_reservations(job.payload["channelId"])
    elif job.kind == "pause_mapping":
        pause_mapping(tenant_id, job, connection, client)
    elif job.kind == "setup_webhook":
        base_url = current_app.config.get("CHANNEX_WEBHOOK_BASE_URL")
        if not base_url:
            raise ProviderError("webhook_registration_unavailable")
        callback_url = base_url + "/api/channex/webhooks/" + quote(tenant_id, safe="")
        connection.webhook_id = client.setup_webhook(
            connection.property_id, callback_url, load_credentials(connection)["webhookSecret"]
        )
    elif job.kind == "push_ari":
        if not db.session.scalar(
            select(ChannelMapping.id)
            .where(ChannelMapping.tenant_id == tenant_id, ChannelMapping.active.is_(True))
            .limit(1)
        ):
            return  # Jobs queued before the last mapping paused must not reopen its inventory.
        availability, restrictions = ari_snapshot(tenant_id, connection, client, job.payload)
        from .publication import stage_ari

        stage_ari(client, availability, restrictions)
        if db.session.scalar(select(booking_inventory_hold(tenant_id))):
            raise ProviderError("channel_bookings_pending", retryable=True)
        if any(row["availability"] > 0 for row in availability):
            client.push_availability(availability)
    elif job.kind == "pull_bookings":
        from .importer import import_revision

        revision_id = job.payload.get("revisionId")
        if revision_id:
            receipt = db.session.scalar(
                select(ChannelRevision).where(
                    ChannelRevision.tenant_id == tenant_id,
                    ChannelRevision.revision_id == revision_id,
                )
            )
            review = db.session.scalar(
                select(ChannelBookingReview).where(
                    ChannelBookingReview.tenant_id == tenant_id,
                    ChannelBookingReview.revision_id == revision_id,
                    ChannelBookingReview.resolved_at.is_(None),
                )
            )
            first_review = review is None
            retry_review = bool(job.payload.get("retryReview"))
            if receipt is None and (review is None or retry_review):
                entity = client.revision(revision_id)
                if not isinstance(entity, dict) or entity.get("id") != revision_id:
                    raise ProviderError("provider_invalid_response")
                receipt = import_revision(
                    tenant_id,
                    entity,
                    connection.property_id,
                    retry_review=retry_review,
                    verify_cancellation=lambda: verify_cancellation(
                        client, entity, connection.property_id
                    ),
                )
            elif receipt is None:
                receipt = review
            if receipt.outcome in ACK_OUTCOMES:
                previous_jobs = db.session.scalars(
                    select(ChannelJob)
                    .join(
                        ChannelRevision,
                        (ChannelRevision.tenant_id == ChannelJob.tenant_id)
                        & (ChannelRevision.revision_id == ChannelJob.payload["revisionId"].astext),
                    )
                    .where(
                        ChannelJob.tenant_id == tenant_id,
                        ChannelJob.kind == "pull_bookings",
                        ChannelJob.status == "needs_review",
                        ChannelRevision.booking_id == receipt.booking_id,
                        ChannelRevision.outcome.in_(ACK_OUTCOMES),
                    )
                ).all()
                for previous in previous_jobs:
                    previous.status, previous.error_code, previous.completed_at = (
                        "succeeded",
                        None,
                        utcnow(),
                    )
                # The receipt and replacement ACK atomically reuse this import's queue slot.
                job.status = "succeeded"
                queue_job(
                    tenant_id,
                    job.actor_id,
                    "ack_revision",
                    {"revisionId": receipt.revision_id},
                    "ack:" + receipt.revision_id,
                )
                for previous in previous_jobs:
                    previous_revision = previous.payload["revisionId"]
                    try:
                        queue_job(
                            tenant_id,
                            job.actor_id,
                            "ack_revision",
                            {"revisionId": previous_revision},
                            "ack:" + previous_revision,
                        )
                    except ApiError as error:
                        if error.code != "channel_queue_full":
                            raise
                        break  # The feed recovers older ACKs from their committed receipts.
            return receipt, first_review
        else:
            page = job.payload.get("feedPage", 1)
            feed_run = job.payload.get("feedRun", job.id)
            if (
                type(page) is not int
                or not 1 <= page <= 2**31 - 1
                or not isinstance(feed_run, str)
                or not 1 <= len(feed_run) <= 40
            ):
                raise ProviderError("provider_invalid_response")
            entities = (
                client.feed(connection.property_id)
                if page == 1
                else client.feed(connection.property_id, page=page)
            )
            retry_failed = job.payload.get("retryFailed", False)
            for entity in entities:
                if (
                    not isinstance(entity, dict)
                    or not isinstance(entity.get("attributes"), dict)
                    or entity["attributes"].get("property_id") != connection.property_id
                ):
                    raise ProviderError("provider_invalid_response")
                revision_id = remote_id(entity.get("id"))
                receipt = db.session.scalar(
                    select(ChannelRevision).where(
                        ChannelRevision.tenant_id == tenant_id,
                        ChannelRevision.revision_id == revision_id,
                    )
                )
                if db.session.scalar(
                    select(ChannelBookingReview.id).where(
                        ChannelBookingReview.tenant_id == tenant_id,
                        ChannelBookingReview.revision_id == revision_id,
                        ChannelBookingReview.resolved_at.is_(None),
                    )
                ):
                    continue
                committed = receipt is not None and receipt.outcome in ACK_OUTCOMES
                queue_job(
                    tenant_id,
                    job.actor_id,
                    "ack_revision" if committed else "pull_bookings",
                    {"revisionId": revision_id},
                    ("ack:" if committed else "revision:") + revision_id,
                    retry_failed=retry_failed,
                )
            if len(entities) == 100:
                details = {"feedPage": page + 1, "feedRun": feed_run}
                if retry_failed:
                    details["retryFailed"] = True
                queue_job(
                    tenant_id,
                    job.actor_id,
                    "pull_bookings",
                    details,
                    f"feed-page:{feed_run}:{page + 1}",
                )
    else:
        revision_id = job.payload.get("revisionId")
        if not db.session.scalar(
            select(ChannelRevision.id).where(
                ChannelRevision.tenant_id == tenant_id,
                ChannelRevision.revision_id == revision_id,
                ChannelRevision.outcome.in_(ACK_OUTCOMES),
            )
        ):
            raise ProviderError("channel_commit_required")
        client.ack(revision_id)


def schedule_jobs(tenant_id):
    """Poll feed every minute and publish a daily 366-day baseline in 31-day jobs.

    Bucket keys are durable across worker restarts; tenant locking prevents two
    workers scheduling duplicate work. No provider call happens in this method.
    """
    with current_app.test_request_context("/api/_channel_schedule", method="POST"):
        try:
            set_context(tenant_id=tenant_id)
            g.tenant = lock_tenant(tenant_id)
            connection = db.session.scalar(
                select(ChannelConnection).where(
                    ChannelConnection.tenant_id == tenant_id, ChannelConnection.active.is_(True)
                )
            )
            if not connection:
                db.session.rollback()
                return 0
            authorize_actor(tenant_id, connection.actor_id, operation="pull_bookings")
            before = db.session.scalar(
                select(func.count())
                .select_from(ChannelJob)
                .where(ChannelJob.tenant_id == tenant_id)
            )
            bucket = int(utcnow().timestamp()) // 60
            try:
                queue_job(tenant_id, connection.actor_id, "pull_bookings", {}, f"poll:{bucket}")
            except ApiError as error:
                if error.code != "channel_queue_full":
                    raise
            inbound_only = bool(entitlement(tenant_id)["blockedReason"])
            if not inbound_only:
                drain_pending_ari(connection)
            if (
                not inbound_only
                and connection.inventory_reconciled_at is not None
                and db.session.scalar(
                    select(ChannelMapping.id)
                    .where(ChannelMapping.tenant_id == tenant_id, ChannelMapping.active.is_(True))
                    .limit(1)
                )
            ):
                today = business_date(g.tenant)
                first, last = today, today + timedelta(days=366)
                while first < last:
                    end = min(last, first + timedelta(days=31))
                    try:
                        queue_job(
                            tenant_id,
                            connection.actor_id,
                            "push_ari",
                            {"start": first.isoformat(), "end": end.isoformat()},
                            f"daily:{today}:{first}",
                        )
                    except ApiError as error:
                        if error.code != "channel_queue_full":
                            raise
                        break
                    first = end
            db.session.flush()
            after = db.session.scalar(
                select(func.count())
                .select_from(ChannelJob)
                .where(ChannelJob.tenant_id == tenant_id)
            )
            db.session.commit()
            return after - before
        except ApiError:
            # Paused subscription, revoked owner and full queues are already
            # visible through configuration/job status. Do not spam on each poll.
            db.session.rollback()
            return 0


def process_jobs(tenant_id, limit=10, *, schedule=False):
    from .publication import publisher_lock, recover_publications

    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
        raise ValueError("limit must be 1..100")
    with publisher_lock(tenant_id) as acquired:
        if not acquired:
            return 0
        with current_app.test_request_context("/api/_channel_recover", method="POST"):
            recover_publications(tenant_id)
        return _process_jobs(tenant_id, limit, schedule=schedule)


def _process_jobs(tenant_id, limit=10, *, schedule=False):
    """Return processed count; caller supplies app context only, never an actor.

    Each iteration has its own request and DB transaction. Retriable transport
    failures back off 30/60/120/240 seconds (5 attempts), then need owner retry.
    ARI claims survive a crash; the next owner of the publisher lock recovers
    them after observing the persisted cooldown. Other jobs remain transactional.
    """
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
        raise ValueError("limit must be 1..100")
    if schedule:
        schedule_jobs(tenant_id)
    count = 0
    for _ in range(limit):
        job_id, actor_id, attempts_before = None, None, None
        job_savepoint = None
        with current_app.test_request_context("/api/_channel_worker", method="POST"):
            try:
                set_context(tenant_id=tenant_id)
                g.tenant = lock_tenant(tenant_id)
                connection = db.session.scalar(
                    select(ChannelConnection).where(ChannelConnection.tenant_id == tenant_id)
                )
                ari_cooling = (
                    connection
                    and connection.ari_available_at
                    and connection.ari_available_at > utcnow()
                )
                ready = select(ChannelJob).where(
                    ChannelJob.tenant_id == tenant_id,
                    ChannelJob.status == "queued",
                    ChannelJob.available_at <= utcnow(),
                )
                if ari_cooling:
                    ready = ready.where(ChannelJob.kind.not_in(ARI_KINDS))
                if connection and connection.inventory_reconciled_at is None:
                    ready = ready.where(ChannelJob.kind != "push_ari")
                job = db.session.scalar(
                    ready.order_by(
                        case(
                            (ChannelJob.kind == "ack_revision", 0),
                            (
                                (ChannelJob.kind == "push_ari")
                                & ChannelJob.dedupe_key.startswith("daily:")
                                & (
                                    func.coalesce(ChannelJob.payload["priority"].astext, "")
                                    != "change"
                                ),
                                2,
                            ),
                            else_=1,
                        ),
                        ChannelJob.created_at,
                        ChannelJob.id,
                    )
                    .with_for_update(skip_locked=True)
                    .limit(1)
                )
                if job is None:
                    db.session.rollback()
                    break
                job_id, actor_id, attempts_before = job.id, job.actor_id, job.attempts
                job_savepoint = db.session.begin_nested()
                authorize_actor(tenant_id, actor_id, operation=job.kind)
                if not connection or not connection.active:
                    raise ProviderError("channel_inactive")
                client = ChannexClient(
                    connection.environment, load_credentials(connection)["apiKey"]
                )
                if job.kind == "push_ari" and db.session.scalar(
                    select(ChannelMapping.id)
                    .where(
                        ChannelMapping.tenant_id == tenant_id,
                        ChannelMapping.active.is_(True),
                    )
                    .limit(1)
                ):
                    from .publication import publish_ari

                    job_savepoint = None
                    job, connection = publish_ari(tenant_id, job, connection, client)
                    result = None
                elif job.kind == "load_bookings":
                    # A committed claim prevents a crash after the POST from replaying it.
                    job.status, job.attempts = "processing", job.attempts + 1
                    job_savepoint = None
                    db.session.commit()
                    set_context(tenant_id=tenant_id)
                    g.tenant = lock_tenant(tenant_id)
                    authorize_actor(tenant_id, actor_id)
                    connection = db.session.scalar(
                        select(ChannelConnection).where(ChannelConnection.tenant_id == tenant_id)
                    )
                    if not connection or not connection.active:
                        raise ProviderError("channel_inactive")
                    client = ChannexClient(
                        connection.environment, load_credentials(connection)["apiKey"]
                    )
                    job = db.session.get(ChannelJob, job_id)
                    result = _run_job(tenant_id, job, connection, client)
                else:
                    job.status, job.attempts = "processing", job.attempts + 1
                    try:
                        result = _run_job(tenant_id, job, connection, client)
                    except ApiError as error:
                        if error.code != "channel_queue_full":
                            raise
                        # Commit imported receipts/queued revisions; resume this page after capacity frees.
                        result = DEFERRED
                deferred = result is DEFERRED
                needs_review = (
                    result is not None and not deferred and result[0].outcome == "needs_review"
                )
                job.status = (
                    "queued" if deferred else "needs_review" if needs_review else "succeeded"
                )
                job.error_code = (
                    "channel_queue_full"
                    if deferred
                    else result[0].error_code
                    if needs_review
                    else None
                )
                job.completed_at = None if deferred else utcnow()
                if deferred:
                    job.attempts -= 1
                    job.available_at = utcnow() + timedelta(seconds=15)
                if job.kind in ARI_KINDS:
                    connection.ari_available_at = utcnow() + timedelta(seconds=7)
                if needs_review:
                    if result[1]:
                        audit(
                            "channel.sync_error",
                            "channel_job",
                            job.id,
                            {
                                "kind": job.kind,
                                "errorCode": job.error_code,
                                "status": job.status,
                            },
                        )
                elif not deferred:
                    audit("channel.synced", "channel_job", job.id, {"kind": job.kind})
                log_details = (
                    tenant_id,
                    job.id,
                    job.kind,
                    job.payload.get("revisionId", "-"),
                    job.status,
                    job.error_code or "-",
                )
                db.session.commit()
                current_app.logger.info(
                    "Channex job tenant=%s job=%s kind=%s revision=%s status=%s error=%s",
                    *log_details,
                )
                count += 1
            except (ApiError, ProviderError, SQLAlchemyError) as error:
                if (
                    isinstance(error, (ApiError, ProviderError))
                    and job_savepoint is not None
                    and job_savepoint.is_active
                ):
                    # Keep the tenant lock until terminal status or retry is durable.
                    job_savepoint.rollback()
                else:
                    db.session.rollback()
                if not job_id:
                    raise
                set_context(tenant_id=tenant_id)
                g.tenant = lock_tenant(tenant_id)
                g.user = db.session.get(User, actor_id)
                failed = db.session.scalar(
                    select(ChannelJob)
                    .where(ChannelJob.tenant_id == tenant_id, ChannelJob.id == job_id)
                    .with_for_update()
                )
                claimed = failed is not None and failed.status == "processing"
                expected_attempts = attempts_before + 1 if claimed else attempts_before
                if (
                    not failed
                    or failed.status not in {"queued", "processing"}
                    or failed.attempts != expected_attempts
                ):
                    db.session.rollback()
                    count += 1
                    continue
                if not claimed:
                    failed.attempts += 1
                failed.error_code = (
                    error.code
                    if isinstance(error, (ApiError, ProviderError))
                    else "channel_database_conflict"
                )
                # Loading old bookings has no upstream idempotency contract; retries are explicit.
                retry = (
                    failed.kind != "load_bookings"
                    and isinstance(error, ProviderError)
                    and error.retryable
                    and failed.attempts < 5
                )
                failed.status = "queued" if retry else "failed"
                failed.available_at = (
                    utcnow() + timedelta(seconds=30 * 2 ** (failed.attempts - 1))
                    if retry
                    else utcnow()
                )
                failed.completed_at = None if retry else utcnow()
                if failed.kind in ARI_KINDS:
                    connection = db.session.scalar(
                        select(ChannelConnection).where(ChannelConnection.tenant_id == tenant_id)
                    )
                    if connection:
                        delay = 60 if isinstance(error, ProviderError) and error.retryable else 7
                        connection.ari_available_at = max(
                            utcnow() if claimed else connection.ari_available_at or utcnow(),
                            utcnow() + timedelta(seconds=delay),
                            failed.available_at,
                        )
                audit(
                    "channel.sync_error",
                    "channel_job",
                    failed.id,
                    {"kind": failed.kind, "errorCode": failed.error_code, "status": failed.status},
                )
                log_details = (
                    tenant_id,
                    failed.id,
                    failed.kind,
                    failed.payload.get("revisionId", "-"),
                    failed.status,
                    failed.error_code,
                    error.http_status or "-" if isinstance(error, ProviderError) else "-",
                    error.failure_type or "-" if isinstance(error, ProviderError) else "-",
                )
                db.session.commit()
                current_app.logger.warning(
                    "Channex job tenant=%s job=%s kind=%s revision=%s status=%s error=%s "
                    "http_status=%s cause=%s",
                    *log_details,
                )
                count += 1
    return count
