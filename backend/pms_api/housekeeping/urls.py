"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    LIST_STAFF = "/staff"
    CREATE_STAFF = "/staff"
    UPDATE_STAFF = "/staff/<staff_id>"
    LIST_SHIFTS = "/shifts"
    CREATE_SHIFT = "/shifts"
    UPDATE_SHIFT = "/shifts/<shift_id>"
    LIST_TASKS = "/tasks"
    GENERATE_PLAN = "/tasks"
    CREATE_MANUAL_TASK = "/tasks/manual"
    ASSIGN_TASK = "/tasks/<task_id>/assign"
    CHANGE_TASK_STATUS = "/tasks/<task_id>/status"


housekeeping = Blueprint(
    "housekeeping", __name__, url_prefix="/api/tenants/<tenant_id>/housekeeping"
)

URL.register(
    housekeeping,
    URL.LIST_STAFF,
    "pms_api.housekeeping.routes:ListStaffView",
    endpoint="list_staff",
    methods=["GET"],
)

URL.register(
    housekeeping,
    URL.CREATE_STAFF,
    "pms_api.housekeeping.routes:CreateStaffView",
    endpoint="create_staff",
    methods=["POST"],
)

URL.register(
    housekeeping,
    URL.UPDATE_STAFF,
    "pms_api.housekeeping.routes:UpdateStaffView",
    endpoint="update_staff",
    methods=["PATCH"],
)

URL.register(
    housekeeping,
    URL.LIST_SHIFTS,
    "pms_api.housekeeping.routes:ListShiftsView",
    endpoint="list_shifts",
    methods=["GET"],
)

URL.register(
    housekeeping,
    URL.CREATE_SHIFT,
    "pms_api.housekeeping.routes:CreateShiftView",
    endpoint="create_shift",
    methods=["POST"],
)

URL.register(
    housekeeping,
    URL.UPDATE_SHIFT,
    "pms_api.housekeeping.routes:UpdateShiftView",
    endpoint="update_shift",
    methods=["PATCH"],
)

URL.register(
    housekeeping,
    URL.LIST_TASKS,
    "pms_api.housekeeping.routes:ListTasksView",
    endpoint="list_tasks",
    methods=["GET"],
)

URL.register(
    housekeeping,
    URL.GENERATE_PLAN,
    "pms_api.housekeeping.routes:GeneratePlanView",
    endpoint="generate_plan",
    methods=["POST"],
)

URL.register(
    housekeeping,
    URL.ASSIGN_TASK,
    "pms_api.housekeeping.routes:AssignTaskView",
    endpoint="assign_task",
    methods=["POST"],
)

URL.register(
    housekeeping,
    URL.CREATE_MANUAL_TASK,
    "pms_api.housekeeping.routes:CreateManualTaskView",
    endpoint="create_manual_task",
    methods=["POST"],
)

URL.register(
    housekeeping,
    URL.CHANGE_TASK_STATUS,
    "pms_api.housekeeping.routes:ChangeTaskStatusView",
    endpoint="change_task_status",
    methods=["POST"],
)
