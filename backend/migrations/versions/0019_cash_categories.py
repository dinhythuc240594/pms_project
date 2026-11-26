"""Snapshot receipt/expense classifications without changing existing vouchers."""

import sqlalchemy as sa
from alembic import op

revision = "0019_cash_categories"
down_revision = "0018_channel_mapping_lifecycle"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("cash_documents", sa.Column("category_id", sa.String(40)))
    op.add_column("cash_documents", sa.Column("category_name", sa.String(160)))
    op.add_column("cash_documents", sa.Column("category_type", sa.String(7)))
    op.create_foreign_key(
        "fk_cash_documents_tenant_id_category_id_masters",
        "cash_documents",
        "masters",
        ["tenant_id", "category_id"],
        ["tenant_id", "id"],
    )
    op.create_check_constraint(
        "category_snapshot",
        "cash_documents",
        "(category_id IS NULL AND category_name IS NULL AND category_type IS NULL) OR "
        "(category_id IS NOT NULL AND category_name IS NOT NULL "
        "AND length(btrim(category_name)) > 0 AND category_type IS NOT NULL AND "
        "((kind = 'receipt' AND category_type = 'INCOME') "
        "OR (kind = 'expense' AND category_type = 'EXPENSE') "
        "OR (kind = 'reversal' AND category_type IN ('INCOME','EXPENSE'))))",
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (
        SELECT 1 FROM cash_documents WHERE category_id IS NOT NULL
    ) THEN RAISE EXCEPTION 'Cashbook category history exists; downgrade refused'; END IF; END $$""")
    op.drop_constraint("category_snapshot", "cash_documents", type_="check")
    op.drop_constraint(
        "fk_cash_documents_tenant_id_category_id_masters", "cash_documents", type_="foreignkey"
    )
    op.drop_column("cash_documents", "category_type")
    op.drop_column("cash_documents", "category_name")
    op.drop_column("cash_documents", "category_id")
