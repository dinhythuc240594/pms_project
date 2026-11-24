"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    LIST_FEATURES = "/features"
    UPDATE_FEATURE = "/features/<code>"
    OWN_FEATURE_OVERRIDES = "/tenants/<tenant_id>/feature-overrides"
    PUT_FEATURE_OVERRIDE = "/tenants/<tenant_id>/feature-overrides/<code>"
    DELETE_FEATURE_OVERRIDE = "/tenants/<tenant_id>/feature-overrides/<code>"


features = Blueprint("features", __name__, url_prefix="/api")

URL.register(
    features,
    URL.LIST_FEATURES,
    "pms_api.admin.features:ListFeaturesView",
    endpoint="list_features",
    methods=["GET"],
)

URL.register(
    features,
    URL.UPDATE_FEATURE,
    "pms_api.admin.features:UpdateFeatureView",
    endpoint="update_feature",
    methods=["PATCH"],
)

URL.register(
    features,
    URL.OWN_FEATURE_OVERRIDES,
    "pms_api.admin.features:OwnFeatureOverridesView",
    endpoint="own_feature_overrides",
    methods=["GET"],
)

URL.register(
    features,
    URL.PUT_FEATURE_OVERRIDE,
    "pms_api.admin.features:PutFeatureOverrideView",
    endpoint="put_feature_override",
    methods=["PUT"],
)

URL.register(
    features,
    URL.DELETE_FEATURE_OVERRIDE,
    "pms_api.admin.features:DeleteFeatureOverrideView",
    endpoint="delete_feature_override",
    methods=["DELETE"],
)
