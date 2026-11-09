"""Register ORM metadata without importing HTTP handlers."""

from importlib import import_module


def register_models():
    for module in (
        "core_models",
        "admin.feature_models",
        "admin.client_models",
        "catalog.models",
        "pricing.models",
        "bookings.models",
        "finance.models",
        "housekeeping.models",
        "inventory.models",
        "channels.models",
        "notification_models",
        "saas_billing.models",
        "worker_health",
        "reconciliation.models",
    ):
        import_module(f"{__package__}.{module}")
