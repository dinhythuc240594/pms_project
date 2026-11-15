"""Lazy registration keeps AI and rendering handlers out of application startup."""

from importlib import import_module

from flask import Blueprint

marketing = Blueprint("marketing", __name__, url_prefix="/api/tenants/<tenant_id>/marketing")
marketing_public = Blueprint("marketing_public", __name__)


def handler(name):
    def dispatch(**kwargs):
        return getattr(import_module(".routes", __package__), name)(**kwargs)

    return dispatch


for endpoint, path, methods in (
    ("templates", "/templates", ["GET"]),
    ("assets", "/assets", ["POST"]),
    ("asset_file", "/assets/<asset_id>", ["GET"]),
    ("brand", "/brand", ["GET", "PUT"]),
    ("pages", "/pages", ["GET", "POST"]),
    ("page", "/pages/<page_id>", ["GET"]),
    ("revisions", "/pages/<page_id>/revisions", ["POST"]),
    ("preview", "/pages/<page_id>/preview", ["POST"]),
    ("review_requests", "/pages/<page_id>/review-requests", ["POST"]),
    ("artifact", "/pages/<page_id>/previews/<artifact_id>", ["GET"]),
    ("reviews", "/pages/<page_id>/reviews", ["POST"]),
    ("publish_page", "/pages/<page_id>/publish", ["POST"]),
    ("unpublish_page", "/pages/<page_id>/unpublish", ["POST"]),
    ("restore_page", "/pages/<page_id>/restore", ["POST"]),
    ("releases", "/pages/<page_id>/releases", ["GET"]),
    ("generations", "/pages/<page_id>/generations", ["POST"]),
    ("generation", "/generation-jobs/<job_id>", ["GET"]),
    ("apply_generation", "/generation-jobs/<job_id>/apply", ["POST"]),
):
    marketing.add_url_rule(path, endpoint=endpoint, view_func=handler(endpoint), methods=methods)

marketing_public.add_url_rule(
    "/p/<site_slug>/<page_slug>",
    endpoint="page",
    view_func=handler("public_page"),
    methods=["GET"],
)
