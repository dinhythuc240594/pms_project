"""Allow custom plans and register a finite room quantity per subscription."""

import sqlalchemy as sa
from alembic import op

revision = "0015_plan_room_limits"
down_revision = "0014_manager_customers"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.add_column(
        "plans", sa.Column("deleted", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.drop_constraint(op.f("ck_plans_commercial_code"), "plans", type_="check")
    op.create_check_constraint(
        "commercial_code",
        "plans",
        "code IS NULL OR code ~ '^[A-Z][A-Z0-9_]{0,11}$'",
        postgresql_not_valid=True,
    )
    op.add_column("subscriptions", sa.Column("room_count", sa.Integer()))
    # Keep existing finite allowances; uncapped hotels register their current room count.
    op.execute("""UPDATE subscriptions s SET room_count = GREATEST(
        1,
        (SELECT count(*)::integer FROM physical_rooms r
            WHERE r.tenant_id=s.tenant_id AND r.active),
        COALESCE(p.max_rooms, CASE WHEN p.code='FREE' OR (p.code IS NULL AND
            (lower(p.name) LIKE '%free%' OR lower(p.name) LIKE '%miễn phí%'
                OR lower(p.name) LIKE '%mien phi%')) THEN 30 ELSE 1 END)
        ) FROM plans p WHERE p.id=s.plan_id""")
    op.alter_column("subscriptions", "room_count", nullable=False)
    op.create_check_constraint("positive_room_count", "subscriptions", "room_count > 0")
    op.add_column("subscription_history", sa.Column("room_count", sa.Integer()))
    op.create_check_constraint(
        "positive_room_count", "subscription_history", "room_count IS NULL OR room_count > 0"
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF
        EXISTS (SELECT 1 FROM subscriptions) OR
        EXISTS (SELECT 1 FROM subscription_history WHERE room_count IS NOT NULL) OR
        EXISTS (SELECT 1 FROM plans WHERE deleted OR code NOT IN ('FREE','PRO')) THEN
        RAISE EXCEPTION 'Custom plans or registered room quotas exist; downgrade refused';
        END IF; END $$""")
    op.drop_constraint(
        op.f("ck_subscription_history_positive_room_count"), "subscription_history", type_="check"
    )
    op.drop_column("subscription_history", "room_count")
    op.drop_constraint(op.f("ck_subscriptions_positive_room_count"), "subscriptions", type_="check")
    op.drop_column("subscriptions", "room_count")
    op.drop_constraint(op.f("ck_plans_commercial_code"), "plans", type_="check")
    op.create_check_constraint(
        "commercial_code",
        "plans",
        "code IS NULL OR code IN ('FREE','PRO')",
        postgresql_not_valid=True,
    )
    op.drop_column("plans", "deleted")
