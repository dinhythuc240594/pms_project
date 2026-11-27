"""Retained AI entry points coexist with source updates without external IO."""

import unittest
from unittest.mock import patch

from pms_api import create_app
from pms_api.config import ConfigurationError, load_config
from pms_api.security import ROLE_ACTIONS


class AIIntegrationTests(unittest.TestCase):
    def test_factory_registers_ai_and_contact_without_connecting_to_database(self):
        with patch("sqlalchemy.engine.Engine.connect", side_effect=AssertionError("DB IO")):
            app = create_app(
                {
                    "APP_ENV": "testing",
                    "DATABASE_URL": "postgresql://fixture:unused@127.0.0.1:1/pms_test",
                },
                env_file=None,
            )
            self.assertTrue({"chatbot", "marketing", "marketing_public", "contact"} <= app.blueprints.keys())
            self.assertTrue(
                {"install-chatbot-schema", "install-marketing-schema", "process-marketing-jobs"}
                <= app.cli.commands.keys()
            )
            self.assertTrue(
                {"chatbot_requests", "marketing_pages", "marketing_generation_jobs"}
                <= app.extensions["sqlalchemy"].metadata.tables.keys()
            )
            with app.app_context():
                app.extensions["sqlalchemy"].engine.dispose()

    def test_ai_config_preserves_source_contact_config_and_server_only_key_fallback(self):
        config = load_config(
            {
                "DATABASE_URL": "postgresql://fixture:unused@127.0.0.1:1/pms_test",
                "MARKETING_PUBLIC_ORIGIN": "https://hotel.example/",
                "MARKETING_AI_API_KEY": "test-fixture-key",
                "MARKETING_AI_MODEL": "fixture-model",
                "OPENAI_CHAT_MODEL": "fixture-chat-model",
                "CONTACT_SMTP_HOST": "smtp.example",
            },
            env_file=None,
        )
        self.assertEqual(config["MARKETING_PUBLIC_ORIGIN"], "https://hotel.example")
        self.assertEqual(config["OPENAI_API_KEY"], "test-fixture-key")
        self.assertEqual(config["CONTACT_SMTP_HOST"], "smtp.example")
        self.assertEqual(config["OPENAI_CHAT_DAILY_LIMIT"], 30)
        for actions in ROLE_ACTIONS.values():
            self.assertTrue({"chatbot.view", "chatbot.send"} <= actions)

    def test_invalid_ai_config_is_rejected_without_echoing_secret_values(self):
        for values in (
            {"MARKETING_AI_DAILY_LIMIT": "0"},
            {"OPENAI_CHAT_DAILY_LIMIT": "1001"},
            {"MARKETING_ENABLED": "yes"},
            {"APP_ENV": "production", "MARKETING_PUBLIC_ORIGIN": "http://hotel.example"},
            {"MARKETING_PUBLIC_ORIGIN": "https://private-value@hotel.example/path"},
        ):
            with self.subTest(values=values), self.assertRaises(ConfigurationError) as caught:
                load_config(
                    {"DATABASE_URL": "postgresql://fixture:unused@127.0.0.1:1/pms_test", **values},
                    env_file=None,
                )
            self.assertNotIn("private-value", str(caught.exception))
