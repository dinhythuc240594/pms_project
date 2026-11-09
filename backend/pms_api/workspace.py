"""Compose the tenant workspace without coupling it to application setup."""

from flask import g, jsonify

from common import CommonMethodView

from .admin.routes import tenant_users_json
from .auth.routes import tenant_json
from .bookings.routes import booking_snapshot
from .catalog.routes import catalog_snapshot
from .finance.routes import finance_snapshot
from .housekeeping.routes import housekeeping_snapshot
from .inventory.routes import inventory_snapshot
from .security import require_tenant
from .subscriptions import workspace_entitlements


class WorkspaceView(CommonMethodView):
    @staticmethod
    @require_tenant("workspace.view")
    def dispatch_request(tenant_id):
        data = {
            **catalog_snapshot(tenant_id),
            **booking_snapshot(tenant_id),
            **(finance_snapshot(tenant_id) if g.role != "HOUSEKEEPING" else {}),
            **(housekeeping_snapshot(tenant_id) if g.role != "ACCOUNTANT" else {}),
            **(inventory_snapshot(tenant_id) if g.role in {"HOTEL_OWNER", "ACCOUNTANT"} else {}),
            "tenant": tenant_json(g.tenant),
        }
        data["users"] = tenant_users_json(tenant_id) if g.role == "HOTEL_OWNER" else []
        data.update(workspace_entitlements(tenant_id))

        if g.role not in {"HOTEL_OWNER", "ACCOUNTANT"}:
            for catalog in ("warehouses", "items", "itemCategories", "suppliers"):
                data["masters"][catalog] = []

        if g.role == "HOUSEKEEPING":
            data["masters"]["funds"] = []
            data["masters"]["paymentMethods"] = []
            for rows in data["masters"].values():
                for item in rows:
                    for key in ("price", "commission", "tax"):
                        item.pop(key, None)
            for item in data["rates"]:
                item.pop("price", None)
        return jsonify(data)
