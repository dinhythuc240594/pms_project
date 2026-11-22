"""Private SaaS customer details, separate from settings visible to hotel staff."""

from ..core_models import utcnow
from ..extensions import db


class TenantClientProfile(db.Model):
    __tablename__ = "tenant_client_profiles"
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), primary_key=True)
    contact_name = db.Column(db.String(160))
    contact_email = db.Column(db.String(254))
    contact_phone = db.Column(db.String(40))
    address = db.Column(db.String(500))
    city = db.Column(db.String(160))
    tax_id = db.Column(db.String(40))
    domain = db.Column(db.String(253))
    customer_notes = db.Column(db.String(4000))
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
