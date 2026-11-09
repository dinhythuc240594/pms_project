"""Workspace route metadata; composition loads on the first workspace request."""

from common import CommonURL


class URL(CommonURL):
    WORKSPACE = "/api/tenants/<tenant_id>/workspace"
