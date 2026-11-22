"""Finite feature catalog, global switches and tenant-scoped grants."""

from ..core_models import utcnow
from ..extensions import db

FEATURE_CATALOG = {
    code: f"i18n:features.{code}"
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
        "OTA_SYNC",
        "REPORTS_ADVANCED",
        "INVENTORY_WAREHOUSE",
        "MULTI_CURRENCY",
        "VOUCHER_PROMO",
        "API_EXTERNAL",
    )
}
FEATURE_CODE_CHECK = "code IN (" + ",".join(f"'{code}'" for code in FEATURE_CATALOG) + ")"


class FeatureControl(db.Model):
    __tablename__ = "feature_controls"
    code = db.Column(db.String(40), primary_key=True)
    enabled_global = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (db.CheckConstraint(FEATURE_CODE_CHECK, name="known_code"),)


class TenantFeatureOverride(db.Model):
    __tablename__ = "tenant_feature_overrides"
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), primary_key=True)
    code = db.Column(db.String(40), primary_key=True)
    enabled = db.Column(db.Boolean, nullable=False)
    is_trial = db.Column(db.Boolean, nullable=False, default=False)
    expires_at = db.Column(db.DateTime(timezone=True))
    notes = db.Column(db.String(1000), nullable=False, default="")
    granted_by = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    granted_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        db.CheckConstraint(FEATURE_CODE_CHECK, name="known_code"),
        db.CheckConstraint(
            "NOT is_trial OR (enabled AND expires_at IS NOT NULL)", name="bounded_trial"
        ),
    )
