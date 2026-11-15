"""Lazy route registration."""

from importlib import import_module

from flask import Blueprint

chatbot = Blueprint("chatbot", __name__, url_prefix="/api/tenants/<tenant_id>/chatbot")


def dispatch(name):
    def view(**kwargs):
        return getattr(import_module(".routes", __package__), name)(**kwargs)

    return view


chatbot.add_url_rule("/config", endpoint="config", view_func=dispatch("config"), methods=["GET"])
chatbot.add_url_rule(
    "/messages", endpoint="messages", view_func=dispatch("messages"), methods=["POST"]
)
