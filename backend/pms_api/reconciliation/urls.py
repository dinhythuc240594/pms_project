"""Tenant-scoped reconciliation endpoints."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    PREVIEW = ""
    CONFIRM = "/confirm"
    HISTORY = "/history"
    NIGHT_AUDIT = "/night-audit"


reconciliation = Blueprint(
    "reconciliation", __name__, url_prefix="/api/tenants/<tenant_id>/reconciliation"
)
URL.register(
    reconciliation,
    URL.NIGHT_AUDIT,
    "pms_api.reconciliation.night_audit:NightAuditPreviewView",
    endpoint="night_audit_preview",
    methods=["GET"],
)
URL.register(
    reconciliation,
    URL.NIGHT_AUDIT,
    "pms_api.reconciliation.night_audit:CloseNightAuditView",
    endpoint="close_night_audit",
    methods=["POST"],
)
URL.register(
    reconciliation,
    URL.PREVIEW,
    "pms_api.reconciliation.routes:PreviewView",
    endpoint="preview",
    methods=["GET"],
)
URL.register(
    reconciliation,
    URL.CONFIRM,
    "pms_api.reconciliation.routes:ConfirmView",
    endpoint="confirm",
    methods=["POST"],
)
URL.register(
    reconciliation,
    URL.HISTORY,
    "pms_api.reconciliation.routes:HistoryView",
    endpoint="history",
    methods=["GET"],
)
