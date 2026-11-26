"""Read-only preview of the validated outbound ARI snapshot."""

from datetime import date

from flask import g
from sqlalchemy import select

from common import CommonMethodView, RequestData

from ..admin.channex_remote import query_values
from ..catalog.models import DailyRate, RoomType
from ..extensions import db
from ..security import ApiError
from . import service
from .access import require_channel_access
from .client import ProviderError
from .credentials import load_credentials, valid_secret
from .models import ChannelMapping
from .routes import connection


class AriPreviewView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id):
        start, end = RequestData.date_range()
        query_values({"start", "end", "start_date", "end_date"})
        details = {"start": start, "end": end}
        days = service.window(start, end)
        saved = connection(tenant_id, active=True)
        try:
            credentials = load_credentials(saved)
            if not valid_secret(credentials.get("apiKey")):
                raise ProviderError("credentials_unavailable")
            client = service.ChannexClient(saved.environment, credentials["apiKey"])
            availability, restrictions = service.ari_snapshot(tenant_id, saved, client, details)
        except ProviderError as error:
            raise ApiError(
                503
                if error.retryable
                or error.code in {"credentials_unavailable", "credential_storage_unavailable"}
                else 422,
                error.code,
                "Chưa thể xem trước giá OTA. Kiểm tra kết nối, ghép nối và giá đang mở bán.",
            ) from None
        mappings = {
            row.remote_rate_plan_id: row
            for row in db.session.scalars(
                select(ChannelMapping).where(
                    ChannelMapping.tenant_id == tenant_id,
                    ChannelMapping.active.is_(True),
                )
            )
        }
        if any(row["rate_plan_id"] not in mappings for row in restrictions):
            raise ApiError(
                409, "channel_snapshot_changed", "Ghép nối vừa thay đổi. Tải lại giá xem trước."
            )
        type_ids = [row.room_type_id for row in mappings.values()]
        room_names = dict(
            db.session.execute(
                select(RoomType.id, RoomType.name).where(
                    RoomType.tenant_id == tenant_id,
                    RoomType.id.in_(type_ids),
                )
            ).all()
        )
        daily = set(
            db.session.execute(
                select(DailyRate.room_type_id, DailyRate.date).where(
                    DailyRate.tenant_id == tenant_id,
                    DailyRate.room_type_id.in_(type_ids),
                    DailyRate.date.in_(days),
                )
            ).all()
        )
        stock = {(row["room_type_id"], row["date"]): row["availability"] for row in availability}
        currency = (g.tenant.settings or {}).get("currency", "VND")
        inventory_held = bool(db.session.scalar(select(service.booking_inventory_hold(tenant_id))))
        return {
            "start": start,
            "end": end,
            "currency": currency,
            "inventoryHeld": inventory_held,
            "warning": "Giá OTA dùng giá cơ bản hoặc giá theo ngày. Quy tắc cuối tuần, số đêm, voucher và khuyến mãi PMS không tự áp dụng lên OTA.",
            "rows": [
                {
                    "date": row["date"],
                    "roomTypeId": mappings[row["rate_plan_id"]].room_type_id,
                    "roomTypeName": room_names[mappings[row["rate_plan_id"]].room_type_id],
                    "priceSource": "daily"
                    if (mappings[row["rate_plan_id"]].room_type_id, date.fromisoformat(row["date"]))
                    in daily
                    else "base",
                    "rate": row.get("rate"),
                    "currency": currency,
                    "channexRoomTypeId": mappings[row["rate_plan_id"]].remote_room_type_id,
                    "channexRatePlanId": row["rate_plan_id"],
                    "availability": stock[
                        mappings[row["rate_plan_id"]].remote_room_type_id, row["date"]
                    ],
                    "stopSell": row["stop_sell"],
                }
                for row in restrictions
            ],
        }
