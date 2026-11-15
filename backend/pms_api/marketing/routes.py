"""HTTP boundary: authenticate tenant, authorize owner, then dispatch transactions."""

from functools import wraps

from flask import abort, current_app, g, jsonify, request
from sqlalchemy import select

from common import ApiError

from ..extensions import db
from ..security import payload, require_tenant, set_context
from . import application as service
from .documents import TEMPLATES, safe_url, text, validate_document
from .models import MarketingIntent, MarketingPage, MarketingPublication, MarketingRelease
from .rendering import html_response, render_page


def owner(action):
    def decorate(view):
        @wraps(view)
        def allowed(*args, **kwargs):
            if not current_app.config.get("MARKETING_ENABLED", True):
                raise ApiError(
                    403, "marketing_disabled", "Chức năng trang giới thiệu chưa được bật."
                )
            if g.role != "HOTEL_OWNER":
                raise ApiError(403, "forbidden", "Chỉ chủ khách sạn được quản lý trang giới thiệu.")
            if not service.feature_enabled(g.tenant.id):
                raise ApiError(
                    403,
                    "marketing_feature_disabled",
                    "Trang giới thiệu đang tắt trong gói dịch vụ của khách sạn.",
                )
            return view(*args, **kwargs)

        return require_tenant(action)(allowed)

    return decorate


def body():
    data = payload()
    if not isinstance(data, dict):
        raise ApiError(422, "invalid_payload", "Yêu cầu phải là một đối tượng JSON.")
    return data


def audit(event, page_id, details=None):
    # Marketing does not enqueue channel audit jobs or read guest/booking data.
    from ..audit_ip import capture_request_ip
    from ..core_models import AuditLog

    address, source = capture_request_ip()
    db.session.add(
        AuditLog(
            tenant_id=g.tenant.id,
            user_id=g.user.id,
            event="marketing." + event,
            entity_type="marketing_page",
            entity_id=page_id,
            details=details or {},
            ip_address=address,
            ip_source=source,
        )
    )


def origin():
    configured = current_app.config.get("MARKETING_PUBLIC_ORIGIN")
    if configured:
        return configured
    if current_app.config.get("APP_ENV") != "production":
        return request.host_url.rstrip("/")
    raise ApiError(503, "marketing_origin_missing", "Chưa cấu hình địa chỉ công khai của trang.")


@owner("marketing.view")
def templates(tenant_id):
    from .generation import ai_available

    return jsonify(
        templates=TEMPLATES,
        aiAvailable=ai_available(),
        dailyLimit=current_app.config.get("MARKETING_AI_DAILY_LIMIT", 20),
    )


def brand_read(tenant_id):
    site = service.get_site(tenant_id)
    return {
        "version": site.version if site else 0,
        "publicSlug": site.public_slug if site else None,
        "profile": site.brand if site else {},
    }


@owner("marketing.view")
def brand(tenant_id):
    if request.method == "PUT":
        return save_brand(tenant_id)
    return jsonify(brand_read(tenant_id))


@owner("marketing.write")
def save_brand(tenant_id):
    data = body()
    site = service.get_site(tenant_id)
    expected = data.get("expectedVersion")
    if type(expected) is not int or expected != (site.version if site else 0):
        raise ApiError(409, "marketing_revision_conflict", "Hồ sơ đã thay đổi. Vui lòng tải lại.")
    profile = data.get("profile", {})
    if not isinstance(profile, dict) or set(profile) - {
        "publicName",
        "description",
        "address",
        "contactUrl",
        "facts",
    }:
        raise ApiError(422, "invalid_brand", "Hồ sơ thương hiệu không hợp lệ.")
    clean = {
        key: text(profile.get(key, ""), limit, key, required=False)
        for key, limit in (
            ("publicName", 160),
            ("description", 2000),
            ("address", 400),
            ("facts", 4000),
        )
    }
    clean["contactUrl"] = safe_url(profile.get("contactUrl", ""), optional=True)
    site = site or service.get_site(tenant_id, g.tenant.name)
    site.brand = clean
    site.version += 1
    audit("brand_saved", site.id)
    db.session.flush()
    return jsonify(brand_read(tenant_id))


