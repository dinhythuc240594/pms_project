"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    SYSTEM_USERS = "/users"
    CREATE_SYSTEM_USER = "/users"
    UPDATE_SYSTEM_USER = "/users/<user_id>"
    TENANTS = "/tenants"
    CUSTOMER_ACCOUNTS = "/admin/customer-accounts"
    CUSTOMER_ACCOUNT_DIRECTORY = "/admin/customer-accounts/directory"
    CHANNEX = "/admin/channex"
    CHANNEX_ACCOUNTS = "/admin/channex/accounts"
    CHANNEX_PROPERTIES = "/admin/channex/properties"
    CHANNEX_CATALOG = "/admin/channex/properties/<property_id>/catalog"
    CHANNEX_BOOKINGS = "/admin/channex/properties/<property_id>/bookings"
    CHANNEX_INVENTORY = "/admin/channex/properties/<property_id>/inventory"
    CHANNEX_CHANNELS = "/admin/channex/properties/<property_id>/channels"
    CHANNEX_CHANNEL_ADAPTERS = "/admin/channex/properties/<property_id>/channel-adapters"
    CHANNEX_CHANNEL_ADAPTER = "/admin/channex/properties/<property_id>/channel-adapters/<code>"
    CHANNEX_CHANNEL_PROBE = "/admin/channex/properties/<property_id>/channel-probe/<action>"
    CHANNEX_CHANNEL_DETAIL = "/admin/channex/properties/<property_id>/channels/<channel_id>"
    CHANNEX_CHANNEL_ACTION = (
        "/admin/channex/properties/<property_id>/channels/<channel_id>/<action>"
    )
    CHANNEX_AIRBNB_LINK = "/admin/channex/properties/<property_id>/airbnb/connection-link"
    CHANNEX_AIRBNB_CONFIRM = "/admin/channex/airbnb/confirm"
    CHANNEX_AIRBNB_LISTINGS = (
        "/admin/channex/properties/<property_id>/channels/<channel_id>/airbnb/listings"
    )
    CHANNEX_AIRBNB_MAPPINGS = (
        "/admin/channex/properties/<property_id>/channels/<channel_id>/airbnb/mappings"
    )
    CHANNEX_AIRBNB_UNMAP = (
        "/admin/channex/properties/<property_id>/channels/<channel_id>/airbnb/mappings/<mapping_id>"
    )
    CHANNEX_ROOM_TYPES = "/admin/channex/properties/<property_id>/room-types"
    CHANNEX_UPDATE_ROOM_TYPE = "/admin/channex/properties/<property_id>/room-types/<room_type_id>"
    CHANNEX_RATE_PLANS = "/admin/channex/properties/<property_id>/rate-plans"
    CHANNEX_UPDATE_RATE_PLAN = "/admin/channex/properties/<property_id>/rate-plans/<rate_plan_id>"
    CREATE_TENANT = "/tenants"
    UPDATE_TENANT = "/tenants/<tenant_id>"
    CUSTOMER_HISTORY = "/tenants/<tenant_id>/customer-history"
    TENANT_USERS = "/tenants/<tenant_id>/users"
    CREATE_TENANT_USER = "/tenants/<tenant_id>/users"
    UPDATE_TENANT_USER = "/tenants/<tenant_id>/users/<user_id>"
    SYSTEM_AUDIT = "/audit"
    TENANT_AUDIT = "/tenants/<tenant_id>/audit"
    LIST_PLANS = "/plans"
    PUBLIC_PLANS = "/public/plans"
    CREATE_PLAN = "/plans"
    UPDATE_PLAN = "/plans/<plan_id>"
    DELETE_PLAN = "/plans/<plan_id>"
    TENANT_SUBSCRIPTION = "/tenants/<tenant_id>/subscription"
    SUBSCRIPTION_HISTORY = "/tenants/<tenant_id>/subscription/history"
    UPDATE_SUBSCRIPTION = "/tenants/<tenant_id>/subscription"


admin = Blueprint("admin", __name__, url_prefix="/api")

URL.register(
    admin,
    URL.SYSTEM_USERS,
    "pms_api.admin.routes:SystemUsersView",
    endpoint="system_users",
    methods=["GET"],
)

URL.register(
    admin,
    URL.CREATE_SYSTEM_USER,
    "pms_api.admin.routes:CreateSystemUserView",
    endpoint="create_system_user",
    methods=["POST"],
)

URL.register(
    admin,
    URL.UPDATE_SYSTEM_USER,
    "pms_api.admin.routes:UpdateSystemUserView",
    endpoint="update_system_user",
    methods=["PATCH"],
)

