"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from . import application as application
from .access import require_channel_access


class SnapshotView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id):
        return application.handle_snapshot(tenant_id)


class BookingReviewsView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id):
        return application.handle_booking_reviews(tenant_id)


class CatalogView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id):
        return application.handle_catalog(tenant_id)


class SaveConfigView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id):
        return application.handle_save_config(tenant_id)


class SaveMappingView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id):
        return application.handle_save_mapping(tenant_id)


class CreateJobView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id):
        return application.handle_create_job(tenant_id)


class RetryJobView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id, job_id):
        return application.handle_retry_job(tenant_id, job_id)


class ReconcileInventoryView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id):
        return application.handle_reconcile_inventory(tenant_id)


class WebhookView(CommonMethodView):
    @staticmethod
    def dispatch_request(tenant_id):
        return application.handle_webhook(tenant_id)


def __getattr__(name):
    if name in {"URL", "channels"}:
        from importlib import import_module

        return getattr(import_module(".urls", __package__), name)
    return getattr(application, name)
