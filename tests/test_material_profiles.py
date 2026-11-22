"""Reference imports are repeatable and never overwrite spool data."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src import database, material_profiles
from tools.import_bambu_guide import extract_row


class MaterialProfilesTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        self.conn.execute("CREATE TABLE migrations (name TEXT PRIMARY KEY)")
        material_profiles.initialize(self.conn)
        material_profiles.seed(self.conn)

    def test_seeded_values_and_exact_variant_lookup(self):
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM material_profiles").fetchone()[0],
            42,
        )
        pla = material_profiles.lookup(self.conn, " BambuLab ", " PLA   Basic ")
        self.assertEqual(pla["nozzle_temperature_c"], [190, 230])
        self.assertEqual(pla["bed_temperatures"][0]["temperature_c"], [35, 55])
        self.assertEqual(pla["drying_conditions"][0]["temperature_c"], [50, 50])
        self.assertEqual(pla["drying_conditions"][0]["hours"], [8, 8])
        self.assertIsNone(pla["flow_ratio"])
        self.assertFalse(pla["drying_required"])
        paht = material_profiles.lookup(self.conn, "Bambu", "paht cf")
        self.assertEqual(paht["material"], "PAHT-CF")
        self.assertEqual(paht["nozzle_temperature_c"], [260, 300])
        self.assertEqual(paht["bed_temperatures"][0]["temperature_c"], [100, 120])
        self.assertEqual(paht["drying_conditions"][0]["hours"], [8, 12])
        self.assertEqual(paht["drying_conditions"][1]["temperature_c"], [90, 100])
        self.assertTrue(paht["drying_required"])
        self.assertNotEqual(
            material_profiles.lookup(self.conn, "Bambu Lab", "PLA Silk")["material"],
            material_profiles.lookup(self.conn, "Bambu Lab", "PLA Silk+")["material"],
        )
        for manufacturer, material in (
            ("Other", "PLA Basic"),
            ("Bambu Lab", "PLA"),
            ("Bambu Lab", "PETG HF"),
            ("Bambu Lab", "PLA Basic' OR 1=1 --"),
        ):
            self.assertIsNone(
                material_profiles.lookup(self.conn, manufacturer, material)
            )

    def test_repeat_seeding_preserves_edits_and_deleted_rows(self):
        self.conn.execute(
            "UPDATE material_profiles SET nozzle_min_c=200 WHERE material='PLA Basic'"
        )
        self.conn.execute("DELETE FROM material_profiles WHERE material='PLA Silk'")
        material_profiles.initialize(self.conn)
        material_profiles.seed(self.conn)
        self.assertEqual(
            material_profiles.lookup(self.conn, "Bambu Lab", "PLA Basic")[
                "nozzle_temperature_c"
            ],
            [200, 230],
        )
        self.assertIsNone(material_profiles.lookup(self.conn, "Bambu Lab", "PLA Silk"))

    def test_every_seed_profile_has_complete_ranges_and_source_provenance(self):
        data = json.loads(material_profiles.SEED_PATH.read_text())
        for item in data["profiles"]:
            profile = material_profiles.lookup(self.conn, "Bambu Lab", item["material"])
            self.assertEqual(profile["source_sha256"], data["source_sha256"])
            self.assertEqual(profile["source_page"], 1)
            self.assertEqual(profile["source_url"], data["source_url"])
            self.assertIsNone(profile["flow_ratio"])
            self.assertEqual(len(profile["drying_conditions"]), 2)
            ranges = [profile["nozzle_temperature_c"]]
            ranges += [p["temperature_c"] for p in profile["bed_temperatures"]]
            for condition in profile["drying_conditions"]:
                ranges += [condition["temperature_c"], condition["hours"]]
            for low, high in ranges:
                self.assertLessEqual(low, high)
                self.assertGreater(low, 0)
        pps = material_profiles.lookup(self.conn, "Bambu Lab", "PPS-CF")
        self.assertEqual(pps["drying_conditions"][0]["temperature_c"], [100, 140])
        self.assertIn("Less effective", pps["drying_conditions"][1]["notes"][-1])

    def test_application_migration_is_repeatable_and_preserves_spools(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(database, "DB", Path(directory) / "test.sqlite3"),
        ):
            database.initialize()
            with database.connect() as conn:
                conn.execute(
                    """INSERT INTO filaments
                    (id,name,manufacturer,material,weight,remaining,nozzle_temp,bed_temp,label_token)
                    VALUES (1,'Test','Bambu Lab','PLA Basic',1000,777,215,60,'stable')"""
                )
                before = dict(conn.execute("SELECT * FROM filaments").fetchone())
            database.initialize()
            with database.connect() as conn:
                self.assertEqual(
                    dict(conn.execute("SELECT * FROM filaments").fetchone()), before
                )
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM material_profiles").fetchone()[
                        0
                    ],
                    42,
                )

    def test_parser_keeps_methods_separate_and_rejects_unknown_cells(self):
        row = [""] * 23
        row[0], row[11], row[20] = "Example", "Required", "260 - 300 ℃"
        row[15] = "Textured PEI Plate (100 - 120 °C)"
        row[12] = (
            "Blast Drying Oven: 80 °C，8 - 12 h\nPrinter Heatbed (Covered, Flip midway): 90 - 100 ℃, 12 h"
        )
        result = extract_row(row)
        self.assertEqual(result["drying_conditions"][0]["temperature_c"], [80, 80])
        self.assertEqual(result["drying_conditions"][1]["temperature_c"], [90, 100])
        self.assertIsNone(result["flow_ratio"])
        row[20] = "Unknown"
        with self.assertRaises(ValueError):
            extract_row(row)