URL.register(
    admin, URL.TENANTS, "pms_api.admin.routes:TenantsView", endpoint="tenants", methods=["GET"]
)

URL.register(
    admin,
    URL.CUSTOMER_ACCOUNTS,
    "pms_api.admin.routes:CustomerAccountsView",
    endpoint="customer_accounts",
    methods=["GET"],
)

URL.register(
    admin,
    URL.CUSTOMER_ACCOUNT_DIRECTORY,
    "pms_api.admin.routes:CustomerAccountDirectoryView",
    endpoint="customer_account_directory",
    methods=["GET"],
)

URL.register(
    admin,
    URL.CHANNEX,
    "pms_api.admin.channex:ChannexView",
    endpoint="channex",
    methods=["GET"],
)

URL.register(
    admin,
    URL.CHANNEX_ACCOUNTS,
    "pms_api.admin.channex_remote:RemoteAccountsView",
    endpoint="channex_accounts",
    methods=["GET"],
)
URL.register(
    admin,
    URL.CHANNEX_PROPERTIES,
    "pms_api.admin.channex_remote:RemotePropertiesView",
    endpoint="channex_properties",
    methods=["GET"],
)
URL.register(
    admin,
    URL.CHANNEX_PROPERTIES,
    "pms_api.admin.channex_remote:SaveRemotePropertyView",
    endpoint="channex_create_property",
    methods=["POST"],
)
URL.register(
    admin,
    URL.CHANNEX_CATALOG,
    "pms_api.admin.channex_remote:RemoteCatalogView",
    endpoint="channex_catalog",
    methods=["GET"],
)
URL.register(
    admin,
    URL.CHANNEX_BOOKINGS,
    "pms_api.admin.channex_insights:RemoteBookingsView",
    endpoint="channex_bookings",
    methods=["GET"],
)
URL.register(
    admin,
    URL.CHANNEX_INVENTORY,
    "pms_api.admin.channex_insights:RemoteInventoryView",
    endpoint="channex_inventory",
    methods=["GET"],
)
URL.register(
    admin,
    URL.CHANNEX_CHANNELS,
    "pms_api.admin.channex_insights:RemoteChannelsView",
    endpoint="channex_channels",
    methods=["GET"],
)
URL.register(
    admin,
    URL.CHANNEX_CHANNEL_ADAPTERS,
    "pms_api.admin.channex_channels:ChannelAdaptersView",
    endpoint="channex_channel_adapters",
    methods=["GET"],
)
URL.register(
    admin,
    URL.CHANNEX_CHANNEL_ADAPTER,
    "pms_api.admin.channex_channels:ChannelAdaptersView",
    endpoint="channex_channel_adapter",
    methods=["GET"],
)
URL.register(
    admin,
    URL.CHANNEX_CHANNEL_PROBE,
    "pms_api.admin.channex_channels:ChannelProbeView",
    endpoint="channex_channel_probe",
    methods=["POST"],
)
URL.register(
    admin,
    URL.CHANNEX_CHANNEL_DETAIL,
    "pms_api.admin.channex_channels:ChannelDetailView",
    endpoint="channex_channel_detail",
    methods=["GET"],
)
URL.register(
    admin,
    URL.CHANNEX_CHANNELS,
    "pms_api.admin.channex_channels:SaveChannelView",
    endpoint="channex_create_channel",
    methods=["POST"],
)
URL.register(
    admin,
    URL.CHANNEX_CHANNEL_DETAIL,
    "pms_api.admin.channex_channels:SaveChannelView",
    endpoint="channex_update_channel",
    methods=["PATCH"],
)
URL.register(
    admin,
    URL.CHANNEX_CHANNEL_DETAIL,
    "pms_api.admin.channex_channels:ChannelActionView",
    endpoint="channex_delete_channel",
    methods=["DELETE"],
)
URL.register(
    admin,
    URL.CHANNEX_CHANNEL_ACTION,
    "pms_api.admin.channex_channels:ChannelActionView",
    endpoint="channex_channel_action",
    methods=["POST"],
)
URL.register(
    admin,
    URL.CHANNEX_AIRBNB_LINK,
    "pms_api.admin.channex_airbnb:AirbnbConnectionLinkView",
    endpoint="channex_airbnb_link",
    methods=["POST"],
)
URL.register(
    admin,
    URL.CHANNEX_AIRBNB_CONFIRM,
    "pms_api.admin.channex_airbnb:AirbnbConfirmView",
    endpoint="channex_airbnb_confirm",
    methods=["POST"],
)
URL.register(
    admin,
    URL.CHANNEX_AIRBNB_LISTINGS,
    "pms_api.admin.channex_airbnb:AirbnbListingsView",
    endpoint="channex_airbnb_listings",
    methods=["GET"],
)
URL.register(
    admin,
    URL.CHANNEX_AIRBNB_MAPPINGS,
    "pms_api.admin.channex_airbnb:AirbnbMappingView",
    endpoint="channex_airbnb_mapping",
    methods=["POST"],
)
URL.register(
    admin,
    URL.CHANNEX_AIRBNB_UNMAP,
    "pms_api.admin.channex_airbnb:AirbnbMappingView",
    endpoint="channex_airbnb_unmap",
    methods=["DELETE"],
)
URL.register(
    admin,
    URL.CHANNEX_ROOM_TYPES,
    "pms_api.admin.channex_remote:SaveRemoteRoomTypeView",
    endpoint="channex_create_room_type",
    methods=["POST"],
)
URL.register(
    admin,
    URL.CHANNEX_UPDATE_ROOM_TYPE,
    "pms_api.admin.channex_remote:SaveRemoteRoomTypeView",
    endpoint="channex_update_room_type",
    methods=["PATCH"],
)
URL.register(
    admin,
    URL.CHANNEX_RATE_PLANS,
    "pms_api.admin.channex_remote:SaveRemoteRatePlanView",
    endpoint="channex_create_rate_plan",
    methods=["POST"],
)
URL.register(
    admin,
    URL.CHANNEX_UPDATE_RATE_PLAN,
    "pms_api.admin.channex_remote:SaveRemoteRatePlanView",
    endpoint="channex_update_rate_plan",
    methods=["PATCH"],
)

