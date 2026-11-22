"""Planning uses temporary inventory and never changes stock."""

import copy
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from src import database
from src.filaments import save_filament
from src.http_server import Handler
from src.planning import PRODUCT_FIELDS, planning_overview
from src.projects import save_project


class PlanningTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.patch = patch.object(
            database, "DB", Path(self.directory.name) / "stock.sqlite3"
        )
        self.patch.start()
        self.addCleanup(self.patch.stop)
        database.initialize()
        self.conn = database.connect()
        self.addCleanup(self.conn.close)
        sample = {
            "name": "Planning PLA",
            "manufacturer": "Test",
            "material": "PLA",
            "color": "Sort",
            "color_hex": "#000000",
            "weight": 1000,
            "remaining": 100,
            "price": 0,
            "diameter": 1.75,
            "nozzle_temp": 0,
            "bed_temp": 0,
            "product_url": "https://example.com/pla",
        }
        save_filament(self.conn, sample)
        save_filament(self.conn, dict(sample, remaining=200))
        spool = self.conn.execute("SELECT * FROM filaments ORDER BY id").fetchone()
        self.product = {field: spool[field] for field in PRODUCT_FIELDS}
        self.payload = {
            "name": "Plan",
            "note": "",
            "project_url": "",
            "image": "",
            "metadata": {
                "plate": {
                    "id": "1",
                    "name": "Plade 1",
                    "objects": [],
                    "filaments": [{"id": "1", "grams": 250}],
                    "estimated_seconds": None,
                    "estimated_grams": 250,
                    "material_choices": [self.product],
                }
            },
        }

    def test_combines_demand_without_double_counting_stock_and_keeps_stock_unchanged(
        self,
    ):
        before = [dict(row) for row in self.conn.execute("SELECT * FROM filaments")]
        first = save_project(self.conn, self.payload)
        save_project(self.conn, dict(self.payload, name="Plan 2"))
        result = planning_overview(self.conn)
        need = result["needs"][0]
        self.assertEqual(
            (need["required"], need["available"], need["missing"]), (500, 300, 200)
        )
        self.assertTrue(need["split_required"])
        self.conn.execute("UPDATE projects SET print_id=99 WHERE id=?", (first,))
        self.assertEqual(planning_overview(self.conn)["needs"][0]["required"], 250)
        self.assertEqual(
            [dict(row) for row in self.conn.execute("SELECT * FROM filaments")], before
        )

    def test_unknown_unassigned_and_zero_estimates_are_distinct(self):
        payload = copy.deepcopy(self.payload)
        plate = payload["metadata"]["plate"]
        plate.update(
            estimated_grams=500,
            filaments=[
                {"id": "1", "grams": None},
                {"id": "2", "grams": 0},
                {"id": "3", "grams": 50},
            ],
            material_choices=[self.product, self.product, None],
        )
        save_project(self.conn, payload)
        result = planning_overview(self.conn)
        self.assertEqual(result["needs"][0]["required"], 0)
        self.assertEqual(result["needs"][0]["unknown"], 1)
        self.assertEqual(result["unresolved"][0]["grams"], 50)
        self.assertEqual(result["estimate_warnings"], [])
        plate["filaments"][0]["grams"] = 100
        save_project(self.conn, payload)
        self.assertEqual(len(planning_overview(self.conn)["estimate_warnings"]), 1)

    def test_archived_and_deleted_spools_do_not_erase_product_demand(self):
        save_project(self.conn, self.payload)
        self.conn.execute("UPDATE filaments SET archived=1,remaining=0")
        self.assertEqual(planning_overview(self.conn)["needs"][0]["missing"], 250)
        self.conn.execute("DELETE FROM filaments")
        need = planning_overview(self.conn)["needs"][0]
        self.assertEqual(need["product"], self.product)
        self.assertEqual(need["missing"], 250)

    def test_product_identity_separates_colors_and_sizes(self):
        changed = copy.deepcopy(self.payload)
        changed["metadata"]["plate"]["material_choices"][0]["color"] = "Hvid"
        save_project(self.conn, changed)
        self.assertEqual(planning_overview(self.conn)["needs"][0]["available"], 0)
        changed["metadata"]["plate"]["material_choices"][0] = dict(
            self.product, weight=750
        )
        save_project(self.conn, changed)
        self.assertEqual(len(planning_overview(self.conn)["needs"]), 2)

    def test_quantity_scales_demand_without_changing_unit_estimates(self):
        payload = copy.deepcopy(self.payload)
        plate = payload["metadata"]["plate"]
        plate["quantity"] = 3
        identity = save_project(self.conn, payload)
        need = planning_overview(self.conn)["needs"][0]
        self.assertEqual((need["required"], need["missing"]), (750, 450))
        self.assertEqual(need["projects"][0]["per_print_grams"], 250)
        stored = json.loads(
            self.conn.execute(
                "SELECT metadata FROM projects WHERE id=?", (identity,)
            ).fetchone()["metadata"]
        )
        self.assertEqual(stored["plate"]["estimated_grams"], 250)
        plate["estimated_grams"] = 150
        save_project(self.conn, payload, identity)
        need = planning_overview(self.conn)["needs"][0]
        self.assertEqual(need["required"], 450)
        self.assertFalse(need["split_required"])
        plate["estimated_grams"] = None
        plate["filaments"][0]["grams"] = None
        save_project(self.conn, payload, identity)
        need = planning_overview(self.conn)["needs"][0]
        self.assertEqual((need["required"], need["unknown"]), (0, 1))

    def test_quantity_validation(self):
        for quantity in (0, -1, 1.5, True, "2", None, 1001):
            with self.subTest(quantity=quantity):
                payload = copy.deepcopy(self.payload)
                payload["metadata"]["plate"]["quantity"] = quantity
                with self.assertRaises(ValueError):
                    save_project(self.conn, payload)

    def test_invalid_product_snapshots_are_rejected(self):
        for choices in (
            {},
            [self.product, self.product],
            [{"name": "X"}],
            [dict(self.product, weight=True)],
            [dict(self.product, product_url="javascript:alert(1)")],
        ):
            with self.subTest(choices=choices):
                payload = copy.deepcopy(self.payload)
                payload["metadata"]["plate"]["material_choices"] = choices
                with self.assertRaises(ValueError):
                    save_project(self.conn, payload)

    def test_migration_is_repeatable_and_manual_wishes_survive_restart(self):
        self.conn.execute(
            "INSERT INTO shopping_wishes (name,grams,product_url,note) VALUES (?,?,?,?)",
            ("PLA", 1000, "", ""),
        )
        self.conn.commit()
        database.initialize()
        database.initialize()
        self.assertEqual(planning_overview(self.conn)["wishes"][0]["name"], "PLA")
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) AS count FROM filaments").fetchone()[
                "count"
            ],
            2,
        )

    def test_api_wish_crud_validation_and_planning(self):
        self.conn.commit()
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_port}"

        def request(path, method="GET", payload=None):
            req = urllib.request.Request(
                base + path,
                method=method,
                data=json.dumps(payload).encode() if payload is not None else None,
            )
            with urllib.request.urlopen(req) as response:
                return json.load(response)

        request("/api/projects", "POST", self.payload)
        project = request("/api/projects")[0]
        self.assertEqual(
            project["metadata"]["plate"]["material_choices"], [self.product]
        )
        self.assertEqual(request("/api/planning")["needs"][0]["required"], 250)
        request(f"/api/projects/{project['id']}", "DELETE")
        self.assertEqual(request("/api/planning")["needs"], [])

        wish = {
            "name": "Nyt filament",
            "grams": None,
            "product_url": "https://example.com",
            "note": "Til næste model",
        }
        request("/api/shopping-wishes", "POST", wish)
        overview = request("/api/planning")
        self.assertEqual(len(overview["products"]), 1)
        identity = overview["wishes"][0]["id"]
        path = f"/api/shopping-wishes/{identity}"
        request(path, "PUT", dict(wish, grams=1000))
        self.assertEqual(request("/api/planning")["wishes"][0]["grams"], 1000)
        for invalid in (
            dict(wish, grams=-1),
            dict(wish, grams=True),
            dict(wish, name=""),
            dict(wish, product_url="javascript:evil"),
        ):
            with self.assertRaises(urllib.error.HTTPError) as error:
                request(path, "PUT", invalid)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        request(path, "DELETE")
        self.assertEqual(request("/api/planning")["wishes"], [])
        with self.assertRaises(urllib.error.HTTPError) as error:
            request(path, "DELETE")
        self.assertEqual(error.exception.code, 404)
        error.exception.close()
