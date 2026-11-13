"""Keep nightly room history separate from the remaining inventory allocation."""

from collections import Counter, defaultdict
from datetime import timedelta


def room_stays(nights):
    result = []
    for night in sorted(nights, key=lambda row: (row.room_number, row.date)):
        day, end = night.date.isoformat(), (night.date + timedelta(days=1)).isoformat()
        if result and result[-1]["room"] == night.room_number and result[-1]["end"] == day:
            result[-1]["end"] = end
        else:
            result.append({"room": night.room_number, "start": day, "end": end})
    return result


def inventory_adjustments(rooms, start, end, delta):
    ranges = defaultdict(Counter)
    for room in rooms:
        first, last = (
            max(start, getattr(room, "check_in", start)),
            min(end, getattr(room, "check_out", end)),
        )
        if first < last:
            ranges[first, last][room.room_type_id] += delta
    return [(first, last, dict(values)) for (first, last), values in sorted(ranges.items())]