@owner("marketing.view")
def pages(tenant_id):
    if request.method == "POST":
        return create_page(tenant_id)
    try:
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        raise ApiError(422, "invalid_offset", "Vị trí danh sách không hợp lệ.") from None
    items = db.session.scalars(
        select(MarketingPage)
        .where(
            MarketingPage.tenant_id == tenant_id,
        )
        .order_by(MarketingPage.updated_at.desc(), MarketingPage.id)
        .offset(offset)
        .limit(51)
    ).all()
    return jsonify(pages=[service.page_summary(p) for p in items[:50]], hasMore=len(items) > 50)


@owner("marketing.write")
def create_page(tenant_id):
    from .documents import checksum

    data = body()
    key = text(request.headers.get("Idempotency-Key", ""), 100, "Mã thao tác")
    previous = db.session.scalar(
        select(MarketingIntent).where(
            MarketingIntent.tenant_id == tenant_id,
            MarketingIntent.actor_id == g.user.id,
            MarketingIntent.key == key,
        )
    )
    if previous:
        if previous.operation != "create" or previous.input_hash != checksum(data):
            raise ApiError(
                409, "idempotency_conflict", "Mã thao tác đã được dùng cho yêu cầu khác."
            )
        return jsonify(previous.response), 201
    page = service.create_page(tenant_id, g.user.id, g.tenant.name, data)
    audit("created", page.id)
    return jsonify(
        service.remember_intent(page, g.user.id, key, "create", data, service.detail(page))
    ), 201


@owner("marketing.view")
def page(tenant_id, page_id):
    return jsonify(service.detail(service.get_page(tenant_id, page_id)))


@owner("marketing.write")
def revisions(tenant_id, page_id):
    data = body()
    page = service.get_page(tenant_id, page_id, lock=True)
    service.expect_version(page, data)
    if data.get("baseRevisionId") != page.working_revision_id:
        raise ApiError(
            409, "marketing_revision_conflict", "Bản nháp đã thay đổi. Vui lòng tải lại."
        )
    service.save_revision(page, data.get("document"), g.user.id)
    audit("draft_saved", page.id, {"revisionId": page.working_revision_id})
    return jsonify(service.detail(page))


@owner("marketing.view")
def preview(tenant_id, page_id):
    from .assets import image_resolver

    page = service.get_page(tenant_id, page_id)
    document = validate_document(body().get("document"))
    site = service.get_site(tenant_id)
    html, _ = render_page(
        document,
        origin() + f"/p/{site.public_slug}/{document['slug']}",
        image_resolver=image_resolver(tenant_id),
    )
    return jsonify(html=html, pageId=page.id)


@owner("marketing.review")
def review_requests(tenant_id, page_id):
    page = service.get_page(tenant_id, page_id, lock=True)
    artifact = service.prepare_review(page, body(), origin())
    return jsonify(
        artifactId=artifact.id,
        manifestHash=artifact.manifest_hash,
        revisionId=artifact.revision_id,
        html=artifact.html,
        publicPath=artifact.public_path,
    )


@owner("marketing.view")
def artifact(tenant_id, page_id, artifact_id):
    artifact = service.get_artifact(service.get_page(tenant_id, page_id), artifact_id)
    return html_response(artifact.html, preview=True)


@owner("marketing.review")
def reviews(tenant_id, page_id):
    page = service.get_page(tenant_id, page_id, lock=True)
    review = service.add_review(page, g.user.id, body())
    audit("reviewed", page.id, {"revisionId": review.revision_id, "decision": review.decision})
    return jsonify(service.detail(page))