URL.register(
    admin,
    URL.CREATE_TENANT,
    "pms_api.admin.routes:CreateTenantView",
    endpoint="create_tenant",
    methods=["POST"],
)

URL.register(
    admin,
    URL.UPDATE_TENANT,
    "pms_api.admin.routes:UpdateTenantView",
    endpoint="update_tenant",
    methods=["PATCH"],
)

URL.register(
    admin,
    URL.CUSTOMER_HISTORY,
    "pms_api.admin.routes:CustomerHistoryView",
    endpoint="customer_history",
    methods=["GET"],
)

URL.register(
    admin,
    URL.TENANT_USERS,
    "pms_api.admin.routes:TenantUsersView",
    endpoint="tenant_users",
    methods=["GET"],
)

URL.register(
    admin,
    URL.CREATE_TENANT_USER,
    "pms_api.admin.routes:CreateTenantUserView",
    endpoint="create_tenant_user",
    methods=["POST"],
)

URL.register(
    admin,
    URL.UPDATE_TENANT_USER,
    "pms_api.admin.routes:UpdateTenantUserView",
    endpoint="update_tenant_user",
    methods=["PATCH"],
)

URL.register(
    admin,
    URL.SYSTEM_AUDIT,
    "pms_api.admin.routes:SystemAuditView",
    endpoint="system_audit",
    methods=["GET"],
)

URL.register(
    admin,
    URL.TENANT_AUDIT,
    "pms_api.admin.routes:TenantAuditView",
    endpoint="tenant_audit",
    methods=["GET"],
)

URL.register(
    admin,
    URL.LIST_PLANS,
    "pms_api.admin.routes:ListPlansView",
    endpoint="list_plans",
    methods=["GET"],
)

URL.register(
    admin,
    URL.CREATE_PLAN,
    "pms_api.admin.routes:CreatePlanView",
    endpoint="create_plan",
    methods=["POST"],
)

URL.register(
    admin,
    URL.PUBLIC_PLANS,
    "pms_api.admin.routes:PublicPlansView",
    endpoint="public_plans",
    methods=["GET"],
)

URL.register(
    admin,
    URL.DELETE_PLAN,
    "pms_api.admin.routes:DeletePlanView",
    endpoint="delete_plan",
    methods=["DELETE"],
)

URL.register(
    admin,
    URL.UPDATE_PLAN,
    "pms_api.admin.routes:UpdatePlanView",
    endpoint="update_plan",
    methods=["PATCH"],
)

URL.register(
    admin,
    URL.TENANT_SUBSCRIPTION,
    "pms_api.admin.routes:TenantSubscriptionView",
    endpoint="tenant_subscription",
    methods=["GET"],
)

URL.register(
    admin,
    URL.SUBSCRIPTION_HISTORY,
    "pms_api.admin.routes:SubscriptionHistoryView",
    endpoint="subscription_history",
    methods=["GET"],
)

URL.register(
    admin,
    URL.UPDATE_SUBSCRIPTION,
    "pms_api.admin.routes:UpdateSubscriptionView",
    endpoint="update_subscription",
    methods=["PUT"],
)
