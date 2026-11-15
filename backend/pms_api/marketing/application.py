"""Tenant-scoped draft, approval and publication transactions; no external IO."""

from urllib.parse import urlsplit

from sqlalchemy import delete, select

from common import ApiError

from ..extensions import db
from .documents import (
    CHECKLIST,
    checksum,
    initial_document,
    publish_errors,
    text,
    validate_document,
)
from .models import (
    MarketingArtifact,
    MarketingIntent,
    MarketingPage,
    MarketingPublication,
    MarketingRelease,
    MarketingReview,
    MarketingRevision,
    MarketingSite,
    uid,
    utcnow,
)
from .rendering import RENDERER_VERSION, render_page


def not_found():
    raise ApiError(404, "marketing_not_found", "Không tìm thấy nội dung trong khách sạn này.")


def feature_enabled(tenant_id):
    from ..core_models import Plan, Subscription

    features = db.session.scalar(
        select(Plan.features)
        .join(
            Subscription,
            Subscription.plan_id == Plan.id,
        )
        .where(Subscription.tenant_id == tenant_id)
    )
    return not isinstance(features, dict) or features.get("AI_MARKETING_PAGES") is not False


def get_page(tenant_id, page_id, *, lock=False):
    statement = select(MarketingPage).where(
        MarketingPage.tenant_id == tenant_id,
        MarketingPage.id == page_id,
    )
    page = db.session.scalar(statement.with_for_update() if lock else statement)
    if page is None:
        not_found()
    return page


def get_revision(page, revision_id=None):
    revision = db.session.scalar(
        select(MarketingRevision).where(
            MarketingRevision.tenant_id == page.tenant_id,
            MarketingRevision.page_id == page.id,
            MarketingRevision.id == (revision_id or page.working_revision_id),
        )
    )
    if revision is None:
        not_found()
    return revision


def get_site(tenant_id, hotel_name=None):
    site = db.session.scalar(select(MarketingSite).where(MarketingSite.tenant_id == tenant_id))
    if site is None and hotel_name is not None:
        site = MarketingSite(
            id=uid(), tenant_id=tenant_id, public_slug="hotel-" + uid()[:12], brand={}
        )
        db.session.add(site)
        db.session.flush()
    return site


def expect_version(page, data):
    if type(data.get("expectedVersion")) is not int or data["expectedVersion"] != page.version:
        raise ApiError(
            409,
            "marketing_revision_conflict",
            "Trang đã thay đổi. Tải lại để so sánh trước khi lưu.",
        )


def save_revision(page, document, actor_id, *, source="manual"):
    from .assets import validate_assets

    document = validate_document(document)
    validate_assets(page.tenant_id, document)
    revision = MarketingRevision(
        id=uid(),
        tenant_id=page.tenant_id,
        page_id=page.id,
        number=page.revision_number + 1,
        document=document,
        content_hash=checksum(document),
        created_by=actor_id,
        source=source,
    )
    db.session.add(revision)
    db.session.flush()
    page.working_revision_id = revision.id
    page.revision_number = revision.number
    page.version += 1
    page.updated_at = utcnow()
    db.session.flush()
    return revision


def create_page(tenant_id, actor_id, hotel_name, data):
    name = text(data.get("name", "Trang giới thiệu"), 160, "Tên trang")
    template_id = data.get("templateId", "hotel")
    if template_id not in ("hotel", "campaign", "custom"):
        raise ApiError(422, "invalid_template", "Mẫu trang không hợp lệ.")
    site = get_site(tenant_id, hotel_name)
    page = MarketingPage(
        id=uid(), tenant_id=tenant_id, site_id=site.id, name=name, version=1, revision_number=0
    )
    db.session.add(page)
    db.session.flush()
    brand = site.brand or {}
    document = initial_document(brand.get("publicName") or hotel_name, template_id)
    document["slug"] = "trang-" + page.id[:8]
    if brand.get("contactUrl"):
        document["cta"]["url"] = brand["contactUrl"]
    save_revision(page, document, actor_id, source="template")
    return page


def page_summary(page):
    site = get_site(page.tenant_id)
    live_revision = (
        db.session.scalar(
            select(MarketingRelease.revision_id).where(
                MarketingRelease.tenant_id == page.tenant_id,
                MarketingRelease.page_id == page.id,
                MarketingRelease.id == page.published_release_id,
            )
        )
        if page.published_release_id
        else None
    )
    return {
        "id": page.id,
        "name": page.name,
        "version": page.version,
        "revisionNumber": page.revision_number,
        "workingRevisionId": page.working_revision_id,
        "publishedReleaseId": page.published_release_id,
        "publishedRevisionId": live_revision,
        "publishedUrl": f"/p/{site.public_slug}/{page.published_slug}"
        if page.published_release_id
        else None,
        "siteSlug": site.public_slug,
        "updatedAt": page.updated_at.isoformat(),
    }


