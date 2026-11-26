"""IP classification and proxy trust do not require a database or external lookup."""

import unittest
from unittest.mock import patch

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from pms_api.audit_ip import capture_request_ip, ip_info, parse_address
from pms_api.security import audit


class AuditIPTests(unittest.TestCase):
    def test_normalizes_literals_and_ipv4_mapped_addresses(self):
        for value, expected in (
            ("8.8.8.8", "8.8.8.8"),
            ("2001:4860:4860:0000:0000:0000:0000:8888", "2001:4860:4860::8888"),
            ("::ffff:192.168.1.5", "192.168.1.5"),
        ):
            with self.subTest(value=value):
                self.assertEqual(str(parse_address(value)), expected)
        for value in (
            None,
            123,
            "",
            "unknown",
            "8.8.8.8:443",
            "[::1]",
            "fe80::1%eth0",
            "8.8.8.8, 1.1.1.1",
            "010.0.0.1",
            "8.8.8.8\n",
        ):
            with self.subTest(value=value):
                self.assertIsNone(parse_address(value))

    def test_classifies_special_ranges_before_public_and_private(self):
        for value, version, scope in (
            ("8.8.8.8", 4, "public"),
            ("2001:4860:4860::8888", 6, "public"),
            ("10.1.2.3", 4, "private"),
            ("172.31.255.255", 4, "private"),
            ("192.168.1.2", 4, "private"),
            ("fd00::1", 6, "private"),
            ("127.0.0.2", 4, "loopback"),
            ("::1", 6, "loopback"),
            ("::ffff:127.0.0.1", 4, "loopback"),
            ("169.254.1.1", 4, "link_local"),
            ("fe80::1", 6, "link_local"),
            ("224.0.0.1", 4, "multicast"),
            ("ff02::1", 6, "multicast"),
            ("0.0.0.0", 4, "unspecified"),
            ("::", 6, "unspecified"),
            ("100.64.0.1", 4, "shared"),
            ("100.127.255.255", 4, "shared"),
            ("192.0.2.1", 4, "reserved"),
            ("198.18.0.1", 4, "reserved"),
            ("2001:db8::1", 6, "reserved"),
            ("240.0.0.1", 4, "reserved"),
            ("255.255.255.255", 4, "reserved"),
            ("fec0::1", 6, "reserved"),
            (None, None, "unknown"),
            ("", None, "unknown"),
            ("invalid", None, "invalid"),
        ):
            with self.subTest(value=value):
                self.assertEqual(
                    ip_info(value), {"version": version, "scope": scope, "source": "unknown"}
                )

    def probe(self, count=0):
        app = Flask(__name__)
        app.config["TRUSTED_PROXY_COUNT"] = count
        if count:
            app.wsgi_app = ProxyFix(app.wsgi_app, x_for=count)

        @app.get("/probe")
        def probe():
            address, source = capture_request_ip()
            return {"ipAddress": address, "source": source}

        return app.test_client()

    def test_untrusted_headers_cannot_spoof_direct_address(self):
        response = self.probe().get(
            "/probe",
            environ_base={"REMOTE_ADDR": "192.168.1.2"},
            headers={
                "X-Forwarded-For": "8.8.8.8",
                "X-Real-IP": "1.1.1.1",
                "CF-Connecting-IP": "9.9.9.9",
                "Forwarded": "for=4.4.4.4",
            },
        )
        self.assertEqual(response.json, {"ipAddress": "192.168.1.2", "source": "direct"})

    def test_proxy_selects_only_configured_hop_and_normalizes(self):
        for count, forwarded, expected in (
            (1, "1.1.1.1, 8.8.8.8", "8.8.8.8"),
            (2, "1.1.1.1, 8.8.8.8", "1.1.1.1"),
            (1, "::ffff:192.168.1.2", "192.168.1.2"),
            (1, "192.168.1.2", "192.168.1.2"),
            (1, "2001:4860:4860::8888", "2001:4860:4860::8888"),
        ):
            with self.subTest(count=count, forwarded=forwarded):
                response = self.probe(count).get(
                    "/probe",
                    environ_base={"REMOTE_ADDR": "192.168.1.2"},
                    headers={"X-Forwarded-For": forwarded},
                )
                self.assertEqual(response.json, {"ipAddress": expected, "source": "trusted_proxy"})

    def test_proxy_insufficient_hops_uses_connection_and_invalid_selected_hop_is_absent(self):
        client = self.probe(2)
        for headers in ({}, {"X-Forwarded-For": "8.8.8.8"}):
            response = client.get(
                "/probe", headers=headers, environ_base={"REMOTE_ADDR": "192.168.1.2"}
            )
            self.assertEqual(response.json, {"ipAddress": "192.168.1.2", "source": "direct"})
        response = client.get("/probe", headers={"X-Forwarded-For": "bad, 8.8.8.8"})
        self.assertEqual(response.json, {"ipAddress": None, "source": None})

    def test_capture_requires_middleware_before_reporting_proxy_source(self):
        app = Flask(__name__)
        app.config["TRUSTED_PROXY_COUNT"] = 1
        with app.test_request_context(
            headers={"X-Forwarded-For": "8.8.8.8"}, environ_base={"REMOTE_ADDR": "8.8.8.8"}
        ):
            self.assertEqual(capture_request_ip(), ("8.8.8.8", "direct"))

    def test_background_audit_has_no_ip_and_preserves_details(self):
        self.assertEqual(capture_request_ip(), (None, None))
        app = Flask(__name__)
        details = {"environment": "staging"}
        with (
            app.app_context(),
            patch("pms_api.security.db.session.add"),
            patch("pms_api.notifications.emit_audit"),
            patch("pms_api.channels.service.enqueue_audit"),
        ):
            entry = audit("tenant.updated", "tenant", "fixture", details)
            self.assertEqual(entry.details, details)
            self.assertIsNone(entry.ip_address)
            self.assertIsNone(entry.ip_source)


if __name__ == "__main__":
    unittest.main()
