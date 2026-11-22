import base64
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from src import config, database, validation
from src.http_server import Handler


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        database.DB = Path(cls.directory.name) / "test.sqlite3"
        database.initialize()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.directory.cleanup()

    def request(self, path, method="GET", data=None, headers=None):
        request = urllib.request.Request(
            self.url + path,
            method=method,
            data=json.dumps(data).encode() if data is not None else None,
            headers=headers or {},
        )
        return urllib.request.urlopen(request)

    def _cleanup_ai_print(self, identity):
        with database.connect() as conn:
            articles = conn.execute(
                "SELECT article_id FROM knowledge_sources WHERE print_id=?", (identity,)
            ).fetchall()
            for row in articles:
                conn.execute(
                    "DELETE FROM knowledge_article_tags WHERE article_id=?",
                    (row["article_id"],),
                )
                conn.execute(
                    "DELETE FROM knowledge_sources WHERE article_id=?",
                    (row["article_id"],),
                )
                conn.execute(
                    "DELETE FROM knowledge_articles WHERE id=?", (row["article_id"],)
                )
            conn.execute("DELETE FROM prints WHERE id=?", (identity,))

    def test_ai_suggestion_is_transient_and_explicitly_approved(self):
        from src import knowledge_ai

        knowledge_ai._CACHE.clear()
        with database.connect() as conn:
            category = conn.execute(
                "SELECT id FROM knowledge_categories ORDER BY id"
            ).fetchone()["id"]
            identity = conn.execute(
                "INSERT INTO prints (name,print_date,note,status) VALUES ('AI source','2026-11-14','Første lag sad fast','completed')"
            ).lastrowid
        self.addCleanup(self._cleanup_ai_print, identity)
        proposal = {
            "title": "AI approval test",
            "summary": "PETG",
            "observation": "Første lag sad fast",
            "possible_cause": "",
            "resolution": "",
            "lessons_learned": "",
            "sufficient": True,
            "reason": "",
            "category_id": category,
            "confidence": "hypothesis",
            "tags": [],
        }

        def provider(settings, context_json, categories):
            context = json.loads(context_json)
            self.assertEqual(
                set(context["print"]),
                {"name", "note", "status", "print_date", "materials"},
            )
            self.assertNotIn("image", context_json)
            # Another writer can proceed while the AI call runs.
            with database.connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                conn.execute("UPDATE prints SET name=name WHERE id=?", (identity,))
            return proposal

        path = f"/api/prints/{identity}/knowledge-suggestion"
        with (
            patch.dict(
                os.environ, OPENAI_API_KEY="private-test-key", OPENAI_MODEL="test-model"
            ),
            patch.object(knowledge_ai, "request_openai", side_effect=provider) as mock,
        ):
            response = json.load(self.request(path, "POST"))
            self.assertFalse(response["cached"])
            self.assertTrue(json.load(self.request(path, "POST"))["cached"])
            mock.assert_called_once()
        self.assertNotIn("private-test-key", json.dumps(response))
        self.assertEqual(json.load(self.request("/api/knowledge?q=approval")), [])
        payload = dict(
            proposal,
            origin="ai_assisted",
            status="published",
            sources=[{"print_id": identity}],
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("/api/knowledge", "POST", payload)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        payload["approve_ai"] = True
        self.request("/api/knowledge", "POST", payload)
        article = json.load(self.request("/api/knowledge?q=approval"))[0]
        self.assertEqual(article["origin"], "ai_assisted")
        self.assertEqual(article["status"], "published")
        self.assertEqual(article["sources"][0]["print_id"], identity)
        knowledge_ai._CACHE.clear()

    def test_ai_suggestion_failure_preserves_normal_application(self):
        from src import knowledge_ai

        with database.connect() as conn:
            identity = conn.execute(
                "INSERT INTO prints (name,print_date,note,status) VALUES ('AI errors','2026-11-14','','completed')"
            ).lastrowid
        self.addCleanup(self._cleanup_ai_print, identity)
        path = f"/api/prints/{identity}/knowledge-suggestion"
        with patch.object(knowledge_ai, "request_openai") as provider:
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(path, "POST")
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
            provider.assert_not_called()
        with database.connect() as conn:
            conn.execute(
                "UPDATE prints SET note='Konkret erfaring' WHERE id=?", (identity,)
            )
        with patch.dict(os.environ, OPENAI_API_KEY=""):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(path, "POST")
            self.assertEqual(error.exception.code, 503)
            self.assertIn("OPENAI_API_KEY", error.exception.read().decode())
            error.exception.close()
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(path, "POST", headers={"Origin": "https://other.invalid"})
        self.assertEqual(error.exception.code, 403)
        error.exception.close()
        self.assertEqual(self.request("/api/filaments").status, 200)
        self.assertEqual(self.request("/api/knowledge").status, 200)

    def test_knowledge_category_update_delete_and_validation(self):
        self.request("/api/knowledge-categories", "POST", {"name": "CRUD kategori"})
        category = next(
            c
            for c in json.load(self.request("/api/knowledge-categories"))
            if c["name"] == "CRUD kategori"
        )
        path = f"/api/knowledge-categories/{category['id']}"
        self.request(path, "PUT", {"name": "Omdøbt CRUD"})
        self.assertEqual(
            next(
                c
                for c in json.load(self.request("/api/knowledge-categories"))
                if c["id"] == category["id"]
            )["name"],
            "Omdøbt CRUD",
        )
        for method, data, headers, status in (
            ("PUT", {"name": ""}, {}, 400),
            ("PUT", {"name": "Blocked"}, {"Origin": "https://other.invalid"}, 403),
        ):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(path, method, data, headers)
            self.assertEqual(error.exception.code, status)
            error.exception.close()
        self.request(path, "DELETE")
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(path, "PUT", {"name": "Missing"})
        self.assertEqual(error.exception.code, 404)
        error.exception.close()

    def test_knowledge_article_delete_api(self):
        category = json.load(self.request("/api/knowledge-categories"))[0]
        self.request(
            "/api/knowledge",
            "POST",
            {
                "title": "Delete API article",
                "category_id": category["id"],
                "tags": ["Delete test"],
            },
        )
        article = next(
            row
            for row in json.load(self.request("/api/knowledge?q=Delete+API+article"))
            if row["title"] == "Delete API article"
        )
        path = f"/api/knowledge/{article['id']}"
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(path, "DELETE", headers={"Origin": "https://other.invalid"})
        self.assertEqual(error.exception.code, 403)
        error.exception.close()
        self.assertEqual(self.request(path, "DELETE").status, 200)
        for method in ("GET", "DELETE"):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(path, method)
            self.assertEqual(error.exception.code, 404)
            error.exception.close()
        # MySQL full-text search may still match other articles containing "API".
        self.assertNotIn(
            article["id"],
            {
                row["id"]
                for row in json.load(
                    self.request("/api/knowledge?q=Delete+API+article")
                )
            },
        )
        self.assertNotIn(
            "Delete test",
            [tag["name"] for tag in json.load(self.request("/api/knowledge-tags"))],
        )

    def test_knowledge_api_lifecycle_and_origin(self):
        categories = json.load(self.request("/api/knowledge-categories"))
        payload = {
            "title": "Knowledge API test PEI",
            "summary": "PETG-test",
            "category_id": categories[0]["id"],
            "confidence": "hypothesis",
            "status": "draft",
            "tags": ["API"],
            "sources": [],
        }
        self.assertEqual(self.request("/api/knowledge", "POST", payload).status, 201)
        articles = json.load(self.request("/api/knowledge?q=PEI&tag=API"))
        article = next(a for a in articles if a["title"] == payload["title"])
        path = f"/api/knowledge/{article['id']}"
        self.assertEqual(json.load(self.request(path))["status"], "draft")
        self.request(path + "/publish", "POST")
        self.assertEqual(json.load(self.request(path))["status"], "published")
        self.request(path + "/archive", "POST")
        self.assertEqual(json.load(self.request(path))["status"], "archived")
        tags = json.load(self.request("/api/knowledge-tags"))
        api_tag = next(tag for tag in tags if tag["name"] == "API")
        self.assertEqual(api_tag["article_count"], 1)
        updated_categories = json.load(self.request("/api/knowledge-categories"))
        updated_category = next(
            row for row in updated_categories if row["id"] == categories[0]["id"]
        )
        self.assertEqual(
            updated_category["article_count"], categories[0]["article_count"] + 1
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(path, "PUT", dict(payload, confidence="verified"))
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(
                "/api/knowledge", "POST", payload, {"Origin": "https://other.invalid"}
            )
        self.assertEqual(error.exception.code, 403)
        error.exception.close()
        self.assertEqual(self.request("/knowledge.js").status, 200)

    def test_ht_and_persistent_material_types(self):
        self.request("/api/locations", "POST", {"name": "HT test", "kind": "ams_ht"})
        place = next(
            p
            for p in json.load(self.request("/api/locations"))
            if p["name"] == "HT test"
        )
        payload = {
            "name": "Sparkle test",
            "manufacturer": "Test",
            "material": "PLA Sparkle",
            "price": 0,
            "diameter": 1.75,
            "nozzle_temp": 0,
            "bed_temp": 0,
            "weight": 1000,
            "remaining": 1000,
            "color_hex": "#ffffff",
            "location_id": place["id"],
            "location_slot": 1,
        }
        self.request("/api/filaments", "POST", payload)
        spool = json.load(self.request("/api/filaments"))[0]
        self.assertEqual(spool["active_slot"], "HT test")
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("/api/filaments", "POST", dict(payload, location_slot=2))
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("/api/filaments", "POST", payload)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        self.request(f"/api/filaments/{spool['id']}", "DELETE")
        database.initialize()
        database.initialize()
        names = json.load(self.request("/api/material-types"))
        self.assertEqual(names.count("PLA Sparkle"), 1)
        self.request(f"/api/locations/{place['id']}", "DELETE")

    def test_location_contents_endpoint_moves_and_clears_without_overwriting_stock(
        self,
    ):
        self.request(
            "/api/locations", "POST", {"name": "Content API test", "kind": "ams_ht"}
        )
        place = next(
            row["id"]
            for row in json.load(self.request("/api/locations"))
            if row["name"] == "Content API test"
        )
        with database.connect() as conn:
            spool = conn.execute(
                "INSERT INTO filaments (name,manufacturer,material,weight,remaining,label_token) VALUES ('Content API spool','Test','PLA',1000,700,'content-api-token')"
            ).lastrowid
        try:
            path = f"/api/locations/{place}/contents"
            self.request(
                path,
                "PUT",
                {"slot": 1, "filament_id": spool, "expected_filament_id": None},
            )
            with database.connect() as conn:
                linked = dict(
                    conn.execute(
                        "SELECT * FROM filaments WHERE id=?", (spool,)
                    ).fetchone()
                )
            self.assertEqual(linked["active_slot"], "Content API test")
            self.assertEqual(linked["remaining"], 700)
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(
                    path,
                    "PUT",
                    {"slot": 1, "filament_id": None, "expected_filament_id": None},
                )
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
            self.request(
                path,
                "PUT",
                {"slot": 1, "filament_id": None, "expected_filament_id": spool},
            )
            with database.connect() as conn:
                cleared = dict(
                    conn.execute(
                        "SELECT * FROM filaments WHERE id=?", (spool,)
                    ).fetchone()
                )
            self.assertIsNone(cleared["location_id"])
            self.assertEqual(cleared["remaining"], 700)
            self.assertEqual(cleared["label_token"], "content-api-token")
        finally:
            with database.connect() as conn:
                conn.execute("DELETE FROM filaments WHERE id=?", (spool,))
                conn.execute("DELETE FROM locations WHERE id=?", (place,))

    def test_defined_locations_capacity_crud_and_atomic_booking(self):
        def rejected(path, method, data=None, status=400):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(path, method, data)
            self.assertEqual(error.exception.code, status)
            error.exception.close()

        self.request(
            "/api/locations", "POST", {"name": "Test AMS", "kind": "ams_2_pro"}
        )
        place = next(
            p
            for p in json.load(self.request("/api/locations"))
            if p["name"] == "Test AMS"
        )
        place_id = place["id"]
        path = f"/api/locations/{place_id}"
        rejected("/api/locations", "POST", {"name": "test ams", "kind": "box"})
        rejected("/api/locations", "POST", {"name": "", "kind": "box"})
        rejected("/api/locations", "POST", {"name": "Invalid", "kind": "other"})
        sample = {
            "name": "Location test",
            "manufacturer": "Test",
            "material": "PLA",
            "color_hex": "#ffffff",
            "weight": 1000,
            "remaining": 1000,
            "price": 0,
            "diameter": 1.75,
            "nozzle_temp": 0,
            "bed_temp": 0,
            "location_id": place_id,
            "location_slot": 4,
        }
        self.request("/api/filaments", "POST", sample)
        spool = json.load(self.request("/api/filaments"))[0]
        spool_path = f"/api/filaments/{spool['id']}"
        rejected("/api/filaments", "POST", sample)
        rejected("/api/filaments", "POST", dict(sample, location_slot=5))
        rejected("/api/filaments", "POST", dict(sample, location_slot=0))
        rejected("/api/filaments", "POST", dict(sample, location_id=999999))
        rejected("/api/filaments", "POST", dict(sample, location_slot=1, quantity=2))
        rejected(path, "DELETE")
        rejected(path, "PUT", {"name": "Test AMS", "kind": "ams_ht"})
        self.request(path, "PUT", {"name": "Renamed AMS", "kind": "ams_2_pro"})
        updated = next(
            row
            for row in json.load(self.request("/api/filaments"))
            if row["id"] == spool["id"]
        )
        self.assertEqual(updated["location"], "Renamed AMS · slot 4")
        self.assertEqual(updated["label_token"], spool["label_token"])
        self.request(spool_path, "PUT", dict(sample, location_slot=1))
        self.request(path, "PUT", {"name": "Renamed AMS", "kind": "ams_ht"})
        rejected("/api/filaments", "POST", dict(sample, location_slot=2))
        self.request(
            spool_path,
            "PUT",
            dict(sample, location_id=None, location_slot=None, location="Hylde A"),
        )
        for kind in ("box", "ams_ht"):
            self.request(path, "PUT", {"name": "Renamed AMS", "kind": kind})
            self.request("/api/filaments", "POST", dict(sample, location_slot=1))
            extra = json.load(self.request("/api/filaments"))[0]
            rejected("/api/filaments", "POST", dict(sample, location_slot=1))
            self.request(f"/api/filaments/{extra['id']}", "DELETE")
        database.initialize()
        database.initialize()
        self.assertEqual(
            next(
                p
                for p in json.load(self.request("/api/locations"))
                if p["id"] == place_id
            )["name"],
            "Renamed AMS",
        )
        self.request(path, "DELETE")
        self.request(spool_path, "DELETE")
        rejected(path, "DELETE", status=404)

    def test_default_ams_and_linked_active_slot(self):
        places = json.load(self.request("/api/locations"))
        default = next(p for p in places if p["name"] == "AMS 2 Pro")
        database.initialize()
        self.assertEqual(len(json.load(self.request("/api/locations"))), len(places))
        payload = {
            "name": "Linked spool",
            "manufacturer": "Test",
            "material": "PLA",
            "color_hex": "#ffffff",
            "weight": 1000,
            "remaining": 1000,
            "price": 0,
            "diameter": 1.75,
            "nozzle_temp": 0,
            "bed_temp": 0,
            "location_id": default["id"],
            "location_slot": 2,
            "active_slot": "Ignored manual slot",
        }
        self.request("/api/filaments", "POST", payload)
        spool = json.load(self.request("/api/filaments"))[0]
        path = f"/api/filaments/{spool['id']}"

        def current():
            return next(
                s
                for s in json.load(self.request("/api/filaments"))
                if s["id"] == spool["id"]
            )

        self.assertEqual(current()["active_slot"], "AMS 2 Pro · slot 2")
        self.request(path, "PUT", dict(payload, location_slot=3))
        self.assertEqual(current()["active_slot"], "AMS 2 Pro · slot 3")
        self.request(
            path + "/consumption", "POST", {"grams": 1000, "note": "Empty AMS"}
        )
        self.assertEqual(current()["active_slot"], "")
        self.assertEqual(current()["location_slot"], 3)
        entry = json.load(self.request(path + "/consumption"))[0]
        self.request(f"/api/consumption/{entry['id']}", "DELETE")
        self.assertEqual(current()["active_slot"], "AMS 2 Pro · slot 3")
        self.request(
            f"/api/locations/{default['id']}",
            "PUT",
            {"name": "Renamed default", "kind": "ams_2_pro"},
        )
        self.assertEqual(current()["active_slot"], "Renamed default · slot 3")
        self.request(
            path,
            "PUT",
            dict(payload, location_id=None, location_slot=None, location="Hylde"),
        )
        self.assertEqual(current()["active_slot"], "")
        self.assertEqual(current()["location"], "Hylde")
        self.request(path, "DELETE")
        self.request(f"/api/locations/{default['id']}", "DELETE")
        database.initialize()
        self.assertFalse(
            any(
                p["id"] == default["id"]
                for p in json.load(self.request("/api/locations"))
            )
        )
        self.assertFalse(
            any(
                p["kind"] == "ams_2_pro"
                for p in json.load(self.request("/api/locations"))
            )
        )
        self.request(
            "/api/locations", "POST", {"name": "AMS 2 Pro", "kind": "ams_2_pro"}
        )

    def test_crud_and_validation(self):
        sample = {
            "transparency": "transparent",
            "product_url": "https://shop.example/pla?sku=00123",
            "product_id": "00123-PLA",
            "purchase_format": "spool",
            "name": "PLA <test>",
            "manufacturer": "Bambu Lab",
            "material": "PLA",
            "color": "Hvid",
            "color_hex": "#ffffff",
            "purchase_date": "2026-11-08",
            "opened_date": "",
            "weight": 1000,
            "remaining": 450,
            "price": 159,
            "diameter": 1.75,
            "nozzle_temp": 220,
            "bed_temp": 60,
            "location": "AMS",
            "notes": "=SUM(A1)",
        }
        self.assertEqual(self.request("/api/filaments", "POST", sample).status, 201)
        records = json.load(self.request("/api/filaments"))
        self.assertEqual(records[0]["remaining"], 450)
        self.assertEqual(records[0]["transparency"], "transparent")
        with self.assertRaises(ValueError):
            validation.validate(dict(sample, transparency="invalid"))
        self.assertEqual(records[0]["purchase_format"], "spool")
        self.assertEqual(records[0]["product_id"], "00123-PLA")
        self.assertEqual(records[0]["product_url"], sample["product_url"])
        for invalid in (
            "javascript:alert(1)",
            "ftp://shop.example/a",
            "https://",
            "https://user:pass@shop.example/a",
        ):
            with self.assertRaises(ValueError):
                validation.validate(dict(sample, product_url=invalid))
        self.assertEqual(records[0]["weight"], 1000)
        identity = records[0]["id"]
        sample["remaining"] = 1250
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(f"/api/filaments/{identity}", "PUT", sample)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        sample["purchase_format"] = "invalid"
        sample["remaining"] = 100
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(f"/api/filaments/{identity}", "PUT", sample)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        sample["purchase_format"] = "refill"
        sample["transparency"] = "opaque"
        sample["product_id"] = "00456-PETG"
        sample["product_url"] = "https://shop.example/petg"
        self.request(f"/api/filaments/{identity}", "PUT", sample)
        updated = json.load(self.request("/api/filaments"))[0]
        self.assertEqual(updated["remaining"], 100)
        self.assertEqual(updated["transparency"], "opaque")
        self.assertEqual(updated["purchase_format"], "refill")
        self.assertEqual(updated["product_id"], "00456-PETG")
        self.assertEqual(updated["product_url"], sample["product_url"])
        with database.connect() as connection:
            self.assertEqual(
                connection.execute("SELECT remaining FROM filaments").fetchone()[
                    "remaining"
                ],
                100,
            )
        exported = self.request("/api/export").read().decode("utf-8-sig")
        self.assertIn("'=SUM(A1)", exported)
        self.assertIn("https://shop.example/petg", exported)
        self.assertIn("product_id", exported)
        self.assertIn("00456-PETG", exported)
        self.assertIn("purchase_format", exported)
        self.assertIn("refill", exported)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(
                "/api/filaments", "POST", sample, {"Origin": "https://other.example"}
            )
        self.assertEqual(error.exception.code, 403)
        error.exception.close()
        self.request(f"/api/filaments/{identity}", "DELETE")
        self.assertEqual(json.load(self.request("/api/filaments")), [])
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(f"/api/filaments/{identity}", "PUT", sample)
        self.assertEqual(error.exception.code, 404)
        error.exception.close()

    def test_batch_creation_is_validated_and_spools_are_independent(self):
        sample = {
            "name": "Batch PLA",
            "manufacturer": "Test",
            "material": "PLA",
            "color_hex": "#ffffff",
            "weight": 1000,
            "remaining": 1000,
            "price": 150,
            "diameter": 1.75,
            "nozzle_temp": 220,
            "bed_temp": 60,
            "purchase_format": "spool",
            "quantity": 2,
        }
        for quantity in (0, -1, 101, 1.5, True, "2"):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request("/api/filaments", "POST", dict(sample, quantity=quantity))
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        self.assertEqual(json.load(self.request("/api/filaments")), [])
        self.request("/api/filaments", "POST", sample)
        records = json.load(self.request("/api/filaments"))
        self.assertEqual(len(records), 2)
        self.assertNotEqual(records[0]["id"], records[1]["id"])
        self.assertEqual(sum(row["remaining"] for row in records), 2000)
        self.assertEqual(sum(row["price"] for row in records), 300)
        updated = {
            key: value for key, value in records[0].items() if key in validation.FIELDS
        }
        updated["remaining"] = 250
        self.request(f"/api/filaments/{records[0]['id']}", "PUT", updated)
        self.assertEqual(
            sorted(
                row["remaining"] for row in json.load(self.request("/api/filaments"))
            ),
            [250, 1000],
        )
        for row in records:
            self.request(f"/api/filaments/{row['id']}", "DELETE")

    def test_consumption_updates_only_selected_spool_and_preserves_history(self):
        sample = {
            "name": "Usage PLA",
            "manufacturer": "Test",
            "material": "PLA",
            "color_hex": "#ffffff",
            "weight": 1000,
            "remaining": 500,
            "price": 100,
            "diameter": 1.75,
            "nozzle_temp": 220,
            "bed_temp": 60,
            "quantity": 2,
        }
        self.request("/api/filaments", "POST", sample)
        records = json.load(self.request("/api/filaments"))
        identity = records[0]["id"]
        endpoint = f"/api/filaments/{identity}/consumption"
        self.assertEqual(json.load(self.request(endpoint)), [])
        for grams in (0, -5, 501, True, "10", None):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(endpoint, "POST", {"grams": grams})
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        self.assertEqual(json.load(self.request(endpoint)), [])
        self.request(endpoint, "POST", {"grams": 125.5, "note": "Test print"})
        remaining = {
            row["id"]: row["remaining"]
            for row in json.load(self.request("/api/filaments"))
        }
        self.assertEqual(remaining[identity], 374.5)
        self.assertEqual(remaining[records[1]["id"]], 500)
        database.initialize()
        history = json.load(self.request(endpoint))
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["grams"], 125.5)
        self.assertEqual(history[0]["note"], "Test print")
        self.assertTrue(history[0]["created_at"])
        self.request(endpoint, "POST", {"grams": 374.5})
        remaining = {
            row["id"]: row["remaining"]
            for row in json.load(self.request("/api/filaments"))
        }
        self.assertEqual(remaining[identity], 0)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(endpoint, "POST", {"grams": 1})
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        self.assertEqual(len(json.load(self.request(endpoint))), 2)
        all_usage = json.load(self.request("/api/consumption"))
        self.assertEqual(len(all_usage), 2)
        self.assertEqual(all_usage[0]["name"], "Usage PLA")
        usage_id = all_usage[0]["id"]
        self.request(f"/api/consumption/{usage_id}", "DELETE")
        remaining = {
            row["id"]: row["remaining"]
            for row in json.load(self.request("/api/filaments"))
        }
        self.assertEqual(remaining[identity], 374.5)
        self.assertEqual(len(json.load(self.request("/api/consumption"))), 1)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(f"/api/consumption/{usage_id}", "DELETE")
        self.assertEqual(error.exception.code, 404)
        error.exception.close()
        # Manual restocking must not allow undo to exceed the original weight.
        with database.connect() as connection:
            connection.execute(
                "UPDATE filaments SET remaining=weight WHERE id=?", (identity,)
            )
        last_id = json.load(self.request(endpoint))[0]["id"]
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(f"/api/consumption/{last_id}", "DELETE")
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        self.assertEqual(len(json.load(self.request(endpoint))), 1)
        for row in records:
            self.request(f"/api/filaments/{row['id']}", "DELETE")
        with database.connect() as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) AS count FROM consumption"
                ).fetchone()["count"],
                0,
            )
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(endpoint, "POST", {"grams": 1})
        self.assertEqual(error.exception.code, 404)
        error.exception.close()

    def test_active_slots_and_permanent_labels(self):
        sample = {
            "name": "PLA",
            "manufacturer": "Test",
            "material": "PLA Basic",
            "weight": 1000,
            "remaining": 1000,
            "price": 100,
            "diameter": 1.75,
            "nozzle_temp": 220,
            "bed_temp": 60,
            "color_hex": "#ffffff",
            "quantity": 2,
        }
        self.request("/api/filaments", "POST", sample)
        rows = json.load(self.request("/api/filaments"))
        self.assertEqual(len({row["label_token"] for row in rows}), 2)
        first, second = rows
        payload = {key: first[key] for key in validation.FIELDS}
        payload["active_slot"] = "AMS 1 · plads 1"
        self.request(f"/api/filaments/{first['id']}", "PUT", payload)
        other = {key: second[key] for key in validation.FIELDS}
        other["active_slot"] = "ams 1 · plads 1"
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(f"/api/filaments/{second['id']}", "PUT", other)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("/api/filaments", "POST", dict(sample, active_slot="External"))
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        self.request(
            f"/api/filaments/{first['id']}/consumption", "POST", {"grams": 1000}
        )
        updated = {row["id"]: row for row in json.load(self.request("/api/filaments"))}
        self.assertEqual(updated[first["id"]]["active_slot"], "")
        self.assertEqual(updated[first["id"]]["label_token"], first["label_token"])
        self.assertIn("label_token", self.request("/api/export").read().decode())
        self.assertEqual(self.request("/vendor/qrcodegen.js").status, 200)
        for row in rows:
            self.request(f"/api/filaments/{row['id']}", "DELETE")
        self.request("/api/filaments", "POST", dict(sample, quantity=1))
        replacement = json.load(self.request("/api/filaments"))[0]
        self.assertNotIn(
            replacement["label_token"], {row["label_token"] for row in rows}
        )
        self.request(f"/api/filaments/{replacement['id']}", "DELETE")

    def test_print_registration_and_undo_are_atomic(self):
        sample = {
            "name": "Project PLA",
            "manufacturer": "Test",
            "material": "PLA Basic",
            "weight": 1000,
            "remaining": 500,
            "price": 100,
            "diameter": 1.75,
            "nozzle_temp": 220,
            "bed_temp": 60,
            "color_hex": "#ffffff",
            "quantity": 2,
        }
        self.request("/api/filaments", "POST", sample)
        rows = json.load(self.request("/api/filaments"))
        first, second = rows[0]["id"], rows[1]["id"]
        payload = {
            "image": "data:image/jpeg;base64,"
            + base64.b64encode(b"\xff\xd8\xff\xe0thumbnail\xff\xd9").decode(),
            "name": "Multicolour sign",
            "print_date": "2026-11-08",
            "note": "<Project>",
            "items": [
                {"filament_id": first, "grams": 100},
                {"filament_id": second, "grams": 501},
            ],
        }
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("/api/prints", "POST", payload)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        self.assertEqual(
            [row["remaining"] for row in json.load(self.request("/api/filaments"))],
            [500, 500],
        )
        self.assertEqual(json.load(self.request("/api/consumption")), [])
        with database.connect() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) AS count FROM prints").fetchone()[
                    "count"
                ],
                0,
            )
        payload["items"][1]["grams"] = 75
        self.request("/api/prints", "POST", payload)
        history = json.load(self.request("/api/consumption"))
        self.assertEqual(len(history), 2)
        print_id = history[0]["print_id"]
        database.initialize()
        image_response = self.request(f"/api/prints/{print_id}/image")
        self.assertEqual(image_response.headers["Content-Type"], "image/jpeg")
        self.assertEqual(image_response.read(), b"\xff\xd8\xff\xe0thumbnail\xff\xd9")
        self.assertTrue(history[0]["has_image"])
        self.assertNotIn("image", history[0])
        self.assertEqual({row["print_id"] for row in history}, {print_id})
        self.assertEqual(history[0]["project_name"], "Multicolour sign")
        self.assertEqual(history[0]["print_date"], "2026-11-08")
        self.assertEqual(sum(row["grams"] for row in history), 175)
        for endpoint in (
            f"/api/consumption/{history[0]['id']}",
            f"/api/filaments/{first}",
        ):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(endpoint, "DELETE")
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        # Fail the second restoration after the first has run, then verify rollback.
        with database.connect() as conn:
            conn.execute("UPDATE filaments SET remaining=1000 WHERE id=?", (second,))
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(f"/api/prints/{print_id}", "DELETE")
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        amounts = {
            row["id"]: row["remaining"]
            for row in json.load(self.request("/api/filaments"))
        }
        self.assertEqual(amounts[first], 400)
        self.assertEqual(len(json.load(self.request("/api/consumption"))), 2)
        with database.connect() as conn:
            conn.execute("UPDATE filaments SET remaining=425 WHERE id=?", (second,))
        self.request(f"/api/prints/{print_id}", "DELETE")
        self.assertEqual(
            [row["remaining"] for row in json.load(self.request("/api/filaments"))],
            [500, 500],
        )
        self.assertEqual(json.load(self.request("/api/consumption")), [])
        for invalid in (
            dict(payload, name=""),
            dict(payload, print_date="bad-date"),
            dict(payload, image="data:image/svg+xml;base64,PHN2Zz4="),
            dict(payload, image="data:image/jpeg;base64,invalid"),
            dict(payload, image="data:image/jpeg;base64,YmFk"),
            dict(payload, image="x" * 700001),
            dict(payload, items=[]),
            dict(
                payload,
                items=[
                    {"filament_id": first, "grams": 1},
                    {"filament_id": first, "grams": 2},
                ],
            ),
            dict(payload, items=[{"filament_id": first, "grams": -1}]),
            dict(payload, items=[{"filament_id": 999999, "grams": 1}]),
        ):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request("/api/prints", "POST", invalid)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        for row in rows:
            self.request(f"/api/filaments/{row['id']}", "DELETE")

    def test_edit_print_adjusts_differences_and_rolls_back_on_failure(self):
        self.request(
            "/api/filaments",
            "POST",
            {
                "name": "Editable",
                "manufacturer": "Test",
                "material": "PLA",
                "weight": 1000,
                "remaining": 1000,
                "color_hex": "#ffffff",
                "price": 0,
                "diameter": 1.75,
                "nozzle_temp": 0,
                "bed_temp": 0,
                "quantity": 2,
            },
        )
        spools = json.load(self.request("/api/filaments"))[:2]
        first, second = (row["id"] for row in spools)
        image = (
            "data:image/jpeg;base64,"
            + base64.b64encode(b"\xff\xd8\xfftest\xff\xd9").decode()
        )
        payload = {
            "project_url": "https://example.com/model?a=1&b=2",
            "name": "Original",
            "print_date": "2026-11-12",
            "note": "",
            "image": image,
            "items": [{"filament_id": first, "grams": 1000}],
        }
        self.request("/api/prints", "POST", payload)
        identity = json.load(self.request("/api/consumption"))[0]["print_id"]
        endpoint = f"/api/prints/{identity}"
        original = json.load(self.request(endpoint))
        self.assertEqual(original["image"], image)
        self.assertEqual(original["project_url"], payload["project_url"])
        database.initialize()
        database.initialize()
        self.assertEqual(
            json.load(self.request(endpoint))["project_url"], payload["project_url"]
        )
        self.assertEqual(
            json.load(self.request("/api/consumption"))[0]["project_url"],
            payload["project_url"],
        )
        for invalid in (
            "javascript:alert(1)",
            "file:///tmp/model",
            "https://user:pass@example.com",
            "https://exa mple.com",
            "https://example.com/\\model",
            42,
            "x" * 5001,
        ):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(endpoint, "PUT", dict(payload, project_url=invalid))
            self.assertEqual(error.exception.code, 400)
            self.assertEqual(json.load(self.request(endpoint)), original)
        self.assertEqual(original["status"], "completed")
        stock_before = json.load(self.request("/api/filaments"))
        for status in ("pending", "in_progress", "failed", "completed"):
            self.request(endpoint, "PUT", dict(payload, status=status))
            self.assertEqual(json.load(self.request(endpoint))["status"], status)
            self.assertEqual(
                json.load(self.request("/api/consumption"))[0]["print_status"], status
            )
            self.assertEqual(json.load(self.request("/api/filaments")), stock_before)
            database.initialize()
            self.assertEqual(json.load(self.request(endpoint))["status"], status)
        for status in ("unknown", "", None, 1, []):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(endpoint, "PUT", dict(payload, status=status))
            self.assertEqual(error.exception.code, 400)
            self.assertEqual(json.load(self.request(endpoint))["status"], "completed")
            self.assertEqual(json.load(self.request("/api/filaments")), stock_before)
        self.assertIsNone(json.load(self.request(endpoint))["duration_minutes"])
        for duration in (185, 1, 1000000, None):
            self.request(endpoint, "PUT", dict(payload, duration_minutes=duration))
            self.assertEqual(
                json.load(self.request(endpoint))["duration_minutes"], duration
            )
            self.assertEqual(
                json.load(self.request("/api/consumption"))[0]["duration_minutes"],
                duration,
            )
            self.assertEqual(json.load(self.request("/api/filaments")), stock_before)
            database.initialize()
            self.assertEqual(
                json.load(self.request(endpoint))["duration_minutes"], duration
            )
        for duration in (0, -1, 1000001, 1.5, True, "60", []):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(endpoint, "PUT", dict(payload, duration_minutes=duration))
            self.assertEqual(error.exception.code, 400)
            self.assertIsNone(json.load(self.request(endpoint))["duration_minutes"])
            self.assertEqual(json.load(self.request("/api/filaments")), stock_before)
        revised = dict(
            payload,
            project_url="http://example.com/updated",
            name="Edited",
            note="Changed",
            items=[
                {"filament_id": first, "grams": 500},
                {"filament_id": second, "grams": 200},
            ],
        )
        self.request(endpoint, "PUT", revised)
        self.assertEqual(json.load(self.request(endpoint))["id"], identity)
        remaining = {
            row["id"]: row["remaining"]
            for row in json.load(self.request("/api/filaments"))
        }
        self.assertEqual((remaining[first], remaining[second]), (500, 800))
        before = json.load(self.request(endpoint))
        self.assertEqual(before["project_url"], "http://example.com/updated")
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(
                endpoint,
                "PUT",
                dict(
                    revised,
                    name="Must rollback",
                    items=[
                        {"filament_id": first, "grams": 100},
                        {"filament_id": second, "grams": 1001},
                    ],
                ),
            )
        self.assertEqual(error.exception.code, 400)
        self.assertEqual(json.load(self.request(endpoint)), before)
        self.assertEqual(
            {
                row["id"]: row["remaining"]
                for row in json.load(self.request("/api/filaments"))
            },
            remaining,
        )
        self.request(
            endpoint,
            "PUT",
            dict(
                revised,
                image="",
                project_url="",
                items=[{"filament_id": second, "grams": 300}],
            ),
        )
        self.assertEqual(json.load(self.request(endpoint))["image"], "")
        self.assertEqual(json.load(self.request(endpoint))["project_url"], "")
        remaining = {
            row["id"]: row["remaining"]
            for row in json.load(self.request("/api/filaments"))
        }
        self.assertEqual((remaining[first], remaining[second]), (1000, 700))
        self.request(endpoint, "DELETE")
        with self.assertRaises(urllib.error.HTTPError) as missing:
            self.request(endpoint, "PUT", revised)
        self.assertEqual(missing.exception.code, 404)
        for row in spools:
            self.request(f"/api/filaments/{row['id']}", "DELETE")

    def test_waste_crud_is_atomic_and_preserves_project_and_spool_identity(self):
        self.request(
            "/api/filaments",
            "POST",
            {
                "name": "Waste test",
                "manufacturer": "Test",
                "material": "PLA",
                "weight": 1000,
                "remaining": 1000,
                "color_hex": "#ffffff",
                "price": 0,
                "diameter": 1.75,
                "nozzle_temp": 0,
                "bed_temp": 0,
                "quantity": 2,
            },
        )
        spools = json.load(self.request("/api/filaments"))[:2]
        first, second = [row["id"] for row in spools]
        self.request(
            "/api/prints",
            "POST",
            {
                "name": "Failed",
                "print_date": "2026-11-12",
                "status": "failed",
                "items": [{"filament_id": first, "grams": 100}],
            },
        )
        project = json.load(self.request("/api/consumption"))[0]["print_id"]
        payload = {
            "waste_date": "2026-11-12",
            "reason": "purge",
            "note": "Extra",
            "project_id": project,
            "items": [
                {"filament_id": first, "grams": 50},
                {"filament_id": second, "grams": 100},
            ],
        }

        def stocks():
            return {
                row["id"]: row["remaining"]
                for row in json.load(self.request("/api/filaments"))
            }

        before = stocks()
        for invalid in (
            dict(payload, reason="unknown"),
            dict(payload, reason=[]),
            dict(payload, waste_date="bad"),
            dict(payload, project_id=999999),
            dict(payload, project_id=True),
            dict(payload, items=[]),
            dict(
                payload,
                items=[
                    {"filament_id": first, "grams": 50},
                    {"filament_id": second, "grams": 1001},
                ],
            ),
            dict(
                payload,
                items=[
                    {"filament_id": first, "grams": 1},
                    {"filament_id": first, "grams": 2},
                ],
            ),
            dict(payload, items=[{"filament_id": first, "grams": float("nan")}]),
        ):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request("/api/waste", "POST", invalid)
            self.assertEqual(error.exception.code, 400)
            self.assertEqual(stocks(), before)
        self.request("/api/waste", "POST", payload)
        usage = json.load(self.request("/api/consumption"))
        lines = [row for row in usage if row["waste_id"] is not None]
        self.assertEqual(len(lines), 2)
        identity = lines[0]["waste_id"]
        endpoint = f"/api/waste/{identity}"
        self.assertEqual({row["waste_id"] for row in lines}, {identity})
        self.assertEqual(lines[0]["linked_project_name"], "Failed")
        self.assertEqual(stocks()[first], 850)
        self.assertEqual(stocks()[second], 900)
        database.initialize()
        database.initialize()
        saved = json.load(self.request(endpoint))
        self.assertEqual(saved["reason"], "purge")
        for path in (f"/api/consumption/{lines[0]['id']}", f"/api/filaments/{second}"):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(path, "DELETE")
            self.assertEqual(error.exception.code, 400)
        with self.assertRaises(urllib.error.HTTPError):
            self.request(
                endpoint,
                "PUT",
                dict(
                    payload,
                    reason="other",
                    items=[
                        {"filament_id": first, "grams": 5},
                        {"filament_id": second, "grams": 1001},
                    ],
                ),
            )
        self.assertEqual(json.load(self.request(endpoint)), saved)
        self.assertEqual(stocks()[first], 850)
        # If a later line cannot be restored, the earlier restoration must roll back too.
        with database.connect() as conn:
            conn.execute("UPDATE filaments SET remaining=950 WHERE id=?", (second,))
        with self.assertRaises(urllib.error.HTTPError):
            self.request(endpoint, "DELETE")
        self.assertEqual(stocks()[first], 850)
        self.assertEqual(stocks()[second], 950)
        self.assertEqual(json.load(self.request(endpoint)), saved)
        with database.connect() as conn:
            conn.execute("UPDATE filaments SET remaining=900 WHERE id=?", (second,))
        self.request(
            endpoint,
            "PUT",
            dict(
                payload,
                reason="calibration",
                items=[{"filament_id": second, "grams": 200}],
            ),
        )
        self.assertEqual(stocks()[first], 900)
        self.assertEqual(stocks()[second], 800)
        # A linked project's deletion undoes only its own usage; independent waste survives.
        self.request(f"/api/prints/{project}", "DELETE")
        self.assertIsNone(json.load(self.request(endpoint))["project_id"])
        self.assertEqual(stocks()[first], 1000)
        with database.connect() as conn:
            conn.execute("UPDATE filaments SET remaining=950 WHERE id=?", (second,))
        with self.assertRaises(urllib.error.HTTPError):
            self.request(endpoint, "DELETE")
        self.assertEqual(stocks()[second], 950)
        self.assertEqual(len(json.load(self.request(endpoint))["items"]), 1)
        with database.connect() as conn:
            conn.execute("UPDATE filaments SET remaining=800 WHERE id=?", (second,))
        self.request(endpoint, "DELETE")
        self.assertEqual(stocks()[second], 1000)
        with self.assertRaises(urllib.error.HTTPError) as missing:
            self.request(endpoint)
        self.assertEqual(missing.exception.code, 404)
        for row in spools:
            self.request(f"/api/filaments/{row['id']}", "DELETE")

    def test_archive_releases_location_preserves_history_and_auto_restores_stock(self):
        sample = {
            "name": "Archive",
            "manufacturer": "Test",
            "material": "PLA",
            "weight": 1000,
            "remaining": 1000,
            "price": 0,
            "diameter": 1.75,
            "nozzle_temp": 0,
            "bed_temp": 0,
            "color_hex": "#ffffff",
            "purchase_format": "spool",
        }
        self.request("/api/filaments", "POST", sample)
        spool = json.load(self.request("/api/filaments"))[0]
        identity = spool["id"]
        endpoint = f"/api/filaments/{identity}/archive"
        with self.assertRaises(urllib.error.HTTPError):
            self.request(endpoint, "POST", {"archived": True})
        self.assertEqual(json.load(self.request("/api/filaments"))[0]["archived"], 0)
        place = next(
            row
            for row in json.load(self.request("/api/locations"))
            if row["kind"] == "ams_2_pro"
        )
        self.request(
            f"/api/filaments/{identity}",
            "PUT",
            dict(sample, location_id=place["id"], location_slot=1),
        )
        self.request(f"/api/filaments/{identity}/consumption", "POST", {"grams": 1000})
        history = json.load(self.request(f"/api/filaments/{identity}/consumption"))
        self.request(endpoint, "POST", {"archived": True})
        archived = next(
            row
            for row in json.load(self.request("/api/filaments"))
            if row["id"] == identity
        )
        self.assertEqual(archived["archived"], 1)
        self.assertIsNone(archived["location_id"])
        self.assertIsNone(archived["location_slot"])
        self.assertEqual(archived["active_slot"], "")
        self.assertEqual(archived["location"], "")
        self.assertEqual(archived["label_token"], spool["label_token"])
        self.assertEqual(
            json.load(self.request(f"/api/filaments/{identity}/consumption")), history
        )
        database.initialize()
        self.assertEqual(
            next(
                row
                for row in json.load(self.request("/api/filaments"))
                if row["id"] == identity
            )["archived"],
            1,
        )
        for invalid in (
            {"archived": 1},
            {"archived": "false"},
            {},
            {"archived": True, "extra": 1},
        ):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(endpoint, "POST", invalid)
            self.assertEqual(error.exception.code, 400)
        with self.assertRaises(urllib.error.HTTPError):
            self.request(
                f"/api/filaments/{identity}",
                "PUT",
                dict(sample, remaining=0, location_id=place["id"], location_slot=1),
            )
        self.request(endpoint, "POST", {"archived": False})
        restored = next(
            row
            for row in json.load(self.request("/api/filaments"))
            if row["id"] == identity
        )
        self.assertEqual(restored["archived"], 0)
        self.assertIsNone(restored["location_id"])
        self.request(endpoint, "POST", {"archived": True})
        self.request(f"/api/consumption/{history[0]['id']}", "DELETE")
        restored = next(
            row
            for row in json.load(self.request("/api/filaments"))
            if row["id"] == identity
        )
        self.assertEqual(restored["archived"], 0)
        self.assertEqual(restored["remaining"], 1000)
        self.assertIsNone(restored["location_id"])
        self.assertEqual(restored["label_token"], spool["label_token"])
        self.assertIn(b"archived", self.request("/api/export").read())
        self.request(f"/api/filaments/{identity}", "DELETE")

    def test_upcoming_project_import_save_and_conversion_do_not_double_charge_stock(
        self,
    ):
        from tests.test_three_mf import package

        stock_before = json.load(self.request("/api/filaments"))
        upload = urllib.request.Request(
            self.url + "/api/projects/import",
            method="POST",
            data=package(),
            headers={
                "Content-Type": "application/octet-stream",
                "X-Filename": "Test.3mf",
            },
        )
        draft = json.load(urllib.request.urlopen(upload))
        self.assertEqual(len(draft["plates"]), 2)
        self.assertEqual(json.load(self.request("/api/filaments")), stock_before)
        self.assertEqual(json.load(self.request("/api/projects")), [])
        plate = dict(draft["plates"][0])
        plate.pop("thumbnail")
        metadata = {
            key: value
            for key, value in draft.items()
            if key not in {"name", "plates", "warnings", "archive_file_id"}
        }
        payload = {
            "name": draft["name"],
            "archive_file_id": draft["archive_file_id"],
            "note": "Planning only",
            "project_url": "https://example.com/model",
            "image": "",
            "metadata": dict(metadata, plate=plate),
        }
        self.request("/api/projects", "POST", payload)
        listing = json.load(self.request("/api/projects"))
        identity = listing[0]["id"]
        endpoint = f"/api/projects/{identity}"
        saved = json.load(self.request(endpoint))
        self.assertEqual(saved["metadata"]["plate"]["estimated_grams"], 103.04)
        self.assertEqual(json.load(self.request("/api/filaments")), stock_before)
        database.initialize()
        database.initialize()
        self.assertEqual(json.load(self.request(endpoint)), saved)
        self.request(endpoint, "PUT", dict(payload, name="Edited project"))
        with self.assertRaises(urllib.error.HTTPError):
            self.request(
                endpoint, "PUT", dict(payload, project_url="javascript:alert(1)")
            )
        self.assertEqual(json.load(self.request(endpoint))["name"], "Edited project")
        self.request(
            "/api/filaments",
            "POST",
            {
                "name": "Project spool",
                "manufacturer": "Test",
                "material": "PLA",
                "weight": 1000,
                "remaining": 1000,
                "price": 0,
                "diameter": 1.75,
                "nozzle_temp": 0,
                "bed_temp": 0,
                "color_hex": "#ffffff",
            },
        )
        spool = json.load(self.request("/api/filaments"))[0]
        printing = {
            "name": "Imported print",
            "print_date": "2026-11-12",
            "status": "in_progress",
            "duration_minutes": 175,
            "planned_project_id": identity,
            "items": [{"filament_id": spool["id"], "grams": 1001}],
        }
        with self.assertRaises(urllib.error.HTTPError):
            self.request("/api/prints", "POST", printing)
        self.assertIsNone(json.load(self.request(endpoint))["print_id"])
        printing["items"][0]["grams"] = 103.04
        self.request("/api/prints", "POST", printing)
        print_id = json.load(self.request(endpoint))["print_id"]
        self.assertIsNotNone(print_id)
        stock = json.load(self.request("/api/filaments"))
        self.assertAlmostEqual(stock[0]["remaining"], 896.96)
        with self.assertRaises(urllib.error.HTTPError):
            self.request("/api/prints", "POST", printing)
        self.assertEqual(json.load(self.request("/api/filaments")), stock)
        for method in ("PUT",):
            with self.assertRaises(urllib.error.HTTPError):
                self.request(endpoint, method, payload if method == "PUT" else None)
        self.request(f"/api/prints/{print_id}", "DELETE")
        self.assertIsNone(json.load(self.request(endpoint))["print_id"])
        printing["status"] = "pending"
        self.request("/api/prints", "POST", printing)
        preserved_id = json.load(self.request(endpoint))["print_id"]
        before_cleanup = json.load(self.request("/api/filaments"))
        self.request(endpoint, "DELETE")
        self.assertEqual(
            json.load(self.request("/api/prints/" + str(preserved_id)))["status"],
            "pending",
        )
        self.assertEqual(json.load(self.request("/api/filaments")), before_cleanup)
        self.request(f"/api/prints/{preserved_id}", "DELETE")
        self.assertEqual(json.load(self.request("/api/projects")), [])
        self.request(f"/api/filaments/{spool['id']}", "DELETE")
        self.assertEqual(json.load(self.request("/api/filaments")), stock_before)
        bad_upload = urllib.request.Request(
            self.url + "/api/projects/import",
            method="POST",
            data=b"bad",
            headers={"Content-Type": "application/octet-stream"},
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(bad_upload)
        self.assertEqual(error.exception.code, 400)

    def test_build_plate_crud_default_and_upcoming_project_selection(self):
        plates = json.load(self.request("/api/build-plates"))
        self.assertEqual(sum(plate["name"] == "Textured PEI" for plate in plates), 1)
        database.initialize()
        database.initialize()
        self.assertEqual(json.load(self.request("/api/build-plates")), plates)
        for invalid in (
            {"name": ""},
            {"name": "textured pei"},
            {"name": "x" * 101},
            {"name": 1},
        ):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request("/api/build-plates", "POST", invalid)
            self.assertEqual(error.exception.code, 400)
        self.request("/api/build-plates", "POST", {"name": " Smooth   PEI "})
        plate = next(
            plate
            for plate in json.load(self.request("/api/build-plates"))
            if plate["name"] == "Smooth PEI"
        )
        plate_id = plate["id"]
        payload = {
            "name": "Build plate project",
            "note": "",
            "project_url": "",
            "image": "",
            "metadata": {
                "plate": {
                    "id": "1",
                    "name": "Plade 1",
                    "objects": [],
                    "filaments": [],
                    "estimated_seconds": None,
                    "estimated_grams": None,
                }
            },
            "build_plate_id": plate_id,
        }
        payload["filament_types"] = [" PLA   Basic ", "PETG HF", "pla basic"]
        stock = json.load(self.request("/api/filaments"))
        self.request("/api/projects", "POST", payload)
        project = json.load(self.request("/api/projects"))[0]
        endpoint = f"/api/projects/{project['id']}"
        self.assertEqual(project["filament_types"], ["PLA Basic", "PETG HF"])
        self.assertEqual(
            json.load(self.request(endpoint))["filament_types"],
            ["PLA Basic", "PETG HF"],
        )
        for invalid_types in ("PLA", [""], [1], ["x" * 101], ["PLA"] * 21):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(
                    endpoint, "PUT", dict(payload, filament_types=invalid_types)
                )
            self.assertEqual(error.exception.code, 400)
            self.assertEqual(
                json.load(self.request(endpoint))["filament_types"],
                ["PLA Basic", "PETG HF"],
            )
        self.assertEqual(project["build_plate_name"], "Smooth PEI")
        self.assertEqual(json.load(self.request(endpoint))["build_plate_id"], plate_id)
        for invalid in (999999, True, "1"):
            with self.assertRaises(urllib.error.HTTPError):
                self.request(endpoint, "PUT", dict(payload, build_plate_id=invalid))
        with self.assertRaises(urllib.error.HTTPError):
            self.request(f"/api/build-plates/{plate_id}", "DELETE")
        self.request(
            f"/api/build-plates/{plate_id}", "PUT", {"name": "Smooth PEI updated"}
        )
        self.assertEqual(
            json.load(self.request(endpoint))["build_plate_name"], "Smooth PEI updated"
        )
        database.initialize()
        self.assertEqual(json.load(self.request(endpoint))["build_plate_id"], plate_id)
        self.request(endpoint, "PUT", dict(payload, build_plate_id=None))
        self.request(f"/api/build-plates/{plate_id}", "DELETE")
        self.assertEqual(json.load(self.request("/api/filaments")), stock)
        self.request(endpoint, "DELETE")

    def test_material_type_administration_and_localized_validation(self):
        name = "Custom material admin API"
        renamed = "Renamed material admin API"
        self.request("/api/material-types", "POST", {"name": name})
        self.assertIn(name, json.load(self.request("/api/material-types")))
        details = json.load(self.request("/api/material-types?details=1"))
        item = next(item for item in details if item["name"] == name)
        self.assertEqual(
            item, {"name": name, "spool_count": 0, "project_count": 0, "in_use": False}
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(
                "/api/material-types",
                "POST",
                {"name": name.lower()},
                {"Accept-Language": "en"},
            )
        self.assertEqual(
            json.load(error.exception)["error_key"], "api.material_duplicate"
        )
        self.request("/api/material-types", "PUT", {"name": name, "new_name": renamed})
        names = json.load(self.request("/api/material-types"))
        self.assertNotIn(name, names)
        self.assertIn(renamed, names)
        self.request("/api/material-types", "DELETE", {"name": renamed})
        self.assertNotIn(renamed, json.load(self.request("/api/material-types")))

    def test_database_status_runs_known_select_and_reports_query_time(self):
        with self.request("/api/system-status") as response:
            data = json.load(response)
        self.assertTrue(data["database_online"])
        self.assertEqual(data["database"], "sqlite")
        self.assertNotIn("stats", data)
        self.assertGreaterEqual(data["response_ms"], 0)

        class ReadProbe:
            closed = False

            def execute(self, query):
                self.query = query
                return self

            def fetchone(self):
                return None

            def close(self):
                self.closed = True

        probe = ReadProbe()
        with (
            patch("src.http_reads.connect", return_value=probe) as connect_probe,
            patch("src.http_reads.perf_counter", side_effect=[10, 10.0005]),
        ):
            empty = json.load(self.request("/api/system-status"))
        self.assertTrue(empty["database_online"], "An empty inventory is readable")
        self.assertEqual(empty["response_ms"], 0.5)
        self.assertEqual(probe.query, "SELECT id FROM filaments LIMIT 1")
        self.assertTrue(probe.closed)
        connect_probe.assert_called_once_with(readonly=True)

    def test_sqlite_status_does_not_create_a_missing_database(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing" / "inventory.sqlite3"
            with (
                patch.object(database, "DB", missing),
                patch.dict(os.environ, DATABASE_BACKEND="sqlite"),
            ):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    self.request("/api/system-status")
                self.assertEqual(error.exception.code, 503)
                error.exception.close()
            self.assertFalse(missing.parent.exists())

    def test_database_status_is_offline_without_exposing_connection_details(self):
        with patch(
            "src.http_reads.connect", side_effect=OSError("secret connection details")
        ):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request("/api/system-status")
            self.assertEqual(error.exception.code, 503)
            data = error.exception.read().decode()
        self.assertNotIn("secret", data)
        self.assertEqual(
            json.loads(data),
            {"database": "sqlite", "database_online": False, "response_ms": None},
        )
        self.assertEqual(
            json.load(self.request("/api/version"))["version"], config.VERSION
        )

    def test_version_matches_running_application(self):
        for backend in ("sqlite", "mysql"):
            with (
                self.subTest(backend=backend),
                patch.dict(os.environ, DATABASE_BACKEND=backend),
            ):
                self.assertEqual(
                    json.load(self.request("/api/version")),
                    {"version": config.VERSION, "database": backend},
                )

    def test_install_manifest_and_icons_are_served_without_offline_cache(self):
        response = self.request("/manifest.webmanifest")
        self.assertIn("application/manifest+json", response.headers["Content-Type"])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        manifest = json.load(response)
        self.assertEqual(manifest["name"], "Filament DB")
        self.assertEqual(manifest["display"], "standalone")
        self.assertEqual(manifest["scope"], "/")
        self.assertEqual(manifest["start_url"], "/")
        self.assertEqual(
            {icon["sizes"] for icon in manifest["icons"]}, {"192x192", "512x512"}
        )
        for icon in manifest["icons"]:
            response = self.request(icon["src"])
            self.assertEqual(response.headers["Content-Type"], "image/png")
            data = response.read()
            self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
            width = int.from_bytes(data[16:20], "big")
            height = int.from_bytes(data[20:24], "big")
            self.assertEqual(f"{width}x{height}", icon["sizes"])
        self.assertIn(b"#reload-app", self.request("/install.js").read())
        self.assertIn(b'rel="manifest"', self.request("/").read())

    def test_language_catalog_assets_and_error_metadata(self):
        with self.request("/locales/index.json") as response:
            self.assertIn("application/json", response.headers["Content-Type"])
            registry = json.load(response)
        self.assertEqual(registry["default"], "da")
        self.assertEqual(registry["languages"][0]["code"], "da")
        catalog = json.load(self.request("/locales/da.json"))
        self.assertEqual(catalog["language"], "da")
        self.assertIn("Lager", catalog["messages"].values())
        for path in ("/locales/unknown.json", "/locales/../config.json"):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(path)
            self.assertEqual(error.exception.code, 404)
            body = json.load(error.exception)
            self.assertEqual(body["error"], "Ikke fundet")
            self.assertTrue(body["error_key"].startswith("api."))
            error.exception.close()

    def test_registered_language_translates_http_errors_and_install_description(self):
        from src import i18n

        danish = json.loads((i18n.LANGUAGE_ROOT / "da.json").read_text())
        key = next(
            key
            for key, value in danish["messages"].items()
            if key.startswith("api.") and value == "Ikke fundet"
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "da.json").write_text(json.dumps(danish))
            (root / "en.json").write_text(
                json.dumps(
                    {
                        "language": "en",
                        "locale": "en-GB",
                        "messages": {
                            key: "Not found",
                            "app.description": "Personal filament inventory",
                        },
                    }
                )
            )
            (root / "index.json").write_text(
                json.dumps(
                    {
                        "default": "da",
                        "languages": [
                            {"code": "da", "name": "Dansk", "locale": "da-DK"},
                            {"code": "en", "name": "English", "locale": "en-GB"},
                        ],
                    }
                )
            )
            with patch.object(i18n, "LANGUAGE_ROOT", root):
                self.assertEqual(
                    json.load(self.request("/locales/en.json"))["language"], "en"
                )
                with self.assertRaises(urllib.error.HTTPError) as error:
                    self.request(
                        "/api/unknown-route", headers={"Accept-Language": "en-GB"}
                    )
                response = json.load(error.exception)
                error.exception.close()
                self.assertEqual(response["error"], "Not found")
                self.assertEqual(response["error_key"], key)
                manifest = json.load(self.request("/manifest.webmanifest?lang=en"))
                self.assertEqual(manifest["description"], "Personal filament inventory")
                self.assertEqual(manifest["lang"], "en")
                self.assertEqual(manifest["start_url"], "/?lang=en")
                self.assertEqual(manifest["name"], "Filament DB")

    def test_frontend_modules_are_served(self):
        import posixpath
        import re

        html = self.request("/").read().decode()
        scripts = re.findall(r'<script type="module" src="([^"]+)"></script>', html)
        self.assertEqual(scripts, ["/bootstrap.js"])
        pending = list(scripts)
        visited = set()
        while pending:
            script = pending.pop()
            if script in visited:
                continue
            visited.add(script)
            with self.subTest(script=script):
                response = self.request(script)
                self.assertEqual(response.status, 200)
                self.assertIn("text/javascript", response.headers["Content-Type"])
                source = response.read().decode()
                self.assertTrue(source)
                imports = re.findall(r"""from\s+['"]([^'"]+)['"]""", source)
                for specifier in imports:
                    self.assertTrue(specifier.startswith("./"))
                    pending.append(
                        posixpath.normpath(
                            posixpath.join(posixpath.dirname(script), specifier)
                        )
                    )
        self.assertIn("/administration.js", visited)
        self.assertIn("/usage-model.js", visited)
        self.assertIn("/labels.js", visited)
        self.assertIn("/thermal-labels.js", visited)
        self.assertIn("/m220-bluetooth.js", visited)
        self.assertIn("/m220-printing.js", visited)
        self.assertIn("/vendor/bambu-lab-logo.js", visited)
        self.assertIn("/actions.js", visited)
        self.assertIn("/vendor/qrcodegen.js", visited)

    def test_bambu_material_profile_lookup(self):
        from urllib.parse import urlencode

        query = urlencode({"manufacturer": "BambuLab", "material": "PAHT CF"})
        with self.request("/api/material-profiles?" + query) as response:
            profile = json.load(response)
        self.assertEqual(profile["material"], "PAHT-CF")
        self.assertEqual(profile["nozzle_temperature_c"], [260, 300])
        self.assertEqual(profile["drying_conditions"][0]["hours"], [8, 12])
        self.assertIsNone(profile["flow_ratio"])
        query = urlencode({"manufacturer": "Other", "material": "PAHT CF"})
        with self.request("/api/material-profiles?" + query) as response:
            self.assertIsNone(json.load(response))

    def test_static_and_path_isolation(self):
        self.assertRegex(self.request("/").read(), rb"<h1[^>]*>Lager")
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("/app.py")
        error.exception.close()


class MigrationTest(unittest.TestCase):
    def test_print_status_constraint_upgrade_preserves_data_and_sequence(self):
        original = database.DB
        try:
            with tempfile.TemporaryDirectory() as directory:
                database.DB = Path(directory) / "old-status.sqlite3"
                with database.connect() as conn:
                    conn.execute("""CREATE TABLE prints (id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL, print_date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
                        image TEXT NOT NULL DEFAULT '', project_url TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','failed')),
                        duration_minutes INTEGER)""")
                    conn.execute(
                        "INSERT INTO prints (id,name,print_date,note,image,project_url,status,duration_minutes) VALUES (1,'Bevar','2026-11-12','Note','Billede','https://example.com','failed',60)"
                    )
                    conn.execute(
                        "INSERT INTO prints (id,name,print_date) VALUES (100,'Slettet','2026-11-12')"
                    )
                    conn.execute("DELETE FROM prints WHERE id=100")
                    before = dict(
                        conn.execute("SELECT * FROM prints WHERE id=1").fetchone()
                    )
                database.initialize()
                database.initialize()
                with database.connect() as conn:
                    self.assertEqual(
                        dict(
                            conn.execute("SELECT * FROM prints WHERE id=1").fetchone()
                        ),
                        {**before, "archive_file_id": None},
                    )
                    identity = conn.execute(
                        "INSERT INTO prints (name,print_date,status) VALUES ('Ny','2026-11-12','in_progress')"
                    ).lastrowid
                    self.assertGreater(identity, 100)
                database.initialize()
                with database.connect() as conn:
                    self.assertEqual(
                        conn.execute(
                            "SELECT status FROM prints WHERE id=?", (identity,)
                        ).fetchone()[0],
                        "in_progress",
                    )
        finally:
            database.DB = original

    def test_existing_database_is_preserved_and_migration_is_repeatable(self):
        original = database.DB
        try:
            with tempfile.TemporaryDirectory() as directory:
                database.DB = Path(directory) / "legacy.sqlite3"
                with database.connect() as connection:
                    connection.execute(
                        "CREATE TABLE filaments (id INTEGER PRIMARY KEY, name TEXT)"
                    )
                    connection.execute(
                        "INSERT INTO filaments (name) VALUES ('Existing PLA')"
                    )
                database.initialize()
                database.initialize()
                with database.connect() as connection:
                    row = dict(connection.execute("SELECT * FROM filaments").fetchone())
                token = row.pop("label_token")
                self.assertEqual(len(token), 32)
                database.initialize()
                with database.connect() as connection:
                    self.assertEqual(
                        connection.execute(
                            "SELECT label_token FROM filaments WHERE id=1"
                        ).fetchone()[0],
                        token,
                    )
                self.assertEqual(
                    row,
                    {
                        "active_slot": "",
                        "archived": 0,
                        "location_id": None,
                        "location_slot": None,
                        "id": 1,
                        "name": "Existing PLA",
                        "purchase_format": "unknown",
                        "product_id": "",
                        "product_url": "",
                        "transparency": "opaque",
                    },
                )
        finally:
            database.DB = original