def detail(page):
    revision = get_revision(page)
    reviews = db.session.scalars(
        select(MarketingReview)
        .where(
            MarketingReview.tenant_id == page.tenant_id,
            MarketingReview.page_id == page.id,
            MarketingReview.revision_id == revision.id,
        )
        .order_by(MarketingReview.created_at.desc(), MarketingReview.id.desc())
    ).all()
    current_review = reviews[0] if reviews else None
    return {
        **page_summary(page),
        "document": revision.document,
        "contentHash": revision.content_hash,
        "review": (
            {
                "id": current_review.id,
                "decision": current_review.decision,
                "artifactId": current_review.artifact_id,
                "manifestHash": current_review.manifest_hash,
                "note": current_review.note,
            }
            if current_review
            else None
        ),
    }


def prepare_review(page, data, public_origin):
    from .assets import image_resolver

    expect_version(page, data)
    revision = get_revision(page)
    errors = publish_errors(revision.document)
    if errors:
        raise ApiError(
            422, "marketing_review_blocked", "Cần bổ sung nội dung trước khi duyệt.", errors
        )
    site = get_site(page.tenant_id)
    path = f"/p/{site.public_slug}/{revision.document['slug']}"
    parsed = urlsplit(public_origin)
    if parsed.scheme not in ("https", "http") or not parsed.netloc:
        raise ApiError(
            503, "marketing_origin_missing", "Chưa cấu hình địa chỉ công khai của trang."
        )
    html, manifest_hash = render_page(
        revision.document,
        public_origin.rstrip("/") + path,
        image_resolver=image_resolver(page.tenant_id),
    )
    artifact = db.session.scalar(
        select(MarketingArtifact).where(
            MarketingArtifact.tenant_id == page.tenant_id,
            MarketingArtifact.page_id == page.id,
            MarketingArtifact.revision_id == revision.id,
            MarketingArtifact.manifest_hash == manifest_hash,
        )
    )
    if artifact is None:
        artifact = MarketingArtifact(
            id=uid(),
            tenant_id=page.tenant_id,
            page_id=page.id,
            revision_id=revision.id,
            manifest_hash=manifest_hash,
            renderer_version=RENDERER_VERSION,
            html=html,
            public_path=path,
        )
        db.session.add(artifact)
        db.session.flush()
    return artifact


def get_artifact(page, artifact_id):
    artifact = db.session.scalar(
        select(MarketingArtifact).where(
            MarketingArtifact.tenant_id == page.tenant_id,
            MarketingArtifact.page_id == page.id,
            MarketingArtifact.id == artifact_id,
        )
    )
    if artifact is None:
        not_found()
    return artifact


def add_review(page, actor_id, data):
    expect_version(page, data)
    artifact = get_artifact(page, data.get("artifactId"))
    if artifact.revision_id != page.working_revision_id or artifact.manifest_hash != data.get(
        "manifestHash"
    ):
        raise ApiError(
            409, "marketing_revision_conflict", "Bản xem trước không còn khớp bản nháp hiện tại."
        )
    decision = data.get("decision")
    if decision not in ("approved", "changes_requested"):
        raise ApiError(422, "invalid_review", "Quyết định duyệt không hợp lệ.")
    checklist = data.get("checklist", {})
    if not isinstance(checklist, dict) or set(checklist) - set(CHECKLIST):
        raise ApiError(422, "invalid_review", "Danh sách xác nhận không hợp lệ.")
    if decision == "approved" and not all(checklist.get(key) is True for key in CHECKLIST):
        raise ApiError(
            422, "review_incomplete", "Vui lòng xác nhận đầy đủ các mục trước khi duyệt."
        )
    errors = publish_errors(get_revision(page).document)
    if decision == "approved" and errors:
        raise ApiError(422, "marketing_review_blocked", "Nội dung chưa đủ điều kiện duyệt.", errors)
    note = text(data.get("note", ""), 2000, "Ghi chú", required=decision == "changes_requested")
    review = MarketingReview(
        id=uid(),
        tenant_id=page.tenant_id,
        page_id=page.id,
        revision_id=artifact.revision_id,
        artifact_id=artifact.id,
        manifest_hash=artifact.manifest_hash,
        decision=decision,
        checklist=checklist,
        note=note,
        actor_id=actor_id,
    )
    db.session.add(review)
    page.version += 1
    db.session.flush()
    return review


def replay_intent(page, actor_id, key, operation, data):
    key = text(key, 100, "Mã thao tác")
    saved = db.session.scalar(
        select(MarketingIntent).where(
            MarketingIntent.tenant_id == page.tenant_id,
            MarketingIntent.actor_id == actor_id,
            MarketingIntent.key == key,
        )
    )
    if saved:
        if (
            saved.page_id != page.id
            or saved.operation != operation
            or saved.input_hash != checksum(data)
        ):
            raise ApiError(
                409, "idempotency_conflict", "Mã thao tác đã được dùng cho yêu cầu khác."
            )
        return saved.response
    return None


