"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    LIST_RESERVATIONS = "/api/tenants/<tenant_id>/reservations"
    RESERVATION_DETAIL = "/api/tenants/<tenant_id>/reservations/<reservation_id>"
    CREATE_RESERVATION = "/api/tenants/<tenant_id>/reservations"
    EDIT_RESERVATION = "/api/tenants/<tenant_id>/reservations/<reservation_id>"
    CHANGE_STATUS = "/api/tenants/<tenant_id>/reservations/<reservation_id>/status"
    ROOM_CONDITION = "/api/tenants/<tenant_id>/rooms/<number>/condition"
    ADD_CHARGE = "/api/tenants/<tenant_id>/reservations/<reservation_id>/charges"
    ADD_PAYMENT = "/api/tenants/<tenant_id>/reservations/<reservation_id>/payments"
    REFUND_PAYMENT = (
        "/api/tenants/<tenant_id>/reservations/<reservation_id>/payments/<payment_id>/refund"
    )
    ADJUST_CLOSED_STAY = "/api/tenants/<tenant_id>/reservations/<reservation_id>/adjustments"
    ADD_NOTE = "/api/tenants/<tenant_id>/reservations/<reservation_id>/notes"
    PREVIEW_STAY_CHANGE = "/api/tenants/<tenant_id>/reservations/<reservation_id>/stay-change/preview"
    CONFIRM_STAY_CHANGE = "/api/tenants/<tenant_id>/reservations/<reservation_id>/stay-change"


booking = Blueprint("booking", __name__)

URL.register(booking, URL.PREVIEW_STAY_CHANGE, "pms_api.bookings.stay_changes:PreviewStayChangeView", endpoint="preview_stay_change", methods=["POST"])
URL.register(booking, URL.CONFIRM_STAY_CHANGE, "pms_api.bookings.stay_changes:ConfirmStayChangeView", endpoint="confirm_stay_change", methods=["POST"])

URL.register(
    booking,
    URL.LIST_RESERVATIONS,
    "pms_api.bookings.routes:ListReservationsView",
    endpoint="list_reservations",
    methods=["GET"],
)

URL.register(
    booking,
    URL.RESERVATION_DETAIL,
    "pms_api.bookings.routes:ReservationDetailView",
    endpoint="reservation_detail",
    methods=["GET"],
)

URL.register(
    booking,
    URL.CREATE_RESERVATION,
    "pms_api.bookings.routes:CreateReservationView",
    endpoint="create_reservation",
    methods=["POST"],
)

URL.register(
    booking,
    URL.EDIT_RESERVATION,
    "pms_api.bookings.routes:EditReservationView",
    endpoint="edit_reservation",
    methods=["PATCH"],
)

URL.register(
    booking,
    URL.CHANGE_STATUS,
    "pms_api.bookings.routes:ChangeStatusView",
    endpoint="change_status",
    methods=["POST"],
)

URL.register(
    booking,
    URL.ROOM_CONDITION,
    "pms_api.bookings.routes:RoomConditionView",
    endpoint="room_condition",
    methods=["POST"],
)

URL.register(
    booking,
    URL.ADD_CHARGE,
    "pms_api.bookings.routes:AddChargeView",
    endpoint="add_charge",
    methods=["POST"],
)

URL.register(
    booking,
    URL.ADD_PAYMENT,
    "pms_api.bookings.routes:AddPaymentView",
    endpoint="add_payment",
    methods=["POST"],
)

URL.register(
    booking,
    URL.REFUND_PAYMENT,
    "pms_api.bookings.routes:RefundPaymentView",
    endpoint="refund_payment",
    methods=["POST"],
)

URL.register(
    booking,
    URL.ADJUST_CLOSED_STAY,
    "pms_api.bookings.routes:AdjustClosedStayView",
    endpoint="adjust_closed_stay",
    methods=["POST"],
)

URL.register(
    booking,
    URL.ADD_NOTE,
    "pms_api.bookings.routes:AddNoteView",
    endpoint="add_note",
    methods=["POST"],
)
