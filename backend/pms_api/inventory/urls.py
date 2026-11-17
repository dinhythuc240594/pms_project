"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    GET_MASTERS = "/masters"
    SAVE_MASTER = "/masters/<catalog_name>"
    SAVE_LINK = "/service-stock-links"
    CREATE_DOCUMENT = "/documents"
    LIST_DOCUMENTS = "/documents"
    GET_DOCUMENT = "/documents/<document_id>"
    REVERSE_DOCUMENT = "/documents/<document_id>/reverse"
    RETURN_POS = "/pos/<invoice_id>/returns"
    GET_STOCK = "/stock"


inventory = Blueprint("inventory", __name__, url_prefix="/api/tenants/<tenant_id>/inventory")

URL.register(
    inventory,
    URL.GET_MASTERS,
    "pms_api.inventory.routes:GetMastersView",
    endpoint="get_masters",
    methods=["GET"],
)

URL.register(
    inventory,
    URL.SAVE_MASTER,
    "pms_api.inventory.routes:SaveMasterView",
    endpoint="save_master",
    methods=["POST", "PATCH"],
)

URL.register(
    inventory,
    URL.SAVE_LINK,
    "pms_api.inventory.routes:SaveLinkView",
    endpoint="save_link",
    methods=["POST"],
)

URL.register(
    inventory,
    URL.CREATE_DOCUMENT,
    "pms_api.inventory.routes:CreateDocumentView",
    endpoint="create_document",
    methods=["POST"],
)

URL.register(
    inventory,
    URL.LIST_DOCUMENTS,
    "pms_api.inventory.routes:ListDocumentsView",
    endpoint="list_documents",
    methods=["GET"],
)

URL.register(
    inventory,
    URL.GET_DOCUMENT,
    "pms_api.inventory.routes:GetDocumentView",
    endpoint="get_document",
    methods=["GET"],
)

URL.register(
    inventory,
    URL.REVERSE_DOCUMENT,
    "pms_api.inventory.routes:ReverseDocumentView",
    endpoint="reverse_document",
    methods=["POST"],
)

URL.register(
    inventory,
    URL.RETURN_POS,
    "pms_api.inventory.routes:ReturnPosView",
    endpoint="return_pos",
    methods=["POST"],
)

URL.register(
    inventory,
    URL.GET_STOCK,
    "pms_api.inventory.routes:GetStockView",
    endpoint="get_stock",
    methods=["GET"],
)
