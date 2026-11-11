"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    SAVE_MASTER_ROUTE = "/masters/<catalog_name>"
    SAVE_MASTER_ROUTE_2 = "/masters/<catalog_name>"
    TOGGLE_MASTER_ROUTE = "/masters/<catalog_name>/<item_id>/toggle"
    SETTINGS_ROUTE = "/settings"
    RATES_ROUTE = "/rates"
    SAVE_RATES_ROUTE = "/rates"
    ROOM_BLOCKS_ROUTE = "/room-blocks"
    ADD_ROOM_BLOCK_ROUTE = "/room-blocks"
    DELETE_ROOM_BLOCK_ROUTE = "/room-blocks/<block_id>"
    AVAILABILITY_ROUTE = "/availability"
    QUOTE_ROUTE = "/quote"


catalog = Blueprint("catalog", __name__, url_prefix="/api/tenants/<tenant_id>")

URL.register(
    catalog,
    URL.SAVE_MASTER_ROUTE,
    "pms_api.catalog.routes:SaveMasterRouteView",
    endpoint="save_master_route",
    methods=["PATCH"],
)

URL.register(
    catalog,
    URL.SAVE_MASTER_ROUTE_2,
    "pms_api.catalog.routes:SaveMasterRouteView",
    endpoint="save_master_route",
    methods=["POST"],
)

URL.register(
    catalog,
    URL.TOGGLE_MASTER_ROUTE,
    "pms_api.catalog.routes:ToggleMasterRouteView",
    endpoint="toggle_master_route",
    methods=["POST"],
)

URL.register(
    catalog,
    URL.SETTINGS_ROUTE,
    "pms_api.catalog.routes:SettingsRouteView",
    endpoint="settings_route",
    methods=["PATCH"],
)

URL.register(
    catalog,
    URL.RATES_ROUTE,
    "pms_api.catalog.routes:RatesRouteView",
    endpoint="rates_route",
    methods=["GET"],
)

URL.register(
    catalog,
    URL.SAVE_RATES_ROUTE,
    "pms_api.catalog.routes:SaveRatesRouteView",
    endpoint="save_rates_route",
    methods=["PUT"],
)

URL.register(
    catalog,
    URL.ROOM_BLOCKS_ROUTE,
    "pms_api.catalog.routes:RoomBlocksRouteView",
    endpoint="room_blocks_route",
    methods=["GET"],
)

URL.register(
    catalog,
    URL.ADD_ROOM_BLOCK_ROUTE,
    "pms_api.catalog.routes:AddRoomBlockRouteView",
    endpoint="add_room_block_route",
    methods=["POST"],
)

URL.register(
    catalog,
    URL.DELETE_ROOM_BLOCK_ROUTE,
    "pms_api.catalog.routes:DeleteRoomBlockRouteView",
    endpoint="delete_room_block_route",
    methods=["DELETE"],
)

URL.register(
    catalog,
    URL.AVAILABILITY_ROUTE,
    "pms_api.catalog.routes:AvailabilityRouteView",
    endpoint="availability_route",
    methods=["GET"],
)

URL.register(
    catalog,
    URL.QUOTE_ROUTE,
    "pms_api.catalog.routes:QuoteRouteView",
    endpoint="quote_route",
    methods=["POST"],
)
