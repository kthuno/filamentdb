"""Language catalogs cannot change stored data or expose arbitrary files."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src import i18n


class TranslationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.danish = json.loads((i18n.LANGUAGE_ROOT / "da.json").read_text())
        (self.root / "da.json").write_text(json.dumps(self.danish))
        registry = {
            "default": "da",
            "languages": [
                {"code": "da", "name": "Dansk", "locale": "da-DK"},
                {"code": "en", "name": "English", "locale": "en-GB"},
            ],
        }
        (self.root / "index.json").write_text(json.dumps(registry))
        patcher = patch.object(i18n, "LANGUAGE_ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.not_found = next(
            key
            for key, value in self.danish["messages"].items()
            if key.startswith("api.") and value == "Ikke fundet"
        )
        self.dynamic = next(
            key
            for key, value in self.danish["messages"].items()
            if key.startswith("api.") and value == "{p0} findes ikke længere."
        )
        self.english = {
            "language": "en",
            "locale": "en-GB",
            "messages": {
                self.not_found: "Not found",
                self.dynamic: "{p0} no longer exists.",
            },
        }
        (self.root / "en.json").write_text(json.dumps(self.english))

    def test_header_selection_supports_regions_and_rejects_unregistered_paths(self):
        self.assertEqual(i18n.choose_language("en-GB,en;q=0.9"), "en")
        self.assertEqual(i18n.choose_language("de,da;q=0.8"), "da")
        self.assertEqual(i18n.choose_language("../../secret"), "da")
        self.assertEqual(i18n.locale_asset("en"), self.root / "en.json")
        self.assertIsNone(i18n.locale_asset("../en"))
        self.assertIsNone(i18n.locale_asset("zz"))

    def test_errors_translate_without_mutating_original_response_or_user_notes(self):
        original = {"error": "Ikke fundet", "note": "Ikke fundet", "status": "pending"}
        result = i18n.localize_response(original, "en")
        self.assertEqual(result["error"], "Not found")
        self.assertEqual(result["error_key"], self.not_found)
        self.assertEqual(result["note"], original["note"])
        self.assertEqual(result["status"], "pending")
        self.assertEqual(original["error"], "Ikke fundet")
        result = i18n.localize_response(
            {"error": "Custom item findes ikke længere."}, "en"
        )
        self.assertEqual(result["error"], "Custom item no longer exists.")
        self.assertEqual(result["error_params"], {"p0": "Custom item"})
        self.assertEqual(
            i18n.localize_response({"error": "Unknown system error"}, "en")["error"],
            "Unknown system error",
        )

    def test_partial_or_broken_language_file_keeps_api_errors_usable(self):
        text = "Filen findes ikke længere."
        self.assertEqual(i18n.localize_response({"error": text}, "en")["error"], text)
        (self.root / "en.json").write_text("{broken")
        self.assertEqual(
            i18n.localize_response({"error": "Ikke fundet"}, "en")["error"],
            "Ikke fundet",
        )

    def test_edited_catalog_is_used_without_restarting_the_server(self):
        self.assertEqual(i18n.translate_message("Ikke fundet", "en")[0], "Not found")
        self.english["messages"][self.not_found] = "Missing resource"
        (self.root / "en.json").write_text(json.dumps(self.english))
        self.assertEqual(
            i18n.translate_message("Ikke fundet", "en")[0], "Missing resource"
        )

    def test_every_static_api_error_has_a_danish_catalog_entry(self):
        import ast

        missing = []
        exact = {
            value
            for value in self.danish["messages"].values()
            if isinstance(value, str)
        }
        for path in (Path(__file__).resolve().parents[1] / "src").glob("*.py"):
            if path.name in {
                "deploy.py",
                "i18n.py",
                "database.py",
                "mysql_backend.py",
                "app.py",
            }:
                continue
            for node in ast.walk(ast.parse(path.read_text())):
                if (
                    isinstance(node, ast.Raise)
                    and isinstance(node.exc, ast.Call)
                    and node.exc.args
                ):
                    value = node.exc.args[0]
                    # Operational English exception codes are not UI copy.
                    if (
                        isinstance(value, ast.Constant)
                        and isinstance(value.value, str)
                        and any(char in value.value for char in "æøåÆØÅ")
                        and value.value not in exact
                    ):
                        missing.append((path.name, value.value))
        self.assertEqual(missing, [])
