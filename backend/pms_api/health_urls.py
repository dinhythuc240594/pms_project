"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    LIVENESS = "/api/health"
    READINESS = "/api/ready"
    OPERATIONS = "/api/admin/operations"


health = Blueprint("health", __name__)

URL.register(
    health, URL.LIVENESS, "pms_api.health:LivenessView", endpoint="liveness", methods=["GET"]
)

URL.register(
    health, URL.READINESS, "pms_api.health:ReadinessView", endpoint="readiness", methods=["GET"]
)

URL.register(
    health, URL.OPERATIONS, "pms_api.health:OperationsView", endpoint="operations", methods=["GET"]
)
