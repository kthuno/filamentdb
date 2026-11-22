"""Slot assignment preserves roll identity and consumption in one transaction."""

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src import database
from src.locations import assign_location_content, sync_ams_slots


class LocationContentsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        patcher = patch.object(
            database, "DB", Path(self.directory.name) / "test.sqlite3"
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        database.initialize()
        with database.connect() as conn:
            self.ams = conn.execute(
                "INSERT INTO locations (name,kind) VALUES ('Test AMS','ams_2_pro')"
            ).lastrowid
            self.box = conn.execute(
                "INSERT INTO locations (name,kind) VALUES ('Test box','box')"
            ).lastrowid
            self.first = conn.execute(
                "INSERT INTO filaments (name,manufacturer,material,weight,remaining,label_token) VALUES ('First','Test','PLA',1000,800,'first-token')"
            ).lastrowid
            self.second = conn.execute(
                "INSERT INTO filaments (name,manufacturer,material,weight,remaining,label_token) VALUES ('Second','Test','PETG',1000,600,'second-token')"
            ).lastrowid
            conn.execute(
                "INSERT INTO consumption (filament_id,grams,note) VALUES (?,200,'Preserve')",
                (self.first,),
            )

    def assign(self, place, slot, spool, expected=None):
        with database.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            assign_location_content(
                conn,
                place,
                {"slot": slot, "filament_id": spool, "expected_filament_id": expected},
            )
            sync_ams_slots(conn)

    def spool(self, identity):
        with database.connect() as conn:
            return dict(
                conn.execute(
                    "SELECT * FROM filaments WHERE id=?", (identity,)
                ).fetchone()
            )

    def test_replace_move_and_clear_leave_weights_tokens_and_history_unchanged(self):
        self.assign(self.ams, 1, self.first)
        self.assertEqual(self.spool(self.first)["active_slot"], "Test AMS · slot 1")
        self.assign(self.box, 1, self.second)
        self.assign(self.ams, 1, self.second, self.first)
        first, second = self.spool(self.first), self.spool(self.second)
        self.assertIsNone(first["location_id"])
        self.assertEqual(first["location"], "")
        self.assertEqual(first["active_slot"], "")
        self.assertEqual(second["location_id"], self.ams)
        self.assertEqual(second["active_slot"], "Test AMS · slot 1")
        self.assertEqual(first["remaining"], 800)
        self.assertEqual(second["remaining"], 600)
        self.assertEqual(first["label_token"], "first-token")
        self.assertEqual(second["label_token"], "second-token")
        with database.connect() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT COUNT(*) FROM consumption WHERE filament_id=?",
                    (self.first,),
                ).fetchone()[0],
                1,
            )
        self.assign(self.ams, 1, None, self.second)
        self.assertIsNone(self.spool(self.second)["location_id"])
        self.assertEqual(self.spool(self.second)["active_slot"], "")

    def test_stale_choice_and_invalid_selection_preserve_both_occupants(self):
        self.assign(self.ams, 2, self.first)
        self.assign(self.box, 1, self.second)
        before = [self.spool(self.first), self.spool(self.second)]
        for place, slot, spool, expected in (
            (self.ams, 2, self.second, None),
            (self.box, 2, self.first, self.second),
            (self.ams, 2, 999999, self.first),
            (self.ams, 2, True, self.first),
            (self.ams, True, self.second, self.first),
            (999999, 1, self.second, None),
        ):
            with self.subTest(place=place, slot=slot, spool=spool):
                with self.assertRaises(ValueError):
                    self.assign(place, slot, spool, expected)
                self.assertEqual(
                    [self.spool(self.first), self.spool(self.second)], before
                )

    def test_archived_roll_is_rejected_and_empty_roll_does_not_become_active(self):
        with database.connect() as conn:
            conn.execute(
                "UPDATE filaments SET remaining=0,archived=1 WHERE id=?", (self.second,)
            )
        with self.assertRaises(ValueError):
            self.assign(self.ams, 1, self.second)
        with database.connect() as conn:
            conn.execute("UPDATE filaments SET archived=0 WHERE id=?", (self.second,))
        self.assign(self.ams, 4, self.second)
        self.assertEqual(self.spool(self.second)["location_slot"], 4)
        self.assertEqual(self.spool(self.second)["active_slot"], "")

    def test_active_label_conflict_rolls_back_displacement_and_movement(self):
        with database.connect() as conn:
            conn.execute("UPDATE filaments SET remaining=0 WHERE id=?", (self.first,))
        self.assign(self.ams, 1, self.first)
        with database.connect() as conn:
            conn.execute(
                "INSERT INTO filaments (name,manufacturer,material,weight,remaining,label_token,active_slot) VALUES ('Third','Test','PLA',1000,1000,'third-token','Test AMS · slot 1')"
            )
        before = [self.spool(self.first), self.spool(self.second)]
        with self.assertRaises(sqlite3.IntegrityError):
            self.assign(self.ams, 1, self.second, self.first)
        self.assertEqual([self.spool(self.first), self.spool(self.second)], before)
