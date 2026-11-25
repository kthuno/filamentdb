"""Template persistence and validation use disposable databases only."""

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from src import config, database, label_templates
from src.http_server import Handler


class LabelTemplateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.db_patch = patch.object(
            database, "DB", Path(cls.directory.name) / "templates.sqlite3"
        )
        cls.db_patch.start()
        database.initialize()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.db_patch.stop()
        cls.directory.cleanup()

    def setUp(self):
        with database.connect() as conn:
            conn.execute("DELETE FROM label_templates")

    def request(self, path="", method="GET", data=None, headers=None):
        request = urllib.request.Request(
            self.url + "/api/label-templates" + path,
            method=method,
            data=json.dumps(data).encode() if data is not None else None,
            headers=headers or {},
        )
        with urllib.request.urlopen(request) as response:
            return response.status, json.load(response)

    def example(self, size="40x30"):
        return json.loads(
            (
                Path(__file__).resolve().parents[1]
                / "docs/examples"
                / f"label-template-{size}.json"
            ).read_text()
        )

    def test_app_version_variable_is_accepted_and_preserved(self):
        design = self.example()
        design["elements"][0]["text"] = "Filament DB $appversion$"
        self.request("/40x30", "PUT", {"design": design, "expected_revision": None})
        result = self.request()[1]
        self.assertEqual(result["app_version"], config.VERSION)
        self.assertEqual(result["templates"][0]["design"], design)

    def test_shared_round_trip_and_independent_sizes(self):
        self.assertEqual(
            self.request()[1], {"templates": [], "app_version": config.VERSION}
        )
        for size in label_templates.SIZES:
            self.request(
                "/" + size,
                "PUT",
                {"design": self.example(size), "expected_revision": None},
            )
        records = self.request()[1]["templates"]
        self.assertEqual(len(records), 3)
        for record in records:
            self.assertEqual(record["design"], self.example(record["size"]))
            self.assertEqual(len(record["revision"]), 32)
        selected = next(record for record in records if record["size"] == "60x40")
        self.request("/60x40", "DELETE", {"expected_revision": selected["revision"]})
        self.assertEqual(len(self.request()[1]["templates"]), 2)
        self.request("/60x40", "DELETE", {"expected_revision": None})
        self.assertEqual(len(self.request()[1]["templates"]), 2)

    def test_stale_clients_cannot_replace_or_delete_and_errors_are_localized(self):
        self.request(
            "/40x30", "PUT", {"design": self.example(), "expected_revision": None}
        )
        record = self.request()[1]["templates"][0]
        for method, payload in [
            ("PUT", {"design": self.example(), "expected_revision": None}),
            ("DELETE", {"expected_revision": "stale"}),
        ]:
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request("/40x30", method, payload, {"Accept-Language": "en"})
            self.assertEqual(error.exception.code, 409)
            body = json.load(error.exception)
            self.assertIn("another browser", body["error"])
        self.assertEqual(self.request()[1]["templates"][0], record)

    def test_validation_rolls_back_existing_templates(self):
        self.request(
            "/40x30", "PUT", {"design": self.example(), "expected_revision": None}
        )
        record = self.request()[1]["templates"][0]
        invalid = [None, {}, self.example("60x40")]
        for change in [
            lambda d: d["elements"][0].update(text="$unknown$"),
            lambda d: d["elements"][0].update(x="$spoolid$"),
            lambda d: d["elements"][0].update(width=-1),
            lambda d: d["elements"][0].update(fontSize=True),
            lambda d: d["elements"].append(
                {
                    "id": "evil",
                    "type": "image",
                    "x": 0,
                    "y": 0,
                    "width": 10,
                    "height": 10,
                    "imageData": "https://example.com/evil.png",
                }
            ),
        ]:
            design = self.example()
            change(design)
            invalid.append(design)
        for design in invalid:
            with (
                self.subTest(design=design),
                self.assertRaises(urllib.error.HTTPError) as error,
            ):
                self.request(
                    "/40x30",
                    "PUT",
                    {"design": design, "expected_revision": record["revision"]},
                )
            self.assertEqual(error.exception.code, 400)
        self.assertEqual(self.request()[1]["templates"][0], record)

    def test_repeatable_migration_retains_templates_and_inventory(self):
        self.request(
            "/40x30", "PUT", {"design": self.example(), "expected_revision": None}
        )
        before = self.request()[1]
        with database.connect() as conn:
            conn.execute(
                "INSERT INTO filaments (name,manufacturer,material,weight,remaining,label_token) VALUES ('Keep','Test','PLA',1000,500,'permanent-test')"
            )
        try:
            database.initialize()
            database.initialize()
            self.assertEqual(self.request()[1], before)
            with database.connect() as conn:
                self.assertEqual(
                    conn.execute(
                        "SELECT remaining FROM filaments WHERE label_token='permanent-test'"
                    ).fetchone()["remaining"],
                    500,
                )
        finally:
            with database.connect() as conn:
                conn.execute("DELETE FROM filaments WHERE label_token='permanent-test'")

    def test_origin_limits_and_exact_bundled_logo(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(
                "/40x30",
                "PUT",
                {"design": self.example(), "expected_revision": None},
                {"Origin": "https://untrusted.example"},
            )
        self.assertEqual(error.exception.code, 403)
        design = self.example()
        design["elements"].append(
            {
                "id": "logo",
                "type": "image",
                "x": 0,
                "y": 0,
                "width": 100,
                "height": 20,
                "imageData": label_templates._bundled_logo(),
            }
        )
        self.request("/40x30", "PUT", {"design": design, "expected_revision": None})
        design["elements"][-1]["imageData"] += "modified"
        with self.assertRaises(ValueError):
            label_templates.validate_template(design, "40x30")
        design = self.example()
        design["name"] = "x" * (label_templates.MAX_TEMPLATE + 1)
        with self.assertRaises(ValueError):
            label_templates.validate_template(design, "40x30")

    def test_mysql_schema_uses_sufficient_capacity_without_new_grants(self):
        statements = []

        class Connection:
            def execute(self, sql):
                statements.append(sql)

        label_templates.initialize(Connection(), mysql=True)
        self.assertIn("MEDIUMTEXT", statements[0])
        self.assertIn("ENGINE=InnoDB", statements[0])
