"""Separate SaaS administration from owner-granted access to hotel operations."""

from alembic import op

from pms_api.rls import SERVICE, SYSTEM, TENANT, pms_scope

revision = "0034_pms_tenant_authorization"
down_revision = "0033_merge_room_history"
branch_labels = None
depends_on = None

PMS_TABLES = (
    "booking_notes",
    "cash_documents",
    "channel_booking_reviews",
    "channel_bookings",
    "channel_connections",
    "channel_jobs",
    "channel_mappings",
    "channel_revisions",
    "charges",
    "commission_payouts",
    "commission_settlements",
    "daily_rates",
    "day_reconciliations",
    "exchange_rates",
    "guests",
    "housekeeping_logs",
    "housekeeping_shifts",
    "housekeeping_staff",
    "housekeeping_tasks",
    "idempotency_records",
    "inventory_controls",
    "inventory_documents",
    "ledger_entries",
    "masters",
    "notification_settings",
    "payments",
    "physical_rooms",
    "pos_invoice_items",
    "pos_invoices",
    "pos_payments",
    "pos_refunds",
    "pricing_promotions",
    "pricing_rules",
    "pricing_vouchers",
    "refunds",
    "reservation_guests",
    "reservation_nights",
    "reservation_rooms",
    "reservations",
    "room_blocks",
    "room_type_availability",
    "room_types",
    "service_stock_ingredients",
    "service_stock_links",
    "stock_balances",
    "stock_movements",
    "voucher_redemptions",
)
SAAS_EVENTS = (
    "tenant.created",
    "tenant.updated",
    "subscription.updated",
    "system_user.created",
    "system_user.updated",
    "plan.created",
    "plan.updated",
    "plan.deleted",
    "feature.updated",
    "feature_override.upserted",
    "feature_override.deleted",
    "channex.property.created",
)


