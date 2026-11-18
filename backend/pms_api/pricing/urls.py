"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    SNAPSHOT = ""
    CREATE_RULE = "/rules"
    UPDATE_RULE = "/rules"
    CREATE_PROMOTION = "/promotions"
    UPDATE_PROMOTION = "/promotions"
    CREATE_VOUCHER = "/vouchers"
    UPDATE_VOUCHER = "/vouchers"
    SAVE_EXCHANGE_RATE = "/exchange-rates"


pricing = Blueprint("pricing", __name__, url_prefix="/api/tenants/<tenant_id>/pricing")

URL.register(
    pricing,
    URL.SNAPSHOT,
    "pms_api.pricing.routes:SnapshotView",
    endpoint="snapshot",
    methods=["GET"],
)

URL.register(
    pricing,
    URL.CREATE_RULE,
    "pms_api.pricing.routes:CreateRuleView",
    endpoint="create_rule",
    methods=["POST"],
)

URL.register(
    pricing,
    URL.UPDATE_RULE,
    "pms_api.pricing.routes:UpdateRuleView",
    endpoint="update_rule",
    methods=["PATCH"],
)

URL.register(
    pricing,
    URL.CREATE_PROMOTION,
    "pms_api.pricing.routes:CreatePromotionView",
    endpoint="create_promotion",
    methods=["POST"],
)

URL.register(
    pricing,
    URL.UPDATE_PROMOTION,
    "pms_api.pricing.routes:UpdatePromotionView",
    endpoint="update_promotion",
    methods=["PATCH"],
)

URL.register(
    pricing,
    URL.CREATE_VOUCHER,
    "pms_api.pricing.routes:CreateVoucherView",
    endpoint="create_voucher",
    methods=["POST"],
)

URL.register(
    pricing,
    URL.UPDATE_VOUCHER,
    "pms_api.pricing.routes:UpdateVoucherView",
    endpoint="update_voucher",
    methods=["PATCH"],
)

URL.register(
    pricing,
    URL.SAVE_EXCHANGE_RATE,
    "pms_api.pricing.routes:SaveExchangeRateView",
    endpoint="save_exchange_rate",
    methods=["PUT"],
)
