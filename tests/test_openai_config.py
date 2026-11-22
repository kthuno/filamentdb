"""OpenAI configuration without contacting any external service."""

import os
import unittest
from unittest.mock import patch

from src.config import openai_settings


class OpenAIConfigurationTest(unittest.TestCase):
    def test_missing_key_is_clear_and_contains_no_credentials(self):
        with (
            patch.dict(
                os.environ, {"OPENAI_API_KEY": "", "OPENAI_MODEL": "test-model"}
            ),
            self.assertRaisesRegex(ValueError, "angiv OPENAI_API_KEY"),
        ):
            openai_settings()

    def test_model_is_required_without_application_default(self):
        with patch.dict(
            os.environ, {"OPENAI_API_KEY": "private-test-key", "OPENAI_MODEL": ""}
        ):
            with self.assertRaisesRegex(ValueError, "angiv OPENAI_MODEL") as error:
                openai_settings()
            self.assertNotIn("private-test-key", str(error.exception))

    def test_environment_selects_model_and_key_is_hidden(self):
        with patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "private-test-key", "OPENAI_MODEL": "custom-model"},
        ):
            settings = openai_settings()
            self.assertEqual(settings.model, "custom-model")
            self.assertEqual(settings.api_key, "private-test-key")
            self.assertNotIn(settings.api_key, repr(settings))

    def test_malformed_values_do_not_leak_secrets(self):
        for key, model in (
            ("private\\nkey", "test"),
            ("private-key", "bad model"),
            ("private\x01key", "test"),
        ):
            key = key.replace("\\n", "\n")
            with patch.dict(os.environ, {"OPENAI_API_KEY": key, "OPENAI_MODEL": model}):
                with self.assertRaises(ValueError) as error:
                    openai_settings()
                self.assertNotIn(key, str(error.exception))
