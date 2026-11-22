"""Tenant-scoped SQL history with session-bound, stable keyset pagination."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from itsdangerous import BadData, URLSafeTimedSerializer
from sqlalchemy import func, select, tuple_

from pms_api.ports import runtime

from ..core_models import utcnow
from ..extensions import db
from ..security import ApiError
from .models import ChannelJob

STATUSES = {"queued", "processing", "succeeded", "failed", "needs_review"}
KINDS = {
    "push_ari",
    "pull_bookings",
    "ack_revision",
    "setup_webhook",
    "pause_mapping",
    "load_bookings",
}
FILTERS = {"status", "kind", "revisionId", "dateFrom", "dateTo"}
CURSOR_MAX_AGE = 86400


def invalid_filter():
    return ApiError(422, "invalid_channel_job_filter", "Bộ lọc lịch sử đồng bộ không hợp lệ.")


def filter_date(value):
    try:
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value or parsed == date.max:
            raise ValueError
        return parsed
    except ValueError, TypeError:
        raise invalid_filter() from None


def date_boundary(day, zone):
    try:
        return datetime.combine(day, time.min, zone).astimezone(UTC)
    except ValueError, OverflowError:
        raise invalid_filter() from None


def history_query():
    from pms_api.admin.channex_remote_application import query_values

    start_value, end_value = runtime().date_range(aliases=("dateFrom", "dateTo"))
    args = query_values(FILTERS | {"start_date", "end_date", "cursor", "pageSize"})
    raw_size = args.get("pageSize", "25")
    if (
        not raw_size.isascii()
        or not raw_size.isdigit()
        or len(raw_size) > 3
        or not 1 <= int(raw_size) <= 100
    ):
        raise ApiError(422, "invalid_pagination", "Mỗi trang cần từ 1 đến 100 tác vụ.")
    filters = {key: args[key] for key in FILTERS - {"dateFrom", "dateTo"} if key in args}
    if start_value is not None:
        filters["dateFrom"] = start_value
    if end_value is not None:
        filters["dateTo"] = end_value
    filters = dict(sorted(filters.items()))
    for key, allowed in (("status", STATUSES), ("kind", KINDS)):
        if key in filters and filters[key] not in allowed:
            raise invalid_filter()
    revision = filters.get("revisionId")
    if revision is not None and (
        not 1 <= len(revision) <= 36
        or not revision.isascii()
        or any(ord(char) < 33 or ord(char) > 126 for char in revision)
    ):
        raise invalid_filter()
    start = filter_date(filters["dateFrom"]) if "dateFrom" in filters else None
    end = filter_date(filters["dateTo"]) if "dateTo" in filters else None
    if start and end and start > end:
        raise invalid_filter()
    return args, int(raw_size), filters, start, end


def cursor_state(tenant_id, size, filters, timezone, token):
    # Use the same session signing source as Channex's existing owner-link tokens.
    # This works across API workers without introducing a new deployment secret.
    signer = URLSafeTimedSerializer(
        runtime().state.auth_session.token_hash, salt="channel-job-history-v1"
    )
    binding = {
        "version": 1,
        "tenantId": tenant_id,
        "pageSize": size,
        "filters": filters,
        "timezone": timezone,
    }
    if token is None:
        return signer, {**binding, "snapshotAt": utcnow().isoformat(), "after": None, "page": 1}
    try:
        if not token or len(token) > 4096:
            raise ValueError
        state = signer.loads(token, max_age=CURSOR_MAX_AGE)
        if (
            not isinstance(state, dict)
            or set(state) != set(binding) | {"snapshotAt", "after", "page"}
            or any(state[key] != value for key, value in binding.items())
            or type(state["page"]) is not int
            or not 1 <= state["page"] <= 2**31 - 1
        ):
            raise ValueError
        snapshot = datetime.fromisoformat(state["snapshotAt"])
        if snapshot.utcoffset() is None:
            raise ValueError
        after = state["after"]
        if after is None:
            if state["page"] != 1:
                raise ValueError
        elif (
            not isinstance(after, list)
            or len(after) != 2
            or not isinstance(after[1], str)
            or not 1 <= len(after[1]) <= 40
            or state["page"] == 1
        ):
            raise ValueError
        else:
            timestamp = datetime.fromisoformat(after[0])
            if timestamp.utcoffset() is None or timestamp > snapshot:
                raise ValueError
        return signer, state
    except BadData, ValueError, TypeError, KeyError, OverflowError:
        raise ApiError(
            422, "invalid_cursor", "Trang lịch sử không hợp lệ hoặc đã hết hạn. Tải lại lịch sử."
        ) from None


def handle_jobs(tenant_id):
    from pms_api.channels.application import job_json

    args, size, filters, start, end = history_query()
    zone = ZoneInfo((runtime().state.tenant.settings or {}).get("timezone", "Asia/Ho_Chi_Minh"))
    signer, state = cursor_state(tenant_id, size, filters, zone.key, args.get("cursor"))
    snapshot = datetime.fromisoformat(state["snapshotAt"])
    conditions = [ChannelJob.tenant_id == tenant_id, ChannelJob.created_at <= snapshot]
    if "status" in filters:
        conditions.append(ChannelJob.status == filters["status"])
    if "kind" in filters:
        conditions.append(ChannelJob.kind == filters["kind"])
    if "revisionId" in filters:
        conditions.append(ChannelJob.payload["revisionId"].astext == filters["revisionId"])
    if start:
        conditions.append(ChannelJob.created_at >= date_boundary(start, zone))
    if end:
        conditions.append(ChannelJob.created_at < date_boundary(end + timedelta(days=1), zone))
    total = db.session.scalar(select(func.count()).select_from(ChannelJob).where(*conditions))
    if state["after"] is not None:
        timestamp, job_id = state["after"]
        conditions.append(
            tuple_(ChannelJob.created_at, ChannelJob.id)
            < tuple_(datetime.fromisoformat(timestamp), job_id)
        )
    jobs = list(
        db.session.scalars(
            select(ChannelJob)
            .where(*conditions)
            .order_by(ChannelJob.created_at.desc(), ChannelJob.id.desc())
            .limit(size + 1)
        )
    )
    items = jobs[:size]
    next_cursor = None
    if len(jobs) > size:
        last = items[-1]
        next_cursor = signer.dumps(
            {
                **state,
                "after": [last.created_at.isoformat(), last.id],
                "page": state["page"] + 1,
            }
        )
    return {
        "items": [job_json(row) for row in items],
        "pagination": {
            "page": state["page"],
            "pageSize": size,
            "totalItems": total,
            "totalPages": (total + size - 1) // size,
            "currentCursor": signer.dumps(state),
            "nextCursor": next_cursor,
            "snapshotAt": state["snapshotAt"],
        },
    }


def handle_job_detail(tenant_id, job_id):
    from pms_api.admin.channex_remote_application import query_values
    from pms_api.channels.application import job_json

    query_values(set())
    row = db.session.scalar(
        select(ChannelJob).where(ChannelJob.tenant_id == tenant_id, ChannelJob.id == job_id)
    )
    if row is None:
        raise ApiError(404, "not_found", "Không tìm thấy tác vụ.")
    return {**job_json(row), "availableAt": row.available_at.isoformat()}
