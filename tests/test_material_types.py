"""Material catalogs preserve inventory and survive repeated startup migrations."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src import database, materials


class MaterialTypesTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        self.conn.execute("CREATE TABLE migrations (name TEXT PRIMARY KEY)")
        self.conn.execute("CREATE TABLE material_types (name TEXT NOT NULL)")
        self.conn.execute(
            "CREATE TABLE filaments (id INTEGER PRIMARY KEY, material TEXT, remaining REAL, archived INTEGER, label_token TEXT)"
        )
        self.conn.execute(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, filament_types TEXT)"
        )
        materials.seed_materials(self.conn)

    def test_create_rename_delete_and_casefolded_uniqueness(self):
        materials.mutate_material(self.conn, "POST", {"name": "  Nylon   Æther "})
        self.assertEqual(
            materials.find_material(self.conn, "nylon æther"), "Nylon Æther"
        )
        with self.assertRaisesRegex(ValueError, "allerede"):
            materials.mutate_material(self.conn, "POST", {"name": "NYLON ÆTHER"})
        materials.mutate_material(
            self.conn, "PUT", {"name": "Nylon Æther", "new_name": "Nylon custom"}
        )
        self.assertIsNone(materials.find_material(self.conn, "Nylon Æther"))
        materials.mutate_material(self.conn, "DELETE", {"name": "Nylon custom"})
        self.assertIsNone(materials.find_material(self.conn, "Nylon custom"))
        for payload in (
            {"name": ""},
            {"name": 1},
            {"name": "x" * 101},
            {"name": "X", "extra": True},
        ):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                materials.mutate_material(self.conn, "POST", payload)

    def test_used_materials_preserve_spools_and_project_values(self):
        self.conn.execute(
            "INSERT INTO filaments VALUES (1,' pla   basic ',250,1,'permanent')"
        )
        self.conn.execute(
            "INSERT INTO projects VALUES (1,?)", (json.dumps(["PETG Basic"]),)
        )
        before = tuple(self.conn.execute("SELECT * FROM filaments").fetchone())
        for name in ("PLA Basic", "PETG Basic"):
            for method, payload in (
                ("DELETE", {"name": name}),
                ("PUT", {"name": name, "new_name": "Replacement"}),
            ):
                with (
                    self.subTest(name=name, method=method),
                    self.assertRaisesRegex(ValueError, "bruges"),
                ):
                    materials.mutate_material(self.conn, method, payload)
        rows = {row["name"]: row for row in materials.list_materials(self.conn)}
        self.assertEqual(rows["PLA Basic"]["spool_count"], 1)
        self.assertTrue(rows["PLA Basic"]["in_use"])
        self.assertEqual(rows["PETG Basic"]["project_count"], 1)
        self.assertEqual(
            tuple(self.conn.execute("SELECT * FROM filaments").fetchone()), before
        )
        self.assertEqual(
            json.loads(
                self.conn.execute("SELECT filament_types FROM projects").fetchone()[0]
            ),
            ["PETG Basic"],
        )

    def test_deleted_defaults_do_not_return_and_existing_data_is_registered(self):
        materials.mutate_material(self.conn, "DELETE", {"name": "TPU"})
        materials.mutate_material(
            self.conn, "PUT", {"name": "PC", "new_name": "PC custom"}
        )
        self.conn.execute(
            "INSERT INTO filaments VALUES (1,'Existing blend',500,0,'token')"
        )
        self.conn.execute("INSERT INTO projects VALUES (1,'[\"Project blend\"]')")
        for _ in range(2):
            materials.seed_materials(self.conn)
        names = {item["name"] for item in materials.list_materials(self.conn)}
        self.assertNotIn("TPU", names)
        self.assertNotIn("PC", names)
        self.assertTrue({"PC custom", "Existing blend", "Project blend"} <= names)
        count = self.conn.execute("SELECT COUNT(*) FROM material_types").fetchone()[0]
        self.assertEqual(count, len(names))

    def test_real_migration_is_repeatable_and_preserves_catalog_edits(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(database, "DB", Path(directory) / "materials.sqlite3"),
            patch.dict("os.environ", {"DATABASE_BACKEND": "sqlite"}),
        ):
            database.initialize()
            with database.connect() as conn:
                materials.mutate_material(conn, "DELETE", {"name": "TPU"})
                conn.execute(
                    "INSERT INTO filaments (name,manufacturer,material,weight,remaining,label_token) VALUES ('Existing','Test','Blend',1000,600,'permanent-test')"
                )
            database.initialize()
            database.initialize()
            with database.connect() as conn:
                self.assertIsNone(materials.find_material(conn, "TPU"))
                self.assertEqual(materials.find_material(conn, "Blend"), "Blend")
                spool = conn.execute(
                    "SELECT remaining,label_token FROM filaments"
                ).fetchone()
                self.assertEqual(tuple(spool), (600, "permanent-test"))
