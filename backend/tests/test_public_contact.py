"""Public contact mail without network calls, real mail or database access."""

import smtplib
import unittest
from unittest.mock import MagicMock, patch

from flask import Flask
from sqlalchemy.exc import OperationalError

from pms_api.config import load_config
from pms_api.contact import RECIPIENT
from pms_api.contact_urls import contact
from pms_api.security import register_security

SMTP_CONFIG = {
    "CONTACT_SMTP_HOST": "smtp.example.test",
    "CONTACT_SMTP_USERNAME": "fixture-user",
    "CONTACT_SMTP_PASSWORD": "fixture-password",
    "CONTACT_SMTP_FROM": "website@lohapms.com",
    "CONTACT_SMTP_SECURITY": "starttls",
    "CONTACT_SMTP_PORT": "587",
}
BODY = {
    "name": " Test User ",
    "email": " Test@Hotel.Example ",
    "phone": "+84 900 123 456",
    "hotel": " Test Hotel ",
    "message": " Test message\nA second line. ",
}


class PublicContactTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, APP_ENV="testing", CORS_ORIGINS=[], **SMTP_CONFIG)
        register_security(self.app)
        self.app.register_blueprint(contact)
        self.client = self.app.test_client()
        self.database = MagicMock()
        self.smtp = MagicMock()
        self.smtp.send_message.return_value = {}
        self.count = self.enterContext(patch("pms_api.contact.count_attempt", return_value=1))
        self.context = self.enterContext(patch("pms_api.security.set_context"))
        self.enterContext(patch("pms_api.security.db", self.database))
        self.enterContext(patch("pms_api.contact.db", self.database))
        self.connect = self.enterContext(
            patch("pms_api.contact.smtplib.SMTP", return_value=self.smtp)
        )
        self.ssl_connect = self.enterContext(
            patch("pms_api.contact.smtplib.SMTP_SSL", return_value=self.smtp)
        )

    def post(self, body=None, **kwargs):
        return self.client.post(
            "/api/public/contact", json=BODY if body is None else body, **kwargs
        )

    def test_anonymous_contact_sends_to_fixed_recipient_with_tls_and_safe_headers(self):
        ordering = []
        self.database.session.commit.side_effect = lambda: ordering.append("commit")
        self.smtp.send_message.side_effect = lambda *args, **kwargs: ordering.append("send") or {}
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"sent": True})
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.context.assert_called_once_with()
        self.connect.assert_called_once_with("smtp.example.test", 587, timeout=10)
        self.ssl_connect.assert_not_called()
        self.smtp.starttls.assert_called_once()
        tls = self.smtp.starttls.call_args.kwargs["context"]
        self.assertTrue(tls.check_hostname)
        self.smtp.login.assert_called_once_with("fixture-user", "fixture-password")
        message = self.smtp.send_message.call_args.args[0]
        self.assertEqual(message["From"], "website@lohapms.com")
        self.assertEqual(message["To"], RECIPIENT)
        self.assertEqual(message["Reply-To"], "test@hotel.example")
        self.assertEqual(message["Subject"], "LOHA PMS website contact")
        self.assertIsNone(message["Cc"])
        self.assertIsNone(message["Bcc"])
        self.assertEqual(message.get_content_type(), "text/plain")
        self.assertIn("+84 900 123 456", message.get_content())
        self.assertIn("Test Hotel", message.get_content())
        self.assertIn("Test message\nA second line.", message.get_content())
        self.assertEqual(
            self.smtp.send_message.call_args.kwargs,
            {"from_addr": "website@lohapms.com", "to_addrs": [RECIPIENT]},
        )
        self.assertLess(ordering.index("commit"), ordering.index("send"))
        self.assertEqual(
            [call.args[0] for call in self.count.call_args_list],
            ["contact:ip:127.0.0.1", "contact:global"],
        )

    def test_phone_and_hotel_are_optional_and_ssl_uses_its_own_default_port(self):
        self.app.config.update(CONTACT_SMTP_SECURITY="ssl", CONTACT_SMTP_PORT=None)
        response = self.post(
            {key: value for key, value in BODY.items() if key not in {"phone", "hotel"}}
        )
        self.assertEqual(response.status_code, 200)
        self.ssl_connect.assert_called_once()
        self.assertEqual(self.ssl_connect.call_args.args, ("smtp.example.test", 465))
        self.assertTrue(self.ssl_connect.call_args.kwargs["context"].check_hostname)
        self.connect.assert_not_called()
        self.smtp.starttls.assert_not_called()

    def test_validation_rejects_missing_fields_bad_phone_and_header_injection_before_smtp(self):
        for override in (
            {"name": " "},
            {"message": "\t\n "},
            {"name": "x" * 121},
            {"hotel": "x" * 181},
            {"message": "x" * 4001},
            {"phone": "123456"},
            {"phone": "1234567890123456"},
            {"phone": "090+123456"},
            {"name": "Visitor\r\nBcc: attacker@example.test"},
            {"email": "visitor@example.test\nBcc: attacker@example.test"},
            {"email": "missing@"},
            {"hotel": []},
            {"to": "attacker@example.test"},
            {"from": "attacker@example.test"},
        ):
            with self.subTest(override=override):
                response = self.post({**BODY, **override})
                self.assertEqual(response.status_code, 422)
                self.assertIn(
                    response.json["error"]["code"],
                    {"invalid_contact", "invalid_phone", "invalid_email"},
                )
        self.connect.assert_not_called()
        self.ssl_connect.assert_not_called()
        self.count.assert_not_called()

    def test_bad_json_oversized_body_and_cross_origin_do_not_send(self):
        for body in ([], None, "text"):
            response = self.client.post("/api/public/contact", json=body)
            self.assertEqual(response.status_code, 422)
        response = self.client.post(
            "/api/public/contact", data="x" * 65537, content_type="application/json"
        )
        self.assertEqual(response.status_code, 413)
        response = self.post(headers={"Origin": "https://attacker.example.test"})
        self.assertEqual(response.status_code, 403)
        self.connect.assert_not_called()

    def test_unstorable_text_is_rejected_before_attempts_or_smtp(self):
        for field in ("name", "hotel", "message"):
            for character in ("\ud800", "\udfff", "\x00"):
                with self.subTest(field=field, character=repr(character)):
                    response = self.post({**BODY, field: "text" + character})
                    self.assertEqual(response.status_code, 422)
                    self.assertEqual(response.json["error"]["code"], "invalid_json")
        self.count.assert_not_called()
        self.connect.assert_not_called()
        self.ssl_connect.assert_not_called()
        self.database.session.commit.assert_not_called()

    def test_missing_or_insecure_configuration_fails_closed(self):
        for key, value in (
            ("CONTACT_SMTP_HOST", ""),
            ("CONTACT_SMTP_PASSWORD", None),
            ("CONTACT_SMTP_USERNAME", ""),
            ("CONTACT_SMTP_FROM", "bad\naddress"),
            ("CONTACT_SMTP_SECURITY", "none"),
            ("CONTACT_SMTP_PORT", "bad"),
        ):
            with self.subTest(key=key):
                previous = self.app.config[key]
                self.app.config[key] = value
                try:
                    response = self.post()
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json["error"]["code"], "contact_unavailable")
                finally:
                    self.app.config[key] = previous
        self.connect.assert_not_called()
        self.count.assert_not_called()

    def test_per_ip_and_global_limits_are_persisted_and_do_not_send(self):
        for attempts in ([6], [1, 101]):
            with self.subTest(attempts=attempts):
                self.count.side_effect = attempts
                before = self.database.session.commit.call_count
                response = self.post()
                self.assertEqual(response.status_code, 429)
                self.assertEqual(response.json["error"]["code"], "contact_rate_limited")
                self.assertGreater(self.database.session.commit.call_count, before)
        self.connect.assert_not_called()

    def test_database_failure_before_send_does_not_emit_an_email(self):
        self.database.session.commit.side_effect = OperationalError(
            "", {}, RuntimeError("private-driver-error")
        )
        response = self.post()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["error"]["code"], "database_unavailable")
        self.connect.assert_not_called()
        self.assertNotIn("private-driver-error", response.get_data(as_text=True))

    def test_smtp_rejection_and_timeout_are_errors_without_private_values_in_logs(self):
        for error in (
            smtplib.SMTPAuthenticationError(535, b"private-password"),
            TimeoutError("private-address"),
        ):
            with self.subTest(error=type(error).__name__):
                self.smtp.send_message.side_effect = error
                with self.assertLogs(self.app.logger, level="WARNING") as captured:
                    response = self.post()
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json["error"]["code"], "contact_send_failed")
                self.assertNotIn("private-", "\n".join(captured.output))
                self.assertNotIn("private-", response.get_data(as_text=True))
        self.smtp.send_message.side_effect = None
        self.smtp.send_message.return_value = {RECIPIENT: (550, b"private-rejection")}
        response = self.post()
        self.assertEqual(response.status_code, 502)

    def test_connection_failure_never_reports_success_and_quit_failure_after_acceptance_is_safe(
        self,
    ):
        self.connect.side_effect = OSError("private-host-details")
        response = self.post()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("private-host-details", response.get_data(as_text=True))
        self.connect.side_effect = None
        self.smtp.quit.side_effect = smtplib.SMTPServerDisconnected("closed after accepted DATA")
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.smtp.close.assert_called_once()

    def test_app_factory_registers_only_post_and_options_and_runtime_smtp_settings(self):
        from pms_api import create_app

        runtime = {"DATABASE_URL": "postgresql://app:fixture-password@localhost/pms", **SMTP_CONFIG}
        app = create_app(runtime, env_file=None)
        rule = next(rule for rule in app.url_map.iter_rules() if rule.rule == "/api/public/contact")
        self.assertEqual(rule.methods, {"POST", "OPTIONS"})
        for key, value in SMTP_CONFIG.items():
            self.assertEqual(app.config[key], value)
        defaults = load_config({"DATABASE_URL": runtime["DATABASE_URL"]}, env_file=None)
        self.assertIsNone(defaults["CONTACT_SMTP_HOST"])
        self.assertEqual(defaults["CONTACT_SMTP_SECURITY"], "starttls")


if __name__ == "__main__":
    unittest.main()
