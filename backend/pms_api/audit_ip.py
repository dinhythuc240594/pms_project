"""Record the server-resolved client address and classify it without network lookups."""

from ipaddress import ip_address, ip_network

from flask import current_app, has_request_context, request
from werkzeug.http import parse_list_header

PRIVATE_NETWORKS = tuple(
    ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")
)
SHARED_NETWORK = ip_network("100.64.0.0/10")


def parse_address(value):
    """Accept IP literals only; map IPv4-in-IPv6 addresses to one canonical identity."""
    if not isinstance(value, str) or not value or "%" in value:
        return None
    try:
        address = ip_address(value)
    except ValueError:
        return None
    return getattr(address, "ipv4_mapped", None) or address


def capture_request_ip():
    """ProxyFix owns header trust; never select a client from raw request headers."""
    if not has_request_context():
        return None, None
    address = parse_address(request.remote_addr)
    if address is None:
        return None, None
    source = "direct"
    proxies = current_app.config.get("TRUSTED_PROXY_COUNT", 0)
    if proxies and "werkzeug.proxy_fix.orig" in request.environ:
        # Inspect only whether ProxyFix applied its configured hop, including when
        # the selected address equals the peer. The actual IP always comes from
        # remote_addr, after middleware processing.
        forwarded = parse_list_header(request.headers.get("X-Forwarded-For", ""))
        if len(forwarded) >= proxies and forwarded[-proxies] == request.remote_addr:
            source = "trusted_proxy"
    return str(address), source


def ip_info(value, source=None):
    address = parse_address(value)
    source = source if source in {"direct", "trusted_proxy"} else "unknown"
    if address is None:
        return {
            "version": None,
            "scope": "unknown" if value is None or value == "" else "invalid",
            "source": source,
        }
    if address.is_unspecified:
        scope = "unspecified"
    elif address.is_loopback:
        scope = "loopback"
    elif address.is_link_local:
        scope = "link_local"
    elif address.is_multicast:
        scope = "multicast"
    elif address.version == 4 and address in SHARED_NETWORK:
        scope = "shared"
    elif any(
        address.version == network.version and address in network for network in PRIVATE_NETWORKS
    ):
        scope = "private"
    elif address.is_reserved or getattr(address, "is_site_local", False):
        scope = "reserved"
    elif address.is_global:
        scope = "public"
    else:
        # Documentation, benchmarking and other special-purpose ranges are not
        # private LANs merely because ipaddress.is_private also includes them.
        scope = "reserved"
    return {"version": address.version, "scope": scope, "source": source}
