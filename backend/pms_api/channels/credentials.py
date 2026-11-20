"""Authenticated tenant-bound secrets; legacy environment credentials remain readable."""

import json
import os

from cryptography.fernet import Fernet, InvalidToken
from flask import current_app

from .client import ProviderError


def cipher():
    key = current_app.config.get("CHANNEX_ENCRYPTION_KEY")
    try:
        if not isinstance(key, str) or not key:
            raise ValueError
        return Fernet(key.encode("ascii"))
    except (ValueError, TypeError, UnicodeError):
        raise ProviderError("credential_storage_unavailable") from None


def storage_available():
    try:
        cipher()
        return True
    except ProviderError:
        return False


def valid_secret(value, minimum=1):
    return (
        isinstance(value, str)
        and minimum <= len(value) <= 1024
        and all(32 <= ord(char) <= 126 for char in value)
    )


def encrypt_credentials(tenant_id, environment, property_id, api_key, webhook_secret):
    if not valid_secret(api_key) or not valid_secret(webhook_secret, 32):
        raise ProviderError("credentials_unavailable")
    value = {
        "version": 1,
        "tenantId": tenant_id,
        "environment": environment,
        "propertyId": property_id,
        "apiKey": api_key,
        "webhookSecret": webhook_secret,
    }
    return cipher().encrypt(json.dumps(value, separators=(",", ":")).encode()).decode("ascii")


def load_credentials(connection):
    if connection.secrets_ciphertext is None:
        return {
            "apiKey": os.environ.get(connection.credential_ref, ""),
            "webhookSecret": os.environ.get(connection.webhook_secret_ref, ""),
        }
    # A damaged token must never silently select environment credentials instead.
    decryptor = cipher()
    try:
        token = connection.secrets_ciphertext
        if not isinstance(token, str) or len(token) > 8192:
            raise ValueError
        value = json.loads(decryptor.decrypt(token.encode("ascii")))
        if (
            not isinstance(value, dict)
            or set(value)
            != {"version", "tenantId", "environment", "propertyId", "apiKey", "webhookSecret"}
            or type(value["version"]) is not int
            or value["version"] != 1
            or (value["tenantId"], value["environment"], value["propertyId"])
            != (connection.tenant_id, connection.environment, connection.property_id)
            or not valid_secret(value["apiKey"])
            or not valid_secret(value["webhookSecret"], 32)
        ):
            raise ValueError
        return {"apiKey": value["apiKey"], "webhookSecret": value["webhookSecret"]}
    except (InvalidToken, ValueError, TypeError, UnicodeError):
        raise ProviderError("credentials_unavailable") from None
