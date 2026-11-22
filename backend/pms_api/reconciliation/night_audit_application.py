"""Close the hotel day once and record revenue separately from cash movements."""

import hmac
from datetime import date
from decimal import Decimal

from pms_api.bookings.application import string_value
from pms_api.finance.application import begin, finish
from pms_api.ports import runtime

from ..extensions import db
from ..security import ApiError, audit
from .business_days import night_audit_preview
from .models import NightAudit, RevenueRecognition


def handle_night_audit_preview(tenant_id):
    return night_audit_preview(tenant_id, runtime().request.args.get("date"))


def handle_close_night_audit(tenant_id):
    data = runtime().payload()
    if set(data) - {"date", "previewToken", "reason"}:
        raise ApiError(422, "invalid_audit", "Yêu cầu chốt ngày có trường không hợp lệ.")
    key, fingerprint, replay = begin(tenant_id, data)
    if replay is not None:
        return replay, 201
    reason = string_value(data.get("reason"), "Lý do/xác nhận kiểm tra", 1000, required=True)
    preview = night_audit_preview(tenant_id, data.get("date"))
    token = data.get("previewToken")
    if preview["periodLocked"]:
        raise ApiError(409, "period_closed", "Ngày này đã được chốt.")
    if (
        not isinstance(token, str)
        or not token.isascii()
        or not hmac.compare_digest(token, preview["previewToken"])
    ):
        raise ApiError(
            409, "preview_changed", "Dữ liệu đã đổi; tải lại bản xem trước trước khi chốt."
        )
    if preview["blockers"]:
        raise ApiError(
            409, "audit_unresolved", "Xử lý khách đến/đi và hồ sơ OTA còn tồn trước khi chốt."
        )
    row = NightAudit(
        tenant_id=tenant_id,
        business_date=date.fromisoformat(preview["date"]),
        timezone=preview["timezone"],
        actor_id=runtime().state.user.id,
        actor_name=runtime().state.user.name,
        reason=reason,
        snapshot=preview,
    )
    db.session.add(row)
    db.session.flush()
    for entry in preview["entries"]:
        db.session.add(
            RevenueRecognition(
                tenant_id=tenant_id,
                audit_id=row.id,
                business_date=row.business_date,
                source_kind=entry["sourceKind"],
                source_id=entry["sourceId"],
                source_date=date.fromisoformat(entry["sourceDate"]),
                amount=Decimal(entry["amount"]),
                currency=entry["currency"],
                base_amount=Decimal(entry["baseAmount"]),
                base_currency=entry["baseCurrency"],
                details=entry["details"],
            )
        )
    audit(
        "night_audit.closed",
        "night_audit",
        row.id,
        {"date": preview["date"], "reason": reason, "totals": preview["totals"]},
    )
    response = {
        **preview,
        "auditId": row.id,
        "actor": row.actor_name,
        "reason": reason,
        "periodLocked": True,
    }
    return finish(tenant_id, key, fingerprint, response)
