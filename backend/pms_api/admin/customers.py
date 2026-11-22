import re

from sqlalchemy import select

from pms_api.auth.application import validate_email

from ..core_models import Tenant, TenantUser, User
from ..currencies import normalize_hotel_currency
from ..extensions import db
from ..security import ApiError
from ..validation import phone_value, tax_id_value
from .client_models import TenantClientProfile

CLIENT_FIELDS = {
    "contactName": ("contact_name", 160),
    "contactEmail": ("contact_email", 254),
    "contactPhone": ("contact_phone", 40),
    "address": ("address", 500),
    "city": ("city", 160),
    "taxId": ("tax_id", 40),
    "domain": ("domain", 253),
    "customerNotes": ("customer_notes", 4000),
}


def hotel_currency(value):
    return normalize_hotel_currency(value)


def client_values(data):
    result = {}
    for key, (column, limit) in CLIENT_FIELDS.items():
        if key not in data:
            continue
        value = data[key]
        if not isinstance(value, str) or len(value.strip()) > limit:
            raise ApiError(422, "invalid_contact", f"{key} phải là chuỗi tối đa {limit} ký tự.")
        value = value.strip()
        if key == "contactEmail" and value:
            value = validate_email(value)
        if key == "contactPhone":
            value = phone_value(value)
        if key == "taxId":
            value = tax_id_value(value)
        if key == "domain" and value:
            value = value.lower()
            labels = value.split(".")
            if len(labels) < 2 or any(
                not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels
            ):
                raise ApiError(
                    422, "invalid_domain", "Nhập hostname như hotel.example.com, không nhập URL."
                )
        result[column] = value
    return result


def customer_account_json(user):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "active": user.active,
        "createdAt": user.created_at.isoformat(),
    }


def customer_accounts(search):
    users = db.session.scalars(
        select(User)
        .where(
            User.active.is_(True),
            User.global_role == "USER",
            User.name.icontains(search, autoescape=True)
            | User.email.icontains(search, autoescape=True),
        )
        .order_by(User.name, User.email, User.id)
        .limit(20)
    ).all()
    memberships = {user.id: [] for user in users}
    for membership, tenant in db.session.execute(
        select(TenantUser, Tenant)
        .join(Tenant, Tenant.id == TenantUser.tenant_id)
        .where(TenantUser.user_id.in_(memberships))
        .order_by(Tenant.name, Tenant.id)
    ):
        memberships[membership.user_id].append(
            {
                "tenantId": tenant.id,
                "tenantName": tenant.name,
                "role": membership.role,
                "active": membership.active,
            }
        )
    return [{**customer_account_json(user), "memberships": memberships[user.id]} for user in users]


def customer_tenants(tenant_id=None):
    query = select(Tenant).order_by(Tenant.created_at, Tenant.id)
    if tenant_id:
        query = query.where(Tenant.id == tenant_id)
    rows = db.session.scalars(query).all()
    ids = [row.id for row in rows]
    profiles = {
        row.tenant_id: row
        for row in db.session.scalars(
            select(TenantClientProfile).where(TenantClientProfile.tenant_id.in_(ids))
        )
    }
    owners = {}
    for tid, owner in db.session.execute(
        select(TenantUser.tenant_id, User)
        .join(User, User.id == TenantUser.user_id)
        .where(TenantUser.tenant_id.in_(ids), TenantUser.role == "HOTEL_OWNER")
        .order_by(TenantUser.active.desc(), User.active.desc(), User.id)
    ):
        owners.setdefault(tid, owner)
    result = []
    for tenant in rows:
        owner, profile = owners.get(tenant.id), profiles.get(tenant.id)
        fields = {
            key: getattr(profile, column) if profile else None
            for key, (column, _) in CLIENT_FIELDS.items()
        }
        for key, attribute in (("contactName", "name"), ("contactEmail", "email")):
            if fields[key] is None and owner:
                fields[key] = getattr(owner, attribute)
        result.append(
            {
                "id": tenant.id,
                "name": tenant.name,
                "status": tenant.status,
                "currency": (tenant.settings or {}).get("currency", "VND"),
                **{key: value or "" for key, value in fields.items()},
                "createdAt": tenant.created_at.isoformat(),
                "owner": customer_account_json(owner) if owner else None,
            }
        )
    return result
