"""One deterministic HTML renderer for preview and publication snapshots."""

import copy
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .documents import checksum, validate_document

RENDERER_VERSION = "marketing-1"
ROOT = Path(__file__).resolve().parent
ENV = Environment(
    loader=FileSystemLoader(ROOT / "templates"), autoescape=select_autoescape(("html",))
)


def render_page(document, public_url, *, image_resolver=None):
    document = validate_document(document)
    css = (ROOT / "static" / "page.css").read_text(encoding="utf-8")
    rendered = copy.deepcopy(document)
    if image_resolver:
        for section in rendered["sections"]:
            if section["visible"] and section["imageUrl"]:
                section["imageUrl"] = image_resolver(section["imageUrl"])
    html = ENV.get_template("page.html").render(page=rendered, canonical=public_url, css=css)
    manifest_hash = checksum(
        {
            "document": document,
            "url": public_url,
            "renderer": RENDERER_VERSION,
            "html": checksum(html),
        }
    )
    return html, manifest_hash


def html_response(html, *, preview=False):
    from flask import Response

    response = Response(html, content_type="text/html; charset=utf-8")
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: 'self'; "
        "base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
    )
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store" if preview else "no-cache"
    if preview:
        response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
    return response
