"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from ..security import require_tenant
from . import application as application


class SnapshotView(CommonMethodView):
    @staticmethod
    @require_tenant("rates.view")
    def dispatch_request(tenant_id):
        return application.handle_snapshot(tenant_id)


class CreateRuleView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id):
        return application.handle_create_rule(tenant_id)


class UpdateRuleView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id):
        return application.handle_update_rule(tenant_id)


class CreatePromotionView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id):
        return application.handle_create_promotion(tenant_id)


class UpdatePromotionView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id):
        return application.handle_update_promotion(tenant_id)


class CreateVoucherView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id):
        return application.handle_create_voucher(tenant_id)


class UpdateVoucherView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id):
        return application.handle_update_voucher(tenant_id)


class SaveExchangeRateView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id):
        return application.handle_save_exchange_rate(tenant_id)


def __getattr__(name):
    if name in {"URL", "pricing"}:
        from importlib import import_module

        return getattr(import_module(".urls", __package__), name)
    return getattr(application, name)
