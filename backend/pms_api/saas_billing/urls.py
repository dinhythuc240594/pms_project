"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    LIST_INVOICES = "/api/billing/invoices"
    CREATE_INVOICE = "/api/billing/invoices"
    ADD_PAYMENT = "/api/billing/invoices/<invoice_id>/payments"
    REFUND_PAYMENT = "/api/billing/invoices/<invoice_id>/payments/<payment_id>/refund"
    OPERATIONAL_ACCESS = "/api/billing/tenants/<tenant_id>/operational-access"
    VOID_INVOICE = "/api/billing/invoices/<invoice_id>/void"
    OVERVIEW = "/api/manager/overview"
    TENANT_BILLING = "/api/tenants/<tenant_id>/billing"
    TENANT_INVOICES = "/api/tenants/<tenant_id>/billing/invoices"
    TENANT_INVOICE = "/api/tenants/<tenant_id>/billing/invoices/<invoice_id>"
    TENANT_HISTORY = "/api/tenants/<tenant_id>/billing/history"


billing = Blueprint("saas_billing", __name__)

URL.register(
    billing,
    URL.REFUND_PAYMENT,
    "pms_api.saas_billing.routes:RefundPaymentView",
    endpoint="refund_payment",
    methods=["POST"],
)
URL.register(
    billing,
    URL.OPERATIONAL_ACCESS,
    "pms_api.saas_billing.routes:OperationalAccessView",
    endpoint="operational_access",
    methods=["GET", "POST"],
)

URL.register(
    billing,
    URL.LIST_INVOICES,
    "pms_api.saas_billing.routes:ListInvoicesView",
    endpoint="list_invoices",
    methods=["GET"],
)

URL.register(
    billing,
    URL.CREATE_INVOICE,
    "pms_api.saas_billing.routes:CreateInvoiceView",
    endpoint="create_invoice",
    methods=["POST"],
)

URL.register(
    billing,
    URL.ADD_PAYMENT,
    "pms_api.saas_billing.routes:AddPaymentView",
    endpoint="add_payment",
    methods=["POST"],
)

URL.register(
    billing,
    URL.VOID_INVOICE,
    "pms_api.saas_billing.routes:VoidInvoiceView",
    endpoint="void_invoice",
    methods=["POST"],
)

URL.register(
    billing,
    URL.OVERVIEW,
    "pms_api.saas_billing.routes:OverviewView",
    endpoint="overview",
    methods=["GET"],
)

URL.register(
    billing,
    URL.TENANT_BILLING,
    "pms_api.saas_billing.routes:TenantBillingView",
    endpoint="tenant_billing",
    methods=["GET"],
)

URL.register(
    billing,
    URL.TENANT_INVOICES,
    "pms_api.saas_billing.routes:TenantInvoicesView",
    endpoint="tenant_invoices",
    methods=["GET"],
)

URL.register(
    billing,
    URL.TENANT_INVOICE,
    "pms_api.saas_billing.routes:TenantInvoiceView",
    endpoint="tenant_invoice",
    methods=["GET"],
)

URL.register(
    billing,
    URL.TENANT_HISTORY,
    "pms_api.saas_billing.routes:TenantBillingHistoryView",
    endpoint="tenant_billing_history",
    methods=["GET"],
)
