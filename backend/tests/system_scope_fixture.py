"""Seed legacy system memberships to verify their retained access boundaries."""

from sqlalchemy import select

from pms_api.channels.models import ChannelConnection
from pms_api.core_models import TenantUser
from pms_api.extensions import db
from pms_api.security import set_context


def grant_system_access(case, *user_ids, role="HOTEL_OWNER", tenant_id=None):
    with case.app.app_context():
        set_context(is_service=True)
        for user_id in user_ids or ("manager",):
            db.session.add(
                TenantUser(tenant_id=tenant_id or case.tenant_id, user_id=user_id, role=role)
            )
        db.session.commit()


def linked_property(case, property_id):
    with case.app.app_context():
        set_context(case.owner_id, case.tenant_id)
        if (
            db.session.scalar(
                select(ChannelConnection).where(ChannelConnection.tenant_id == case.tenant_id)
            )
            is None
        ):
            db.session.add(
                ChannelConnection(
                    tenant_id=case.tenant_id,
                    environment="staging",
                    property_id=property_id,
                    credential_ref="FIXTURE_REMOTE_KEY",
                    webhook_secret_ref="FIXTURE_WEBHOOK_KEY",
                    actor_id="manager",
                    active=False,
                )
            )
            db.session.commit()
