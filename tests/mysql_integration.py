"""Run explicitly against a NEW disposable database named filamentdb_test*."""

import os
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_app import ApiTest

from src.database import initialize
from src.mysql_backend import Connection
from src.prints import register_print


class ConcurrentConsumptionTest(unittest.TestCase):
    def test_simultaneous_prints_cannot_overdraw_spool(self):
        initialize()
        with Connection() as conn:
            identity = conn.execute(
                """INSERT INTO filaments
                (name,manufacturer,material,weight,remaining,label_token)
                VALUES ('Concurrent','Test','PLA',1000,875,?)""",
                ("a" * 32,),
            ).lastrowid

        def consume():
            try:
                with Connection() as conn:
                    conn.execute("BEGIN IMMEDIATE")
                    register_print(
                        conn,
                        {
                            "name": "Concurrent",
                            "print_date": "2026-11-10",
                            "items": [{"filament_id": identity, "grams": 600}],
                        },
                    )
                return True
            except ValueError:
                return False

        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                self.assertEqual(
                    sorted(pool.map(lambda _: consume(), range(2))), [False, True]
                )
            with Connection() as conn:
                self.assertEqual(
                    conn.execute(
                        "SELECT remaining FROM filaments WHERE id=?", (identity,)
                    ).fetchone()["remaining"],
                    275,
                )
        finally:
            with Connection() as conn:
                conn.execute("BEGIN IMMEDIATE")
                entries = conn.execute(
                    "SELECT print_id FROM consumption WHERE filament_id=?", (identity,)
                ).fetchall()
                conn.execute("DELETE FROM consumption WHERE filament_id=?", (identity,))
                for entry in entries:
                    conn.execute("DELETE FROM prints WHERE id=?", (entry["print_id"],))
                conn.execute("DELETE FROM filaments WHERE id=?", (identity,))


if __name__ == "__main__":
    if not os.environ.get("MYSQL_DATABASE", "").startswith("filamentdb_test"):
        raise SystemExit("Requires disposable MYSQL_DATABASE=filamentdb_test...")
    os.environ["DATABASE_BACKEND"] = "mysql"
    with Connection() as conn:
        if conn.execute("SHOW TABLES").fetchall():
            raise SystemExit("Requires a NEW, empty test database")
    suite = unittest.TestSuite(
        unittest.defaultTestLoader.loadTestsFromTestCase(case)
        for case in (ApiTest, ConcurrentConsumptionTest)
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
