"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from ..security import require_tenant
from . import application as application


class ListInvoicesView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.view")
    def dispatch_request(tenant_id):
        return application.handle_list_invoices(tenant_id)


class GetInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.view")
    def dispatch_request(tenant_id, invoice_id):
        return application.handle_get_invoice(tenant_id, invoice_id)


class CreateInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.write")
    def dispatch_request(tenant_id):
        return application.handle_create_invoice(tenant_id)


class EditInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.write")
    def dispatch_request(tenant_id, invoice_id):
        return application.handle_edit_invoice(tenant_id, invoice_id)


class PostInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.write")
    def dispatch_request(tenant_id, invoice_id):
        return application.handle_post_invoice(tenant_id, invoice_id)


class PayInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("payments.write")
    def dispatch_request(tenant_id, invoice_id):
        return application.handle_pay_invoice(tenant_id, invoice_id)


class RefundInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("payments.write")
    def dispatch_request(tenant_id, invoice_id, payment_id):
        return application.handle_refund_invoice(tenant_id, invoice_id, payment_id)


class CancelInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.cancel")
    def dispatch_request(tenant_id, invoice_id):
        return application.handle_cancel_invoice(tenant_id, invoice_id)


class CreateDocumentView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.write")
    def dispatch_request(tenant_id):
        return application.handle_create_document(tenant_id)


class ReverseDocumentView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.reverse")
    def dispatch_request(tenant_id, document_id):
        return application.handle_reverse_document(tenant_id, document_id)


class CashbookView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.view")
    def dispatch_request(tenant_id):
        return application.handle_cashbook(tenant_id)


def __getattr__(name):
    if name in {"URL", "finance"}:
        from importlib import import_module

        return getattr(import_module(".urls", __package__), name)
    return getattr(application, name)
