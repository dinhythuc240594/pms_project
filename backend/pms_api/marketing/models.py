"""Marketing persistence. Composite foreign keys bind every child to its tenant/page."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from ..extensions import db

JSON = db.JSON().with_variant(JSONB(), "postgresql")


def uid():
    return str(uuid4())


def utcnow():
    return datetime.now(UTC)


class TenantRow:
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)


class MarketingSite(TenantRow, db.Model):
    __tablename__ = "marketing_sites"
    public_slug = db.Column(db.String(80), nullable=False, unique=True)
    brand = db.Column(JSON, nullable=False, default=dict)
    version = db.Column(db.Integer, nullable=False, default=1)
    __table_args__ = (UniqueConstraint("tenant_id"), UniqueConstraint("tenant_id", "id"))


class MarketingAsset(TenantRow, db.Model):
    __tablename__ = "marketing_assets"
    data = db.Column(db.LargeBinary, nullable=False)
    checksum = db.Column(db.String(64), nullable=False)
    content_type = db.Column(db.String(40), nullable=False)
    width = db.Column(db.Integer, nullable=False)
    height = db.Column(db.Integer, nullable=False)
    __table_args__ = (UniqueConstraint("tenant_id", "checksum"),)


class MarketingPage(TenantRow, db.Model):
    __tablename__ = "marketing_pages"
    site_id = db.Column(db.String(40), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    version = db.Column(db.Integer, nullable=False, default=1)
    revision_number = db.Column(db.Integer, nullable=False, default=0)
    working_revision_id = db.Column(db.String(40))
    published_release_id = db.Column(db.String(40))
    published_slug = db.Column(db.String(80))
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("site_id", "published_slug"),
        ForeignKeyConstraint(
            ["tenant_id", "site_id"], ["marketing_sites.tenant_id", "marketing_sites.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "id", "working_revision_id"],
            [
                "marketing_revisions.tenant_id",
                "marketing_revisions.page_id",
                "marketing_revisions.id",
            ],
            name="fk_marketing_page_working_revision",
            use_alter=True,
        ),
        ForeignKeyConstraint(
            ["tenant_id", "id", "published_release_id"],
            ["marketing_releases.tenant_id", "marketing_releases.page_id", "marketing_releases.id"],
            name="fk_marketing_page_published_release",
            use_alter=True,
        ),
        CheckConstraint("version > 0 AND revision_number >= 0", name="positive_version"),
    )


class PageRow(TenantRow):
    page_id = db.Column(db.String(40), nullable=False)


def page_fk():
    return ForeignKeyConstraint(
        ["tenant_id", "page_id"], ["marketing_pages.tenant_id", "marketing_pages.id"]
    )


def revision_fk():
    return ForeignKeyConstraint(
        ["tenant_id", "page_id", "revision_id"],
        ["marketing_revisions.tenant_id", "marketing_revisions.page_id", "marketing_revisions.id"],
    )


class MarketingRevision(PageRow, db.Model):
    __tablename__ = "marketing_revisions"
    number = db.Column(db.Integer, nullable=False)
    document = db.Column(JSON, nullable=False)
    content_hash = db.Column(db.String(64), nullable=False)
    created_by = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    source = db.Column(db.String(30), nullable=False, default="manual")
    __table_args__ = (
        UniqueConstraint("tenant_id", "page_id", "id"),
        UniqueConstraint("page_id", "number"),
        page_fk(),
    )


class MarketingArtifact(PageRow, db.Model):
    __tablename__ = "marketing_render_artifacts"
    revision_id = db.Column(db.String(40), nullable=False)
    manifest_hash = db.Column(db.String(64), nullable=False)
    renderer_version = db.Column(db.String(30), nullable=False)
    html = db.Column(db.Text, nullable=False)
    public_path = db.Column(db.String(240), nullable=False)
    __table_args__ = (
        UniqueConstraint("tenant_id", "page_id", "revision_id", "id"),
        UniqueConstraint("page_id", "revision_id", "manifest_hash"),
        revision_fk(),
    )


class MarketingReview(PageRow, db.Model):
    __tablename__ = "marketing_reviews"
    revision_id = db.Column(db.String(40), nullable=False)
    artifact_id = db.Column(db.String(40), nullable=False)
    manifest_hash = db.Column(db.String(64), nullable=False)
    decision = db.Column(db.String(30), nullable=False)
    checklist = db.Column(JSON, nullable=False)
    note = db.Column(db.Text, nullable=False, default="")
    actor_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    __table_args__ = (
        UniqueConstraint("tenant_id", "page_id", "revision_id", "artifact_id", "id"),
        ForeignKeyConstraint(
            ["tenant_id", "page_id", "revision_id", "artifact_id"],
            [
                "marketing_render_artifacts.tenant_id",
                "marketing_render_artifacts.page_id",
                "marketing_render_artifacts.revision_id",
                "marketing_render_artifacts.id",
            ],
        ),
        CheckConstraint("decision IN ('approved','changes_requested')", name="review_decision"),
    )


class MarketingRelease(PageRow, db.Model):
    __tablename__ = "marketing_releases"
    revision_id = db.Column(db.String(40), nullable=False)
    artifact_id = db.Column(db.String(40), nullable=False)
    approval_id = db.Column(db.String(40), nullable=False)
    published_slug = db.Column(db.String(80), nullable=False)
    created_by = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    __table_args__ = (
        UniqueConstraint("tenant_id", "page_id", "id"),
        UniqueConstraint("page_id", "approval_id"),
        ForeignKeyConstraint(
            ["tenant_id", "page_id", "revision_id", "artifact_id", "approval_id"],
            [
                "marketing_reviews.tenant_id",
                "marketing_reviews.page_id",
                "marketing_reviews.revision_id",
                "marketing_reviews.artifact_id",
                "marketing_reviews.id",
            ],
        ),
    )


class MarketingPublication(PageRow, db.Model):
    """Public projection: contains only the currently published HTML, never drafts/prompts."""

    __tablename__ = "marketing_publications"
    site_slug = db.Column(db.String(80), nullable=False)
    page_slug = db.Column(db.String(80), nullable=False)
    release_id = db.Column(db.String(40), nullable=False)
    html = db.Column(db.Text, nullable=False)
    etag = db.Column(db.String(64), nullable=False)
    __table_args__ = (
        UniqueConstraint("tenant_id", "page_id"),
        UniqueConstraint("site_slug", "page_slug"),
        ForeignKeyConstraint(
            ["tenant_id", "page_id", "release_id"],
            ["marketing_releases.tenant_id", "marketing_releases.page_id", "marketing_releases.id"],
        ),
    )


class MarketingIntent(PageRow, db.Model):
    __tablename__ = "marketing_intents"
    actor_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    key = db.Column(db.String(100), nullable=False)
    operation = db.Column(db.String(40), nullable=False)
    input_hash = db.Column(db.String(64), nullable=False)
    response = db.Column(JSON, nullable=False)
    __table_args__ = (UniqueConstraint("tenant_id", "actor_id", "key"), page_fk())


class MarketingGeneration(PageRow, db.Model):
    __tablename__ = "marketing_generation_jobs"
    base_revision_id = db.Column(db.String(40), nullable=False)
    requested_by = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    input_snapshot = db.Column(JSON, nullable=False)
    input_hash = db.Column(db.String(64), nullable=False)
    idempotency_key = db.Column(db.String(100), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="queued")
    lease_token = db.Column(db.String(40))
    lease_until = db.Column(db.DateTime(timezone=True))
    result = db.Column(JSON)
    usage = db.Column(JSON)
    error_code = db.Column(db.String(50))
    applied_revision_id = db.Column(db.String(40))
    __table_args__ = (
        UniqueConstraint("tenant_id", "requested_by", "idempotency_key"),
        page_fk(),
        ForeignKeyConstraint(
            ["tenant_id", "page_id", "base_revision_id"],
            [
                "marketing_revisions.tenant_id",
                "marketing_revisions.page_id",
                "marketing_revisions.id",
            ],
        ),
        CheckConstraint(
            "status IN ('queued','running','succeeded','failed','unknown','cancelled')",
            name="job_status",
        ),
    )
