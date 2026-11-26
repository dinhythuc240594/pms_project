"""Tenant cleaning teams, shifts, versioned room work and immutable workflow logs."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import protect_table, unprotect_table

revision = "0006_housekeeping"
down_revision = "0005_finance"
branch_labels = None
depends_on = None
TABLES = ("housekeeping_staff", "housekeeping_shifts", "housekeeping_tasks", "housekeeping_logs")


def scoped(name, *columns):
    op.create_table(
        name,
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        *columns,
        sa.UniqueConstraint("tenant_id", "id"),
    )
    protect_table(name)


def ref(columns, table, targets):
    return sa.ForeignKeyConstraint(
        ["tenant_id", *columns],
        [f"{table}.tenant_id", *[f"{table}.{target}" for target in targets]],
    )


def upgrade():
    op.add_column(
        "physical_rooms",
        sa.Column("housekeeping_revision", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("physical_rooms", "housekeeping_revision", server_default=None)
    op.drop_constraint(op.f("ck_physical_rooms_valid_condition"), "physical_rooms", type_="check")
    op.create_check_constraint(
        "valid_condition",
        "physical_rooms",
        "condition IN ('clean','dirty','inspection','maintenance')",
    )
    op.create_check_constraint(
        "housekeeping_revision", "physical_rooms", "housekeeping_revision >= 0"
    )
    scoped(
        "housekeeping_staff",
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("phone", sa.String(40), nullable=False),
        sa.Column("user_id", sa.String(40)),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id"),
        ref(["user_id"], "tenant_users", ["user_id"]),
    )
    scoped(
        "housekeeping_shifts",
        sa.Column("staff_id", sa.String(40), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("note", sa.String(500), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("tenant_id", "id", "staff_id"),
        ref(["staff_id"], "housekeeping_staff", ["id"]),
        sa.CheckConstraint("end_time > start_time", name="positive_shift"),
    )
    op.execute("""ALTER TABLE housekeeping_shifts ADD CONSTRAINT housekeeping_shifts_no_overlap
        EXCLUDE USING gist (tenant_id WITH =, staff_id WITH =,
        tsrange(date + start_time, date + end_time, '[)') WITH &&) WHERE (active)""")
    scoped(
        "housekeeping_tasks",
        sa.Column("room_id", sa.String(40), nullable=False),
        sa.Column("reservation_id", sa.String(40)),
        sa.Column("staff_id", sa.String(40)),
        sa.Column("shift_id", sa.String(40)),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("source_key", sa.String(160), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("note", sa.String(1000), nullable=False),
        sa.Column("room_revision", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("tenant_id", "source_key"),
        ref(["room_id"], "physical_rooms", ["id"]),
        ref(["reservation_id"], "reservations", ["id"]),
        ref(["staff_id"], "housekeeping_staff", ["id"]),
        ref(["shift_id", "staff_id"], "housekeeping_shifts", ["id", "staff_id"]),
        sa.CheckConstraint(
            "kind IN ('arrival','departure','stayover','dirty','checkout')", name="kind"
        ),
        sa.CheckConstraint(
            "status IN ('pending','in_progress','inspection','completed','cancelled')",
            name="status",
        ),
        sa.CheckConstraint("revision > 0 AND room_revision >= 0", name="positive_revision"),
        sa.CheckConstraint("shift_id IS NULL OR staff_id IS NOT NULL", name="assigned_shift"),
    )
    scoped(
        "housekeeping_logs",
        sa.Column("task_id", sa.String(40)),
        sa.Column("room_id", sa.String(40)),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event", sa.String(80), nullable=False),
        sa.Column("details", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        ref(["task_id"], "housekeeping_tasks", ["id"]),
        ref(["room_id"], "physical_rooms", ["id"]),
    )
    op.execute(
        "CREATE TRIGGER housekeeping_logs_append_only BEFORE UPDATE OR DELETE ON housekeeping_logs FOR EACH ROW EXECUTE FUNCTION pms_reject_record_change()"
    )
    op.create_index(
        "ix_housekeeping_tasks_tenant_date", "housekeeping_tasks", ["tenant_id", "date"]
    )
    op.create_index(
        "ix_housekeeping_tasks_room_status",
        "housekeeping_tasks",
        ["tenant_id", "room_id", "status"],
    )
    op.create_index(
        "ix_housekeeping_logs_tenant_created", "housekeeping_logs", ["tenant_id", "created_at"]
    )


def downgrade():
    for name in reversed(TABLES):
        unprotect_table(name)
        op.drop_table(name)
    # Preserve inspection rooms as dirty when rolling back to the previous condition vocabulary.
    op.execute("SET LOCAL app.is_system = 'true'")
    op.execute("UPDATE physical_rooms SET condition='dirty' WHERE condition='inspection'")
    op.drop_constraint(op.f("ck_physical_rooms_valid_condition"), "physical_rooms", type_="check")
    op.drop_constraint(
        op.f("ck_physical_rooms_housekeeping_revision"), "physical_rooms", type_="check"
    )
    op.create_check_constraint(
        "valid_condition", "physical_rooms", "condition IN ('clean','dirty','maintenance')"
    )
    op.drop_column("physical_rooms", "housekeeping_revision")
