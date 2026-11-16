"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from ..security import require_tenant
from . import application as application


class DashboardView(CommonMethodView):
    @staticmethod
    @require_tenant("dashboard.view")
    def dispatch_request(tenant_id):
        return application.handle_dashboard(tenant_id)


class RevenueReportView(CommonMethodView):
    @staticmethod
    @require_tenant("reports.view")
    def dispatch_request(tenant_id):
        return application.handle_revenue_report(tenant_id)


class FinancialReportView(CommonMethodView):
    @staticmethod
    @require_tenant("reports.view")
    def dispatch_request(tenant_id):
        return application.handle_financial_report(tenant_id)


class BusinessReportView(CommonMethodView):
    @staticmethod
    @require_tenant("reports.advanced.view")
    def dispatch_request(tenant_id):
        return application.handle_business_report(tenant_id)


def __getattr__(name):
    if name in {"URL", "reports"}:
        from importlib import import_module

        return getattr(import_module(".urls", __package__), name)
    return getattr(application, name)
