"""Closed, versioned page documents shared by manual editing and AI output."""

import copy
import hashlib
import json
import re
from urllib.parse import urlsplit

from common import ApiError

SECTION_TYPES = ("hero", "about", "rooms", "amenities", "gallery", "faq", "contact")
THEMES = ("calm-blue", "forest", "sand")
CHECKLIST = ("facts", "cta", "assets", "responsive", "seo")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
ASSET_URL = re.compile(r"/api/tenants/([A-Za-z0-9_-]{1,40})/marketing/assets/([a-f0-9-]{36})\Z")
TEMPLATES = (
    {
        "id": "hotel",
        "version": 1,
        "name": "Giới thiệu khách sạn",
        "prompt": "Tạo trang giới thiệu khách sạn với giọng văn gần gũi. Có giới thiệu, "
        "hạng phòng, tiện ích, thư viện ảnh, FAQ và liên hệ. Chỉ dùng thông tin đã xác nhận; "
        "không tự tạo giá, xếp hạng hoặc đánh giá khách hàng.",
    },
    {
        "id": "campaign",
        "version": 1,
        "name": "Chiến dịch lưu trú",
        "prompt": "Tạo landing page chiến dịch lưu trú, nội dung ngắn, tập trung vào một "
        "nút liên hệ đặt phòng. Chỉ sử dụng thông tin đã xác nhận. Không tạo ưu đãi, "
        "giá hoặc thời hạn nếu khách sạn chưa cung cấp.",
    },
)


def invalid(message):
    raise ApiError(422, "invalid_marketing_document", message)


def text(value, limit, label, *, required=True):
    if not isinstance(value, str) or len(value) > limit:
        invalid(f"{label} phải là văn bản tối đa {limit} ký tự.")
    value = value.strip()
    if required and not value:
        invalid(f"Vui lòng nhập {label.lower()}.")
    if any(ord(c) < 32 and c not in "\n\t" for c in value):
        invalid(f"{label} chứa ký tự không hợp lệ.")
    return value


def fields(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        invalid(f"Cấu trúc {label} không hợp lệ.")


def safe_url(value, *, image=False, optional=False):
    value = text(value, 2048, "Đường dẫn", required=not optional)
    if not value and optional:
        return ""
    if image and ASSET_URL.fullmatch(value):
        return value
    if any(c.isspace() or ord(c) < 32 for c in value) or "\\" in value:
        invalid("Đường dẫn có ký tự không hợp lệ.")
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme == "https"
            and parsed.hostname
            and not parsed.username
            and not parsed.password
            and parsed.port in (None, 443)
        ):
            return value
        if not image and parsed.scheme == "tel" and re.fullmatch(r"\+?[0-9()-]{6,24}", parsed.path):
            return value
        if (
            not image
            and parsed.scheme == "mailto"
            and re.fullmatch(r"[^@\s?]+@[^@\s?]+\.[^@\s?]+", parsed.path)
            and not parsed.query
        ):
            return value
    except ValueError:
        pass
    invalid("Chỉ chấp nhận HTTPS, số điện thoại hoặc email hợp lệ.")


def validate_document(document):
    fields(
        document, ("schemaVersion", "locale", "slug", "seo", "brand", "cta", "sections"), "trang"
    )
    if type(document["schemaVersion"]) is not int or document["schemaVersion"] != 1:
        invalid("Phiên bản tài liệu chưa được hỗ trợ.")
    if document["locale"] not in ("vi", "en"):
        invalid("Ngôn ngữ phải là vi hoặc en.")
    slug = text(document["slug"], 80, "Slug")
    if not SLUG.fullmatch(slug):
        invalid("Slug chỉ gồm chữ thường, số và dấu gạch ngang.")
    fields(document["seo"], ("title", "description"), "SEO")
    fields(document["brand"], ("name", "theme"), "thương hiệu")
    fields(document["cta"], ("label", "url"), "nút hành động")
    result = copy.deepcopy(document)
    result["slug"] = slug
    result["seo"] = {
        "title": text(document["seo"]["title"], 100, "Tiêu đề SEO"),
        "description": text(document["seo"]["description"], 320, "Mô tả SEO", required=False),
    }
    result["brand"]["name"] = text(document["brand"]["name"], 160, "Tên khách sạn")
    if document["brand"]["theme"] not in THEMES:
        invalid("Phong cách không được hỗ trợ.")
    result["cta"] = {
        "label": text(document["cta"]["label"], 60, "Nhãn nút hành động"),
        "url": safe_url(document["cta"]["url"], optional=True),
    }
    sections = document["sections"]
    if not isinstance(sections, list) or not 1 <= len(sections) <= 20:
        invalid("Trang phải có từ 1 đến 20 khối.")
    ids = set()
    hero_count = 0
    result["sections"] = []
    for item in sections:
        fields(item, ("id", "type", "heading", "body", "imageUrl", "imageAlt", "visible"), "khối")
        section_id = text(item["id"], 60, "Mã khối")
        if not SLUG.fullmatch(section_id) or section_id in ids:
            invalid("Mã khối phải hợp lệ và không được trùng.")
        ids.add(section_id)
        if item["type"] not in SECTION_TYPES or type(item["visible"]) is not bool:
            invalid("Loại hoặc trạng thái hiển thị khối không hợp lệ.")
        if item["type"] == "hero" and item["visible"]:
            hero_count += 1
        result["sections"].append(
            {
                "id": section_id,
                "type": item["type"],
                "visible": item["visible"],
                "heading": text(item["heading"], 160, "Tiêu đề khối"),
                "body": text(item["body"], 4000, "Nội dung khối", required=False),
                "imageUrl": safe_url(item["imageUrl"], image=True, optional=True),
                "imageAlt": text(item["imageAlt"], 240, "Mô tả ảnh", required=False),
            }
        )
    visible = [s for s in result["sections"] if s["visible"]]
    if hero_count != 1 or not visible or visible[0]["type"] != "hero":
        invalid("Trang cần đúng một khối mở đầu hiển thị ở vị trí đầu tiên.")
    return result


