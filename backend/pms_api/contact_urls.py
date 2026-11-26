"""Public marketing contact route, separate from tenant data."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    CONTACT = "/api/public/contact"


contact = Blueprint("contact", __name__)
URL.register(
    contact,
    URL.CONTACT,
    "pms_api.contact:ContactView",
    endpoint="send_contact",
    methods=["POST"],
)