def publication_action(tenant_id, page_id, operation):
    page = service.get_page(tenant_id, page_id, lock=True)
    data = body()
    key = request.headers.get("Idempotency-Key", "")
    replay = service.replay_intent(page, g.user.id, key, operation, data)
    if replay:
        return jsonify(replay)
    result = getattr(service, operation)(page, g.user.id, data, key)
    audit(operation, page.id, {"releaseId": page.published_release_id})
    return jsonify(result)


@owner("marketing.publish")
def publish_page(tenant_id, page_id):
    return publication_action(tenant_id, page_id, "publish")


@owner("marketing.unpublish")
def unpublish_page(tenant_id, page_id):
    return publication_action(tenant_id, page_id, "unpublish")


@owner("marketing.publish")
def restore_page(tenant_id, page_id):
    return publication_action(tenant_id, page_id, "restore")


@owner("marketing.view")
def releases(tenant_id, page_id):
    page = service.get_page(tenant_id, page_id)
    rows = db.session.scalars(
        select(MarketingRelease)
        .where(
            MarketingRelease.tenant_id == tenant_id,
            MarketingRelease.page_id == page.id,
        )
        .order_by(MarketingRelease.created_at.desc())
        .limit(100)
    ).all()
    return jsonify(
        releases=[
            {
                "id": row.id,
                "revisionNumber": service.get_revision(page, row.revision_id).number,
                "createdAt": row.created_at.isoformat(),
                "isLive": row.id == page.published_release_id,
                "slug": row.published_slug,
            }
            for row in rows
        ]
    )


@owner("marketing.generate")
def generations(tenant_id, page_id):
    from .generation import enqueue, job_data

    job = enqueue(
        service.get_page(tenant_id, page_id, lock=True),
        g.user.id,
        body(),
        request.headers.get("Idempotency-Key", ""),
    )
    return jsonify(job_data(job)), 202


@owner("marketing.view")
def generation(tenant_id, job_id):
    from .generation import get_job, job_data

    return jsonify(job_data(get_job(tenant_id, job_id)))


@owner("marketing.write")
def apply_generation(tenant_id, job_id):
    from .generation import apply_result, get_job

    job = get_job(tenant_id, job_id)
    page = service.get_page(tenant_id, job.page_id, lock=True)
    apply_result(page, job, g.user.id, body())
    audit("ai_applied", page.id, {"jobId": job.id, "revisionId": page.working_revision_id})
    return jsonify(service.detail(page))


@owner("marketing.write")
def assets(tenant_id):
    from .assets import upload

    asset = upload(tenant_id, body().get("data"))
    return jsonify(
        id=asset.id,
        url=f"/api/tenants/{tenant_id}/marketing/assets/{asset.id}",
        width=asset.width,
        height=asset.height,
    ), 201


@owner("marketing.view")
def asset_file(tenant_id, asset_id):
    from flask import Response

    from .assets import get_asset

    asset = get_asset(tenant_id, asset_id)
    response = Response(asset.data, content_type=asset.content_type)
    response.headers["Content-Disposition"] = 'inline; filename="hotel-image.jpg"'
    return response


def public_page(site_slug, page_slug):
    from ..core_models import Tenant

    try:
        set_context()
        # Only this projection has an anonymous SELECT policy. No drafts/prompts are queried.
        publication = db.session.scalar(
            select(MarketingPublication).where(
                MarketingPublication.site_slug == site_slug,
                MarketingPublication.page_slug == page_slug,
            )
        )
        if publication is None:
            abort(404)
        # Narrow tenant context solely to recheck current status, without SYSTEM/service bypass.
        set_context(tenant_id=publication.tenant_id)
        status = db.session.scalar(select(Tenant.status).where(Tenant.id == publication.tenant_id))
        if status != "active":
            abort(404)
        response = html_response(publication.html)
        response.set_etag(publication.etag)
        response.make_conditional(request)
        return response
    finally:
        db.session.rollback()
