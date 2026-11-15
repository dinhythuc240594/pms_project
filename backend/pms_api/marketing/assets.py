"""Private raster uploads, re-encoded without metadata; snapshots embed their exact bytes."""

import base64
import hashlib
import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select

from common import ApiError

from ..extensions import db
from .documents import ASSET_URL
from .models import MarketingAsset


def upload(tenant_id, encoded):
    if not isinstance(encoded, str) or len(encoded) > 940_000:
        raise ApiError(422, "invalid_image", "Ảnh tải lên tối đa 700 KB.")
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 700_000:
            raise ValueError
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if (
                    image.format not in ("JPEG", "PNG", "WEBP")
                    or image.width * image.height > 12_000_000
                ):
                    raise ValueError
                image.load()
                normalized = ImageOps.exif_transpose(image).convert("RGB")
                normalized.thumbnail((1600, 1600))
                output = io.BytesIO()
                normalized.save(output, "JPEG", quality=82, optimize=True)
                data = output.getvalue()
                width, height = normalized.size
        if len(data) > 600_000:
            raise ValueError
    except (
        ValueError,
        OSError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise ApiError(
            422,
            "invalid_image",
            "Ảnh phải là JPEG, PNG hoặc WebP hợp lệ, tối đa 700 KB và 12 megapixel.",
        ) from None
    digest = hashlib.sha256(data).hexdigest()
    asset = db.session.scalar(
        select(MarketingAsset).where(
            MarketingAsset.tenant_id == tenant_id,
            MarketingAsset.checksum == digest,
        )
    )
    if asset is None:
        count = db.session.scalar(
            select(func.count())
            .select_from(MarketingAsset)
            .where(MarketingAsset.tenant_id == tenant_id)
        )
        if count >= 50:
            raise ApiError(
                429, "marketing_asset_quota", "Khách sạn đã đạt giới hạn 50 ảnh tải lên."
            )
        asset = MarketingAsset(
            tenant_id=tenant_id,
            checksum=digest,
            data=data,
            content_type="image/jpeg",
            width=width,
            height=height,
        )
        db.session.add(asset)
        db.session.flush()
    return asset


def get_asset(tenant_id, asset_id):
    asset = db.session.scalar(
        select(MarketingAsset).where(
            MarketingAsset.tenant_id == tenant_id,
            MarketingAsset.id == asset_id,
        )
    )
    if asset is None:
        raise ApiError(404, "marketing_asset_not_found", "Không tìm thấy ảnh trong khách sạn này.")
    return asset


def image_resolver(tenant_id):
    used_bytes = 0

    def resolve(url):
        nonlocal used_bytes
        matched = ASSET_URL.fullmatch(url)
        if not matched:
            return url
        if matched.group(1) != tenant_id:
            raise ApiError(
                422, "marketing_asset_scope", "Ảnh không thuộc khách sạn đang chỉnh sửa."
            )
        asset = get_asset(tenant_id, matched.group(2))
        used_bytes += len(asset.data)
        if used_bytes > 2_000_000:
            raise ApiError(
                422,
                "marketing_page_images_too_large",
                "Tổng ảnh tải lên hiển thị trên một trang tối đa 2 MB.",
            )
        return "data:image/jpeg;base64," + base64.b64encode(asset.data).decode("ascii")

    return resolve


def validate_assets(tenant_id, document):
    resolve = image_resolver(tenant_id)
    for section in document["sections"]:
        if section["imageUrl"]:
            resolve(section["imageUrl"])
