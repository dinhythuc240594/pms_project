"""Small, deterministic boundaries shared by preview and confirmation."""

import hashlib
import json
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from ..security import ApiError


def day_window(value, timezone, now):
    try:
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError
        day = date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ApiError(422, "invalid_dates", "Chọn ngày đối soát hợp lệ.") from None
    zone = ZoneInfo(timezone)
    if day > now.astimezone(zone).date():
        raise ApiError(422, "future_day", "Không xác nhận đối soát cho ngày trong tương lai.")
    return (
        day,
        datetime.combine(day, time.min, tzinfo=zone),
        datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone),
    )


def preview_token(snapshot):
    encoded = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode()).hexdigest()