def upgrade():
    for table in PMS_TABLES:
        scope = pms_scope(table)
        op.execute(f'DROP POLICY tenant_scope ON "{table}"')
        op.execute(f'CREATE POLICY tenant_scope ON "{table}" USING ({scope}) WITH CHECK ({scope})')

    # Membership reads support identity and SaaS contact metadata. Only an actual
    # hotel owner with an ordinary account can delegate/revoke PMS access. A
    # scoped system owner cannot delegate to itself or another system account.
    op.execute("DROP POLICY tenant_scope ON tenant_users")
    op.execute(f"""CREATE POLICY membership_read ON tenant_users FOR SELECT
        USING ({TENANT} OR {SYSTEM} OR {SERVICE})""")
    owner = f"""({SERVICE} OR ({TENANT} AND EXISTS (
        SELECT 1 FROM users actor WHERE actor.id=nullif(current_setting('app.user_id',true),'')
        AND actor.active AND actor.global_role='USER') AND EXISTS (
        SELECT 1 FROM tenant_users owner WHERE owner.tenant_id=tenant_users.tenant_id
        AND owner.user_id=nullif(current_setting('app.user_id',true),'')
        AND owner.active AND owner.role='HOTEL_OWNER')))"""
    # SaaS can bootstrap a new hotel with its first ordinary owner; it cannot
    # alter existing grants or attach a system identity during provisioning.
    bootstrap = f"""({SYSTEM} AND role='HOTEL_OWNER' AND EXISTS (
        SELECT 1 FROM users target WHERE target.id=tenant_users.user_id
        AND target.active AND target.global_role='USER') AND NOT EXISTS (
        SELECT 1 FROM tenant_users existing WHERE existing.tenant_id=tenant_users.tenant_id))"""
    op.execute(f"""CREATE POLICY membership_insert ON tenant_users FOR INSERT
        WITH CHECK ({owner} OR {bootstrap})""")
    op.execute(f"""CREATE POLICY membership_update ON tenant_users FOR UPDATE
        USING ({owner}) WITH CHECK ({owner})""")
    op.execute(f"CREATE POLICY membership_delete ON tenant_users FOR DELETE USING ({owner})")

    # SaaS activity has a finite event vocabulary. Operational audit details and
    # exports remain under the same hotel membership policy as their source data.
    events = ",".join(f"'{event}'" for event in SAAS_EVENTS)
    audit_scope = (
        f"({pms_scope('audit_logs')} OR ({SYSTEM} AND (tenant_id IS NULL OR event IN ({events}))))"
    )
    op.execute("DROP POLICY tenant_scope ON audit_logs")
    op.execute(f"""CREATE POLICY tenant_scope ON audit_logs
        USING ({audit_scope}) WITH CHECK ({audit_scope})""")

    own = f"""({SERVICE} OR ({pms_scope("notifications")} AND
        recipient_user_id=nullif(current_setting('app.user_id',true),'')))"""
    op.execute("DROP POLICY own_inbox ON notifications")
    op.execute("DROP POLICY own_read ON notifications")
    op.execute("DROP POLICY tenant_delivery ON notifications")
    op.execute(f"CREATE POLICY own_inbox ON notifications FOR SELECT USING ({own})")
    op.execute(f"""CREATE POLICY own_read ON notifications FOR UPDATE
        USING ({own}) WITH CHECK ({own})""")
    op.execute(f"""CREATE POLICY tenant_delivery ON notifications FOR INSERT
        WITH CHECK ({pms_scope("notifications")})""")

    # Narrow SaaS helpers expose only licensed-room quota and fixed bootstrap
    # units. Both restore service scope on return and on errors.
    # Neither helper can return bookings, guest records, finance or room details.
    actor = """EXISTS (SELECT 1 FROM public.users WHERE
        id=nullif(current_setting('app.user_id',true),'') AND active
        AND global_role IN ('SUPER_ADMIN','SYSTEM_MANAGER'))"""
    op.execute(f"""CREATE FUNCTION pms_room_quota_used(hotel_id text) RETURNS bigint
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
        AS $$ DECLARE
            previous_service text := coalesce(current_setting('app.is_service',true),'false');
            used bigint;
        BEGIN
            IF NOT (({SYSTEM}) AND {actor}) THEN
                RAISE EXCEPTION 'Quota access denied' USING ERRCODE='42501'; END IF;
            PERFORM set_config('app.is_service','true',true);
            SELECT count(*) INTO used FROM public.physical_rooms WHERE tenant_id=hotel_id AND active;
            PERFORM set_config('app.is_service',previous_service,true);
            RETURN used;
        EXCEPTION WHEN OTHERS THEN
            PERFORM set_config('app.is_service',previous_service,true);
            RAISE;
        END $$""")
    op.execute(f"""CREATE FUNCTION pms_provision_units(hotel_id text) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
        AS $$ DECLARE
            previous_service text := coalesce(current_setting('app.is_service',true),'false');
        BEGIN
            IF NOT (({SYSTEM}) AND {actor}) THEN
                RAISE EXCEPTION 'Hotel provisioning denied' USING ERRCODE='42501'; END IF;
            PERFORM set_config('app.is_service','true',true);
            IF EXISTS (SELECT 1 FROM public.tenant_users WHERE tenant_id=hotel_id) THEN
                RAISE EXCEPTION 'Hotel provisioning denied' USING ERRCODE='42501'; END IF;
            INSERT INTO public.masters(id,tenant_id,catalog,name,data,active)
                SELECT gen_random_uuid()::text,hotel_id,'units',unit,'{{}}'::jsonb,true
                FROM unnest(ARRAY['Cái','Gói','Chai','Lon','Hộp','Bộ','Kg','Lít','Lần','Đêm']) unit
                ON CONFLICT (tenant_id,catalog,name) DO NOTHING;
            PERFORM set_config('app.is_service',previous_service,true);
        EXCEPTION WHEN OTHERS THEN
            PERFORM set_config('app.is_service',previous_service,true);
            RAISE;
        END $$""")


def downgrade():
    op.execute("DROP FUNCTION pms_provision_units(text)")
    op.execute("DROP FUNCTION pms_room_quota_used(text)")
    for table in (*PMS_TABLES, "audit_logs"):
        op.execute(f'DROP POLICY tenant_scope ON "{table}"')
        op.execute(f"""CREATE POLICY tenant_scope ON "{table}"
            USING ({TENANT} OR {SYSTEM}) WITH CHECK ({TENANT} OR {SYSTEM})""")
    for policy in (
        "membership_read",
        "membership_insert",
        "membership_update",
        "membership_delete",
    ):
        op.execute(f"DROP POLICY {policy} ON tenant_users")
    op.execute(f"""CREATE POLICY tenant_scope ON tenant_users
        USING ({TENANT} OR {SYSTEM}) WITH CHECK ({TENANT} OR {SYSTEM})""")
    for policy in ("own_inbox", "own_read", "tenant_delivery"):
        op.execute(f"DROP POLICY {policy} ON notifications")
    own = f"({TENANT} AND recipient_user_id=nullif(current_setting('app.user_id',true),'')) OR {SYSTEM}"
    op.execute(f"CREATE POLICY own_inbox ON notifications FOR SELECT USING ({own})")
    op.execute(f"""CREATE POLICY own_read ON notifications FOR UPDATE
        USING ({own}) WITH CHECK ({own})""")
    op.execute(f"""CREATE POLICY tenant_delivery ON notifications FOR INSERT
        WITH CHECK ({TENANT} OR {SYSTEM})""")
