"""Protect SaaS tenant records and add stable two-plan terms without replacing history."""

import json

import sqlalchemy as sa
from alembic import op

from pms_api.rls import append_only, protect_table, unprotect_table

revision = "0007_subscription_controls"
down_revision = "cdb4bc7d62d0"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("plans", sa.Column("code", sa.String(12)))
    op.add_column("plans", sa.Column("price_year", sa.Numeric(19, 4)))
    op.add_column("plans", sa.Column("max_users", sa.Integer()))
    for column, definition in (
        ("plan_name", sa.String(100)),
        ("plan_code", sa.String(12)),
        ("previous_plan_id", sa.String(40)),
        ("cycle", sa.String(12)),
        ("status", sa.String(20)),
    ):
        op.add_column("subscription_history", sa.Column(column, definition))
    op.create_foreign_key(
        "fk_subscription_history_previous_plan_id_plans",
        "subscription_history",
        "plans",
        ["previous_plan_id"],
        ["id"],
    )
    for name, condition in (
        ("commercial_code", "code IS NULL OR code IN ('FREE','PRO')"),
        ("finite_price", "price >= 0 AND price < 'Infinity'::numeric"),
        (
            "finite_year_price",
            "price_year IS NULL OR (price_year >= 0 AND price_year < 'Infinity'::numeric)",
        ),
        ("positive_room_limit", "max_rooms IS NULL OR max_rooms > 0"),
        ("positive_user_limit", "max_users IS NULL OR max_users > 0"),
    ):
        # Preserve pre-existing operator data while enforcing constraints on new writes.
        op.create_check_constraint(name, "plans", condition, postgresql_not_valid=True)
    op.create_index(
        "uq_plans_active_code",
        "plans",
        ["code"],
        unique=True,
        postgresql_where=sa.text("active AND code IS NOT NULL"),
    )
    for table in ("subscriptions", "subscription_history"):
        protect_table(table)
    append_only("subscription_history")
    op.create_index(
        "ix_subscription_history_tenant_created",
        "subscription_history",
        ["tenant_id", "created_at"],
    )
    # Install the advertised baseline only on an empty catalog. Existing operator plans stay intact.
    if not op.get_bind().scalar(sa.text("SELECT EXISTS(SELECT 1 FROM plans)")):
        core = {
            code: True
            for code in (
                "DASHBOARD",
                "ROOM_DIAGRAM",
                "RESERVATION_VIEW",
                "RESERVATION_CREATE",
                "TAPE_CHART",
                "ARI_MANAGEMENT",
                "HOUSEKEEPING",
                "POS_SALES",
                "CASHBOOK",
                "REPORTS_BASIC",
            )
        }
        advanced = (
            "OTA_SYNC",
            "REPORTS_ADVANCED",
            "INVENTORY_WAREHOUSE",
            "MULTI_CURRENCY",
            "VOUCHER_PROMO",
            "API_EXTERNAL",
        )
        for code, name, price, annual, rooms, users in (
            ("FREE", "Miễn Phí", "0", "0", 30, 5),
            ("PRO", "Chuyên Nghiệp", "2500000", "25000000", None, None),
        ):
            op.get_bind().execute(
                sa.text("""INSERT INTO plans
                (id,code,name,price,price_year,currency,max_rooms,max_users,features,active,created_at)
                VALUES (:id,:code,:name,:price,:annual,'VND',:rooms,:users,CAST(:features AS jsonb),true,CURRENT_TIMESTAMP)"""),
                {
                    "id": "plan-" + code.lower(),
                    "code": code,
                    "name": name,
                    "price": price,
                    "annual": annual,
                    "rooms": rooms,
                    "users": users,
                    "features": json.dumps({**core, **dict.fromkeys(advanced, code == "PRO")}),
                },
            )


def downgrade():
    op.drop_index("ix_subscription_history_tenant_created", table_name="subscription_history")
    op.execute("DROP TRIGGER immutable_record ON subscription_history")
    for table in ("subscription_history", "subscriptions"):
        unprotect_table(table)
    op.drop_constraint(
        "fk_subscription_history_previous_plan_id_plans", "subscription_history", type_="foreignkey"
    )
    for column in ("status", "cycle", "previous_plan_id", "plan_code", "plan_name"):
        op.drop_column("subscription_history", column)
    op.drop_index("uq_plans_active_code", table_name="plans")
    for name in (
        "commercial_code",
        "finite_price",
        "finite_year_price",
        "positive_room_limit",
        "positive_user_limit",
    ):
        op.drop_constraint(op.f("ck_plans_" + name), "plans", type_="check")
    for column in ("max_users", "price_year", "code"):
        op.drop_column("plans", column)