def remember_intent(page, actor_id, key, operation, data, response):
    db.session.add(
        MarketingIntent(
            tenant_id=page.tenant_id,
            page_id=page.id,
            actor_id=actor_id,
            key=key,
            operation=operation,
            input_hash=checksum(data),
            response=response,
        )
    )
    db.session.flush()
    return response


def set_publication(page, release):
    artifact = get_artifact(page, release.artifact_id)
    site = get_site(page.tenant_id)
    duplicate = db.session.scalar(
        select(MarketingPage.id).where(
            MarketingPage.tenant_id == page.tenant_id,
            MarketingPage.site_id == page.site_id,
            MarketingPage.id != page.id,
            MarketingPage.published_slug == release.published_slug,
        )
    )
    if duplicate:
        raise ApiError(409, "marketing_slug_conflict", "Đường dẫn đã được một trang khác sử dụng.")
    db.session.execute(
        delete(MarketingPublication).where(
            MarketingPublication.tenant_id == page.tenant_id,
            MarketingPublication.page_id == page.id,
        )
    )
    db.session.add(
        MarketingPublication(
            id=uid(),
            tenant_id=page.tenant_id,
            page_id=page.id,
            release_id=release.id,
            site_slug=site.public_slug,
            page_slug=release.published_slug,
            html=artifact.html,
            etag=checksum({"release": release.id, "html": artifact.html}),
        )
    )
    page.published_release_id = release.id
    page.published_slug = release.published_slug
    page.version += 1
    page.updated_at = utcnow()
    db.session.flush()


def publish(page, actor_id, data, key):
    replay = replay_intent(page, actor_id, key, "publish", data)
    if replay:
        return replay
    expect_version(page, data)
    if data.get("expectedPublishedReleaseId") != page.published_release_id:
        raise ApiError(409, "marketing_revision_conflict", "Bản công khai đã thay đổi.")
    review = db.session.scalar(
        select(MarketingReview).where(
            MarketingReview.tenant_id == page.tenant_id,
            MarketingReview.page_id == page.id,
            MarketingReview.id == data.get("approvalId"),
        )
    )
    if (
        not review
        or review.decision != "approved"
        or review.revision_id != page.working_revision_id
        or review.manifest_hash != data.get("manifestHash")
    ):
        raise ApiError(
            409, "marketing_approval_required", "Cần duyệt đúng phiên bản trước khi xuất bản."
        )
    latest = db.session.scalar(
        select(MarketingReview.id)
        .where(
            MarketingReview.tenant_id == page.tenant_id,
            MarketingReview.page_id == page.id,
            MarketingReview.revision_id == page.working_revision_id,
        )
        .order_by(MarketingReview.created_at.desc(), MarketingReview.id.desc())
        .limit(1)
    )
    if latest != review.id:
        raise ApiError(
            409,
            "marketing_approval_required",
            "Quyết định duyệt đã thay đổi. Vui lòng kiểm tra lại.",
        )
    release = db.session.scalar(
        select(MarketingRelease).where(
            MarketingRelease.tenant_id == page.tenant_id,
            MarketingRelease.page_id == page.id,
            MarketingRelease.approval_id == review.id,
        )
    )
    if release is None:
        revision = get_revision(page)
        release = MarketingRelease(
            id=uid(),
            tenant_id=page.tenant_id,
            page_id=page.id,
            revision_id=review.revision_id,
            artifact_id=review.artifact_id,
            approval_id=review.id,
            published_slug=revision.document["slug"],
            created_by=actor_id,
        )
        db.session.add(release)
        db.session.flush()
    set_publication(page, release)
    return remember_intent(page, actor_id, key, "publish", data, detail(page))


def unpublish(page, actor_id, data, key):
    replay = replay_intent(page, actor_id, key, "unpublish", data)
    if replay:
        return replay
    expect_version(page, data)
    if data.get("expectedPublishedReleaseId") != page.published_release_id:
        raise ApiError(409, "marketing_revision_conflict", "Bản công khai đã thay đổi.")
    db.session.execute(
        delete(MarketingPublication).where(
            MarketingPublication.tenant_id == page.tenant_id,
            MarketingPublication.page_id == page.id,
        )
    )
    page.published_release_id = None
    page.published_slug = None
    page.version += 1
    db.session.flush()
    return remember_intent(page, actor_id, key, "unpublish", data, detail(page))


def restore(page, actor_id, data, key):
    replay = replay_intent(page, actor_id, key, "restore", data)
    if replay:
        return replay
    expect_version(page, data)
    if data.get("expectedPublishedReleaseId") != page.published_release_id:
        raise ApiError(409, "marketing_revision_conflict", "Bản công khai đã thay đổi.")
    release = db.session.scalar(
        select(MarketingRelease).where(
            MarketingRelease.tenant_id == page.tenant_id,
            MarketingRelease.page_id == page.id,
            MarketingRelease.id == data.get("targetReleaseId"),
        )
    )
    if release is None:
        not_found()
    set_publication(page, release)
    return remember_intent(page, actor_id, key, "restore", data, detail(page))
