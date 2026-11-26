"""Invalidate booking forms after local, OTA and linked guest changes."""

import sqlalchemy as sa
from alembic import op

revision = "0026_booking_versions"
down_revision = "0025_channel_cancel_verify"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "reservations", sa.Column("version", sa.Integer(), nullable=False, server_default="1")
    )
    op.create_check_constraint("ck_reservations_positive_version", "reservations", "version > 0")
    op.execute("""CREATE FUNCTION pms_booking_version() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          NEW.version := OLD.version + 1;
          RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER booking_version BEFORE UPDATE ON reservations
        FOR EACH ROW EXECUTE FUNCTION pms_booking_version()""")
    op.execute("""CREATE FUNCTION pms_guest_booking_versions() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF ROW(NEW.name,NEW.phone,NEW.email,NEW.identity_number,NEW.nationality,NEW.active)
             IS DISTINCT FROM
             ROW(OLD.name,OLD.phone,OLD.email,OLD.identity_number,OLD.nationality,OLD.active) THEN
            UPDATE reservations SET version=version+1
            WHERE tenant_id=NEW.tenant_id AND id IN (
              SELECT reservation_id FROM reservation_guests
              WHERE tenant_id=NEW.tenant_id AND guest_id=NEW.id
            );
          END IF;
          RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER guest_booking_versions AFTER UPDATE ON guests
        FOR EACH ROW EXECUTE FUNCTION pms_guest_booking_versions()""")


def downgrade():
    op.execute("DROP TRIGGER guest_booking_versions ON guests")
    op.execute("DROP FUNCTION pms_guest_booking_versions()")
    op.execute("DROP TRIGGER booking_version ON reservations")
    op.execute("DROP FUNCTION pms_booking_version()")
    op.drop_constraint("ck_reservations_positive_version", "reservations", type_="check")
    op.drop_column("reservations", "version")
