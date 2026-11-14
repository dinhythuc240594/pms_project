"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    LIST_INVOICES = "/api/tenants/<tenant_id>/pos/invoices"
    GET_INVOICE = "/api/tenants/<tenant_id>/pos/invoices/<invoice_id>"
    CREATE_INVOICE = "/api/tenants/<tenant_id>/pos/invoices"
    EDIT_INVOICE = "/api/tenants/<tenant_id>/pos/invoices/<invoice_id>"
    POST_INVOICE = "/api/tenants/<tenant_id>/pos/invoices/<invoice_id>/post"
    PAY_INVOICE = "/api/tenants/<tenant_id>/pos/invoices/<invoice_id>/payments"
    REFUND_INVOICE = (
        "/api/tenants/<tenant_id>/pos/invoices/<invoice_id>/payments/<payment_id>/refund"
    )
    CANCEL_INVOICE = "/api/tenants/<tenant_id>/pos/invoices/<invoice_id>/cancel"
    CREATE_DOCUMENT = "/api/tenants/<tenant_id>/cash-documents"
    REVERSE_DOCUMENT = "/api/tenants/<tenant_id>/cash-documents/<document_id>/reverse"
    CASHBOOK = "/api/tenants/<tenant_id>/cashbook"
    COMMISSIONS = "/api/tenants/<tenant_id>/commissions"
    SETTLE_COMMISSION = "/api/tenants/<tenant_id>/commissions/settle"
    PAY_COMMISSION = "/api/tenants/<tenant_id>/commissions/<commission_id>/payments"
    REVIEW_COMMISSION = "/api/tenants/<tenant_id>/commissions/<commission_id>/review"
    RECOVER_COMMISSION = "/api/tenants/<tenant_id>/commissions/<commission_id>/recoveries"


finance = Blueprint("finance", __name__)

URL.register(
    finance,
    URL.LIST_INVOICES,
    "pms_api.finance.routes:ListInvoicesView",
    endpoint="list_invoices",
    methods=["GET"],
)

URL.register(
    finance,
    URL.GET_INVOICE,
    "pms_api.finance.routes:GetInvoiceView",
    endpoint="get_invoice",
    methods=["GET"],
)

URL.register(
    finance,
    URL.CREATE_INVOICE,
    "pms_api.finance.routes:CreateInvoiceView",
    endpoint="create_invoice",
    methods=["POST"],
)

URL.register(
    finance,
    URL.EDIT_INVOICE,
    "pms_api.finance.routes:EditInvoiceView",
    endpoint="edit_invoice",
    methods=["PATCH"],
)

URL.register(
    finance,
    URL.POST_INVOICE,
    "pms_api.finance.routes:PostInvoiceView",
    endpoint="post_invoice",
    methods=["POST"],
)

URL.register(
    finance,
    URL.PAY_INVOICE,
    "pms_api.finance.routes:PayInvoiceView",
    endpoint="pay_invoice",
    methods=["POST"],
)

URL.register(
    finance,
    URL.REFUND_INVOICE,
    "pms_api.finance.routes:RefundInvoiceView",
    endpoint="refund_invoice",
    methods=["POST"],
)

URL.register(
    finance,
    URL.CANCEL_INVOICE,
    "pms_api.finance.routes:CancelInvoiceView",
    endpoint="cancel_invoice",
    methods=["POST"],
)

URL.register(
    finance,
    URL.CREATE_DOCUMENT,
    "pms_api.finance.routes:CreateDocumentView",
    endpoint="create_document",
    methods=["POST"],
)

URL.register(
    finance,
    URL.REVERSE_DOCUMENT,
    "pms_api.finance.routes:ReverseDocumentView",
    endpoint="reverse_document",
    methods=["POST"],
)

URL.register(
    finance,
    URL.CASHBOOK,
    "pms_api.finance.routes:CashbookView",
    endpoint="cashbook",
    methods=["GET"],
)

URL.register(finance, URL.COMMISSIONS, "pms_api.finance.commissions:ListCommissionsView", endpoint="commissions", methods=["GET"])
URL.register(finance, URL.SETTLE_COMMISSION, "pms_api.finance.commissions:SettleCommissionView", endpoint="settle_commission", methods=["POST"])
URL.register(finance, URL.PAY_COMMISSION, "pms_api.finance.commissions:PayCommissionView", endpoint="pay_commission", methods=["POST"])
URL.register(finance, URL.REVIEW_COMMISSION, "pms_api.finance.commissions:CommissionReviewPreviewView", endpoint="commission_review_preview", methods=["GET"])
URL.register(finance, URL.REVIEW_COMMISSION, "pms_api.finance.commissions:ReviewCommissionView", endpoint="review_commission", methods=["POST"])
URL.register(finance, URL.RECOVER_COMMISSION, "pms_api.finance.commissions:RecoverCommissionView", endpoint="recover_commission", methods=["POST"])
