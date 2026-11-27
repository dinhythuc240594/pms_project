"""Client IP behind a trusted proxy and defensive headers on every API response."""

import json
import subprocess
import sys
import unittest
from pathlib import Path

from pms_api.config import ConfigurationError, load_config

BASE = {"DATABASE_URL": "postgresql://app:secret@db/pms"}


class TrustedProxyConfigTests(unittest.TestCase):
    def test_default_ignores_forwarded_headers(self):
        self.assertEqual(load_config(BASE, env_file=None)["TRUSTED_PROXY_COUNT"], 0)

    def test_accepts_small_exact_integers_only(self):
        self.assertEqual(
            load_config({**BASE, "TRUSTED_PROXY_COUNT": "1"}, env_file=None)["TRUSTED_PROXY_COUNT"],
            1,
        )
        for value in ("-1", "6", "one", "1.0", "1; 2"):
            with self.subTest(value=value), self.assertRaises(ConfigurationError):
                load_config({**BASE, "TRUSTED_PROXY_COUNT": value}, env_file=None)


class ProxyAndHeaderAppTests(unittest.TestCase):
    def probe(self, script):
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_remote_addr_and_security_headers(self):
        result = self.probe("""
import json
from flask import request
from pms_api import create_app
base = {"APP_ENV": "testing", "DATABASE_URL": "postgres://pms_app:fixture@127.0.0.1:1/pms"}
out = {}
for count in ("0", "1"):
    app = create_app({**base, "TRUSTED_PROXY_COUNT": count}, env_file=None)
    @app.get("/probe-ip")
    def probe_ip():
        return {"ip": request.remote_addr}
    client = app.test_client()
    response = client.get(
        "/probe-ip",
        headers={"X-Forwarded-For": "203.0.113.9, 198.51.100.7"},
        environ_base={"REMOTE_ADDR": "10.0.0.2"},
    )
    out[count] = response.get_json()["ip"]
    health = client.get("/api/health")
    out["headers"] = {k: health.headers.get(k) for k in (
        "X-Frame-Options", "Content-Security-Policy", "Referrer-Policy",
        "X-Content-Type-Options", "Strict-Transport-Security")}
    with app.app_context():
        app.extensions["sqlalchemy"].engine.dispose()
print(json.dumps(out))
""")
        # Without a trusted proxy the header is ignored; with one, only the last hop is trusted.
        self.assertEqual(result["0"], "10.0.0.2")
        self.assertEqual(result["1"], "198.51.100.7")
        headers = result["headers"]
        self.assertEqual(headers["X-Frame-Options"], "DENY")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(headers["Referrer-Policy"], "no-referrer")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIsNone(headers["Strict-Transport-Security"])  # testing, not production


if __name__ == "__main__":
    unittest.main()