def publish_errors(document):
    errors = []
    if not document["cta"]["url"]:
        errors.append("Bổ sung đường dẫn cho nút hành động chính.")
    if not document["seo"]["description"]:
        errors.append("Bổ sung mô tả SEO.")
    for section in document["sections"]:
        if (
            section["visible"]
            and section["imageUrl"]
            and not ASSET_URL.fullmatch(section["imageUrl"])
        ):
            errors.append(
                f"Tải ảnh lên cho khối {section['heading']} để cố định ảnh trong bản xuất bản."
            )
        if section["visible"] and section["imageUrl"] and not section["imageAlt"]:
            errors.append(f"Bổ sung mô tả ảnh cho khối {section['heading']}.")
    if "{{" in canonical(document) or "}}" in canonical(document):
        errors.append("Thay các biến mẫu còn thiếu trước khi duyệt.")
    return errors


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def checksum(value):
    raw = value if isinstance(value, str) else canonical(value)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def initial_document(hotel_name, template_id="hotel"):
    hotel_name = text(hotel_name, 160, "Tên khách sạn")
    titles = {
        "hero": f"Chào mừng đến {hotel_name}"[:160],
        "about": "Về khách sạn",
        "rooms": "Hạng phòng",
        "amenities": "Tiện ích",
        "gallery": "Không gian khách sạn",
        "faq": "Thông tin trước kỳ lưu trú",
        "contact": "Liên hệ đặt phòng",
    }
    kinds = SECTION_TYPES if template_id != "campaign" else ("hero", "about", "rooms", "contact")
    return validate_document(
        {
            "schemaVersion": 1,
            "locale": "vi",
            "slug": "gioi-thieu",
            "seo": {"title": f"{hotel_name[:80]} — Giới thiệu", "description": ""},
            "brand": {"name": hotel_name, "theme": "calm-blue"},
            "cta": {"label": "Liên hệ đặt phòng", "url": ""},
            "sections": [
                {
                    "id": kind + "-main",
                    "type": kind,
                    "heading": titles[kind],
                    "body": "Liên hệ khách sạn để được tư vấn cho kỳ lưu trú của bạn."
                    if kind == "hero"
                    else "",
                    "imageUrl": "",
                    "imageAlt": "",
                    "visible": True,
                }
                for kind in kinds
            ],
        }
    )


def ai_schema():
    """Strict Responses API schema; server validation remains authoritative."""

    def obj(properties):
        return {
            "type": "object",
            "properties": properties,
            "required": list(properties),
            "additionalProperties": False,
        }

    string = {"type": "string"}
    return obj(
        {
            "schemaVersion": {"type": "integer", "enum": [1]},
            "locale": {"type": "string", "enum": ["vi", "en"]},
            "slug": string,
            "seo": obj({"title": string, "description": string}),
            "brand": obj({"name": string, "theme": {"type": "string", "enum": list(THEMES)}}),
            "cta": obj({"label": string, "url": string}),
            "sections": {
                "type": "array",
                "items": obj(
                    {
                        "id": string,
                        "type": {"type": "string", "enum": list(SECTION_TYPES)},
                        "heading": string,
                        "body": string,
                        "imageUrl": string,
                        "imageAlt": string,
                        "visible": {"type": "boolean"},
                    }
                ),
            },
        }
    )
