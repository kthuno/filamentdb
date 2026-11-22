"""Database connections and repeatable, data-preserving schema migrations."""

import os
import sqlite3
import uuid

from .archive_links import backfill_print_archive_links
from .config import DB
from .knowledge import initialize as initialize_knowledge
from .locations import sync_ams_slots
from .material_profiles import initialize as initialize_material_profiles
from .material_profiles import seed as seed_material_profiles
from .materials import seed_materials


def connect():
    """Select the configured backend without loading the optional driver for SQLite."""
    backend = os.environ.get("DATABASE_BACKEND", "sqlite")
    if backend == "mysql":
        from .mysql_backend import Connection

        return Connection()
    if backend != "sqlite":
        raise ValueError("DATABASE_BACKEND skal være sqlite eller mysql")
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


def initialize():
    """Upgrade existing databases in place; column checks make restarts repeatable."""
    if os.environ.get("DATABASE_BACKEND", "sqlite") == "mysql":
        from . import mysql_backend

        with connect() as conn:
            mysql_backend.initialize(conn)
            initialize_knowledge(conn, mysql=True)
            initialize_material_profiles(conn, mysql=True)
            conn.commit()
            mysql_backend.seed(conn)
            seed_materials(conn)
            seed_material_profiles(conn)
            sync_ams_slots(conn, migrating=True)
        return
    with connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""CREATE TABLE IF NOT EXISTS filaments (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, manufacturer TEXT NOT NULL,
            material TEXT NOT NULL, color TEXT DEFAULT '', color_hex TEXT DEFAULT '#bd93f9',
            purchase_date TEXT DEFAULT '', opened_date TEXT DEFAULT '', weight REAL NOT NULL,
            remaining REAL NOT NULL, price REAL DEFAULT 0, diameter REAL DEFAULT 1.75,
            nozzle_temp REAL DEFAULT 0, bed_temp REAL DEFAULT 0, location TEXT DEFAULT '',
            notes TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)""")

        columns = {row["name"] for row in conn.execute("PRAGMA table_info(filaments)")}
        if "purchase_format" not in columns:
            conn.execute(
                "ALTER TABLE filaments ADD COLUMN purchase_format TEXT NOT NULL DEFAULT 'unknown' CHECK (purchase_format IN ('spool', 'refill', 'unknown'))"
            )
        if "product_id" not in columns:
            conn.execute(
                "ALTER TABLE filaments ADD COLUMN product_id TEXT NOT NULL DEFAULT ''"
            )
        if "product_url" not in columns:
            conn.execute(
                "ALTER TABLE filaments ADD COLUMN product_url TEXT NOT NULL DEFAULT ''"
            )
        if "transparency" not in columns:
            conn.execute(
                "ALTER TABLE filaments ADD COLUMN transparency TEXT NOT NULL DEFAULT 'opaque' CHECK (transparency IN ('opaque', 'transparent'))"
            )
        if "active_slot" not in columns:
            conn.execute(
                "ALTER TABLE filaments ADD COLUMN active_slot TEXT NOT NULL DEFAULT ''"
            )
        if "label_token" not in columns:
            conn.execute(
                "ALTER TABLE filaments ADD COLUMN label_token TEXT NOT NULL DEFAULT ''"
            )
        conn.execute("""CREATE TABLE IF NOT EXISTS locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            kind TEXT NOT NULL CHECK(kind IN ('box', 'ams_ht', 'ams_2_pro')))""")
        conn.execute("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)")
        if not conn.execute(
            "SELECT name FROM migrations WHERE name='default_ams_2_pro'"
        ).fetchone():
            if not conn.execute(
                "SELECT id FROM locations WHERE kind='ams_2_pro'"
            ).fetchone():
                name = "AMS 2 Pro"
                suffix = 1
                while conn.execute(
                    "SELECT id FROM locations WHERE name=?", (name,)
                ).fetchone():
                    suffix += 1
                    name = f"AMS 2 Pro {suffix}"
                conn.execute(
                    "INSERT INTO locations (name,kind) VALUES (?, 'ams_2_pro')", (name,)
                )
            conn.execute("INSERT INTO migrations (name) VALUES ('default_ams_2_pro')")
        for field in ("location_id", "location_slot"):
            if field not in columns:
                conn.execute(f"ALTER TABLE filaments ADD COLUMN {field} INTEGER")
        conn.execute("""CREATE UNIQUE INDEX IF NOT EXISTS filament_location_slot
            ON filaments(location_id, location_slot) WHERE location_id IS NOT NULL""")
        # Backfill only missing identities: printed QR links must survive every migration.
        for row in conn.execute(
            "SELECT id FROM filaments WHERE label_token='' "
        ).fetchall():
            conn.execute(
                "UPDATE filaments SET label_token=? WHERE id=?",
                (uuid.uuid4().hex, row["id"]),
            )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS filament_label_token ON filaments(label_token)"
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS filament_active_slot ON filaments(active_slot COLLATE NOCASE) WHERE active_slot<>''"
        )
        conn.execute("""CREATE TABLE IF NOT EXISTS consumption (
            id INTEGER PRIMARY KEY, filament_id INTEGER NOT NULL,
            grams REAL NOT NULL CHECK (grams > 0), note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
        if "print_id" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(consumption)")
        }:
            conn.execute("ALTER TABLE consumption ADD COLUMN print_id INTEGER")
        conn.execute("""CREATE TABLE IF NOT EXISTS prints (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            print_date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '')""")

        if "image" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(prints)")
        }:
            conn.execute("ALTER TABLE prints ADD COLUMN image TEXT NOT NULL DEFAULT ''")
        if "project_url" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(prints)")
        }:
            conn.execute(
                "ALTER TABLE prints ADD COLUMN project_url TEXT NOT NULL DEFAULT ''"
            )
        if "status" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(prints)")
        }:
            conn.execute(
                "ALTER TABLE prints ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed'))"
            )
        conn.execute("""CREATE TABLE IF NOT EXISTS waste (
            id INTEGER PRIMARY KEY AUTOINCREMENT, waste_date TEXT NOT NULL,
            reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', project_id INTEGER)""")
        if "waste_id" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(consumption)")
        }:
            conn.execute("ALTER TABLE consumption ADD COLUMN waste_id INTEGER")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS consumption_waste ON consumption(waste_id)"
        )
        if "archived" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(filaments)")
        }:
            conn.execute(
                "ALTER TABLE filaments ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1))"
            )
        if "duration_minutes" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(prints)")
        }:
            conn.execute(
                "ALTER TABLE prints ADD COLUMN duration_minutes INTEGER CHECK (duration_minutes BETWEEN 1 AND 1000000)"
            )
        # SQLite cannot alter a CHECK constraint. Copy the complete print table inside
        # this migration transaction, preserving both identities and the sequence.
        print_schema = conn.execute(
            "SELECT sql FROM sqlite_master WHERE name='prints'"
        ).fetchone()["sql"]
        if "'pending'" not in print_schema:
            sequence = conn.execute(
                "SELECT seq FROM sqlite_sequence WHERE name='prints'"
            ).fetchone()
            conn.execute("""CREATE TABLE prints_status_upgrade (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                print_date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '',
                project_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'completed'
                CHECK (status IN ('completed','failed','in_progress','pending')),
                duration_minutes INTEGER CHECK (duration_minutes BETWEEN 1 AND 1000000))""")
            conn.execute("""INSERT INTO prints_status_upgrade
                (id,name,print_date,note,image,project_url,status,duration_minutes)
                SELECT id,name,print_date,note,image,project_url,status,duration_minutes FROM prints""")
            conn.execute("DROP TABLE prints")
            conn.execute("ALTER TABLE prints_status_upgrade RENAME TO prints")
            if sequence:
                conn.execute(
                    "UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='prints'",
                    (sequence["seq"],),
                )
        conn.execute("""CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
            project_url TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', metadata TEXT NOT NULL,
            print_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS build_plates (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE UNIQUE)""")
        if "build_plate_id" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(projects)")
        }:
            conn.execute("ALTER TABLE projects ADD COLUMN build_plate_id INTEGER")
        if not conn.execute(
            "SELECT name FROM migrations WHERE name='default_textured_pei'"
        ).fetchone():
            conn.execute(
                "INSERT OR IGNORE INTO build_plates (name) VALUES ('Textured PEI')"
            )
            conn.execute(
                "INSERT INTO migrations (name) VALUES ('default_textured_pei')"
            )
        if "filament_types" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(projects)")
        }:
            conn.execute(
                "ALTER TABLE projects ADD COLUMN filament_types TEXT NOT NULL DEFAULT '[]'"
            )
        conn.execute("""CREATE TABLE IF NOT EXISTS archive_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, note TEXT NOT NULL,
            filename TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL UNIQUE,
            size_bytes INTEGER NOT NULL, metadata TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
        if "plate_estimates" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(archive_files)")
        }:
            conn.execute(
                "ALTER TABLE archive_files ADD COLUMN plate_estimates TEXT NOT NULL DEFAULT '{}'"
            )
        if "archive_file_id" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(projects)")
        }:
            conn.execute("ALTER TABLE projects ADD COLUMN archive_file_id INTEGER")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS project_archive_file ON projects(archive_file_id)"
        )
        if "archive_file_id" not in {
            row["name"] for row in conn.execute("PRAGMA table_info(prints)")
        }:
            conn.execute("ALTER TABLE prints ADD COLUMN archive_file_id INTEGER")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS print_archive_file ON prints(archive_file_id)"
        )
        backfill_print_archive_links(conn)
        conn.execute("""CREATE TABLE IF NOT EXISTS shopping_wishes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            grams REAL, product_url TEXT NOT NULL, note TEXT NOT NULL)""")
        conn.execute("CREATE TABLE IF NOT EXISTS material_types (name TEXT NOT NULL)")
        if "material" in columns:
            seed_materials(conn)
        initialize_knowledge(conn)
        initialize_material_profiles(conn)
        seed_material_profiles(conn)
        sync_ams_slots(conn, migrating=True)
