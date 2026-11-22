"""Optional MySQL 8.4 backend; SQLite development needs no dependencies."""

import os
import sqlite3

from .archive_links import backfill_print_archive_links


class Connection:
    def __init__(self):
        import pymysql
        from pymysql.constants import CLIENT

        password_file = os.environ.get("MYSQL_PASSWORD_FILE")
        if password_file:
            from pathlib import Path

            password = Path(password_file).read_text().rstrip("\r\n")
        else:
            password = os.environ.get("MYSQL_PASSWORD", "")
        self.raw = pymysql.connect(
            host=os.environ.get("MYSQL_HOST", "host.docker.internal"),
            port=int(os.environ.get("MYSQL_PORT", "3306")),
            user=os.environ.get("MYSQL_USER", "filamentdb"),
            password=password,
            database=os.environ.get("MYSQL_DATABASE", "filamentdb"),
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            client_flag=CLIENT.FOUND_ROWS,
            autocommit=False,
            connect_timeout=10,
            read_timeout=30,
            write_timeout=30,
            init_command=(
                "SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION', "
                "time_zone='+00:00'"
            ),
        )

    def __enter__(self):
        return self

    def __exit__(self, kind, value, traceback):
        try:
            if kind is None:
                self.raw.commit()
            else:
                self.raw.rollback()
        finally:
            self.raw.close()

    def execute(self, sql, parameters=()):
        import pymysql

        cursor = self.raw.cursor()
        try:
            if sql == "BEGIN IMMEDIATE":
                # Serialize app writers across containers, matching SQLite's semantics.
                # All domain checks then see the latest committed inventory.
                self.raw.begin()
                cursor.execute("SELECT id FROM app_write_lock WHERE id=1 FOR UPDATE")
                return cursor
            sql = sql.replace("COLLATE NOCASE", "COLLATE utf8mb4_0900_as_ci")
            # Queries are application-owned; values always remain parameters.
            sql = sql.replace("%", "%%").replace("?", "%s")
            cursor.execute(sql, parameters)
            return cursor
        except pymysql.IntegrityError as error:
            cursor.close()
            message = str(error)
            for index, column in (
                ("location_name", "locations.name"),
                ("filament_location_slot", "filaments.location_id"),
            ):
                if index in message:
                    message = column
            raise sqlite3.IntegrityError(message) from error
        except BaseException:
            cursor.close()
            raise

    def executemany(self, sql, rows):
        # Keep the same integrity-error translation as single statements.
        for row in rows:
            self.execute(sql, row).close()

    def close(self):
        self.raw.close()

    def commit(self):
        self.raw.commit()


def initialize(conn):
    """Idempotent baseline schema. DDL runs before inventory transactions."""
    texts = [
        "name",
        "manufacturer",
        "material",
        "color",
        "color_hex",
        "purchase_date",
        "opened_date",
        "location",
        "notes",
        "product_id",
        "product_url",
    ]
    numbers = {
        "weight": 0,
        "remaining": 0,
        "price": 0,
        "diameter": 1.75,
        "nozzle_temp": 0,
        "bed_temp": 0,
    }
    fields = [f"`{name}` TEXT NOT NULL DEFAULT ('')" for name in texts]
    fields += [
        f"`{name}` DOUBLE NOT NULL DEFAULT {value}" for name, value in numbers.items()
    ]
    conn.execute(
        """CREATE TABLE IF NOT EXISTS filaments (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        """
        + ",".join(fields)
        + """,
        purchase_format VARCHAR(16) NOT NULL DEFAULT 'unknown',
        transparency VARCHAR(16) NOT NULL DEFAULT 'opaque',
        active_slot VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL DEFAULT '',
        active_slot_key VARCHAR(100) COLLATE utf8mb4_0900_as_ci
            GENERATED ALWAYS AS (NULLIF(active_slot,'')) VIRTUAL INVISIBLE,
        label_token VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
        location_id BIGINT NULL, location_slot INTEGER NULL,
        created_at VARCHAR(32) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        UNIQUE KEY filament_active_slot (active_slot_key),
        UNIQUE KEY filament_location_slot (location_id,location_slot),
        UNIQUE KEY filament_label_token (label_token),
        CHECK (purchase_format IN ('spool','refill','unknown')),
        CHECK (transparency IN ('opaque','transparent'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin"""
    )
    for sql in (
        """CREATE TABLE IF NOT EXISTS locations (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL,
            kind VARCHAR(16) NOT NULL,
            UNIQUE KEY location_name (name),
            CHECK (kind IN ('box','ams_ht','ams_2_pro'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin""",
        """CREATE TABLE IF NOT EXISTS prints (
            id BIGINT PRIMARY KEY AUTO_INCREMENT, name TEXT NOT NULL,
            print_date VARCHAR(10) NOT NULL, note TEXT NOT NULL DEFAULT ('')
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin""",
        """CREATE TABLE IF NOT EXISTS consumption (
            id BIGINT PRIMARY KEY AUTO_INCREMENT, filament_id BIGINT NOT NULL,
            grams DOUBLE NOT NULL CHECK (grams>0), note TEXT NOT NULL DEFAULT (''),
            created_at VARCHAR(32) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
            print_id BIGINT NULL,
            KEY consumption_filament (filament_id), KEY consumption_print (print_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin""",
        """CREATE TABLE IF NOT EXISTS migrations (name VARCHAR(100) PRIMARY KEY)
            ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin""",
        """CREATE TABLE IF NOT EXISTS app_write_lock (id INTEGER PRIMARY KEY)
            ENGINE=InnoDB""",
        "INSERT IGNORE INTO app_write_lock (id) VALUES (1)",
    ):
        conn.execute(sql)
    if not conn.execute("SHOW COLUMNS FROM prints LIKE 'image'").fetchone():
        conn.execute(
            "ALTER TABLE prints ADD COLUMN image MEDIUMTEXT NOT NULL DEFAULT ('')"
        )
    if not conn.execute("SHOW COLUMNS FROM prints LIKE 'project_url'").fetchone():
        conn.execute(
            "ALTER TABLE prints ADD COLUMN project_url TEXT NOT NULL DEFAULT ('')"
        )
    if not conn.execute("SHOW COLUMNS FROM prints LIKE 'status'").fetchone():
        conn.execute(
            "ALTER TABLE prints ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed'))"
        )
    conn.execute("""CREATE TABLE IF NOT EXISTS waste (
        id BIGINT PRIMARY KEY AUTO_INCREMENT, waste_date VARCHAR(10) NOT NULL,
        reason VARCHAR(32) NOT NULL, note TEXT NOT NULL, project_id BIGINT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin""")
    if not conn.execute("SHOW COLUMNS FROM consumption LIKE 'waste_id'").fetchone():
        conn.execute(
            "ALTER TABLE consumption ADD COLUMN waste_id BIGINT NULL, ADD KEY consumption_waste (waste_id)"
        )
    if not conn.execute("SHOW COLUMNS FROM filaments LIKE 'archived'").fetchone():
        conn.execute(
            "ALTER TABLE filaments ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1))"
        )
    if not conn.execute("SHOW COLUMNS FROM prints LIKE 'duration_minutes'").fetchone():
        conn.execute(
            "ALTER TABLE prints ADD COLUMN duration_minutes INTEGER NULL CHECK (duration_minutes BETWEEN 1 AND 1000000)"
        )
    checks = conn.execute("""SELECT tc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS clause
        FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc
        ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME
        WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME='prints' AND tc.CONSTRAINT_TYPE='CHECK'""").fetchall()
    for check in checks:
        if "status" in check["clause"] and "pending" not in check["clause"]:
            # Names come from schema metadata; quote them as identifiers, never as values.
            name = check["name"].replace("`", "``")
            conn.execute(f"ALTER TABLE prints DROP CHECK `{name}`")
    if not any(
        "status" in check["clause"] and "pending" in check["clause"] for check in checks
    ):
        conn.execute(
            "ALTER TABLE prints ADD CONSTRAINT print_status_valid CHECK (status IN ('completed','failed','in_progress','pending'))"
        )
    conn.execute("""CREATE TABLE IF NOT EXISTS projects (
        id BIGINT PRIMARY KEY AUTO_INCREMENT, name TEXT NOT NULL, note TEXT NOT NULL,
        project_url TEXT NOT NULL, image MEDIUMTEXT NOT NULL, metadata MEDIUMTEXT NOT NULL,
        print_id BIGINT NULL, created_at VARCHAR(32) NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin""")
    conn.execute("""CREATE TABLE IF NOT EXISTS build_plates (
        id BIGINT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL,
        UNIQUE KEY build_plate_name (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin""")
    if not conn.execute("SHOW COLUMNS FROM projects LIKE 'build_plate_id'").fetchone():
        conn.execute("ALTER TABLE projects ADD COLUMN build_plate_id BIGINT NULL")
    if not conn.execute("SHOW COLUMNS FROM projects LIKE 'filament_types'").fetchone():
        conn.execute(
            "ALTER TABLE projects ADD COLUMN filament_types TEXT NOT NULL DEFAULT ('[]')"
        )
    conn.execute("""CREATE TABLE IF NOT EXISTS shopping_wishes (
        id BIGINT PRIMARY KEY AUTO_INCREMENT, name TEXT NOT NULL,
        grams DOUBLE NULL, product_url TEXT NOT NULL, note TEXT NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin""")
    conn.execute("""CREATE TABLE IF NOT EXISTS material_types (
        name TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin""")
    conn.execute("""CREATE TABLE IF NOT EXISTS archive_files (
        id BIGINT PRIMARY KEY AUTO_INCREMENT, name TEXT NOT NULL, note TEXT NOT NULL,
        filename TEXT NOT NULL, storage_key VARCHAR(36) NOT NULL UNIQUE,
        sha256 VARCHAR(64) NOT NULL UNIQUE, size_bytes BIGINT NOT NULL, metadata MEDIUMTEXT NOT NULL,
        created_at VARCHAR(32) NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at VARCHAR(32) NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin""")
    if not conn.execute(
        "SHOW COLUMNS FROM archive_files LIKE 'plate_estimates'"
    ).fetchone():
        conn.execute(
            "ALTER TABLE archive_files ADD COLUMN plate_estimates TEXT NOT NULL DEFAULT ('{}')"
        )
    if not conn.execute("SHOW COLUMNS FROM projects LIKE 'archive_file_id'").fetchone():
        conn.execute(
            "ALTER TABLE projects ADD COLUMN archive_file_id BIGINT NULL, ADD INDEX project_archive_file (archive_file_id)"
        )
    if not conn.execute("SHOW COLUMNS FROM prints LIKE 'archive_file_id'").fetchone():
        conn.execute(
            "ALTER TABLE prints ADD COLUMN archive_file_id BIGINT NULL, ADD INDEX print_archive_file (archive_file_id)"
        )
    backfill_print_archive_links(conn)
    conn.commit()


def seed(conn):
    conn.execute("BEGIN IMMEDIATE")
    if not conn.execute(
        "SELECT name FROM migrations WHERE name='default_textured_pei'"
    ).fetchone():
        conn.execute("INSERT IGNORE INTO build_plates (name) VALUES ('Textured PEI')")
        conn.execute("INSERT INTO migrations (name) VALUES ('default_textured_pei')")
    if not conn.execute(
        "SELECT name FROM migrations WHERE name='default_ams_2_pro'"
    ).fetchone():
        if not conn.execute(
            "SELECT id FROM locations WHERE kind='ams_2_pro'"
        ).fetchone():
            name, suffix = "AMS 2 Pro", 1
            while conn.execute(
                "SELECT id FROM locations WHERE name=?", (name,)
            ).fetchone():
                suffix += 1
                name = f"AMS 2 Pro {suffix}"
            conn.execute(
                "INSERT INTO locations (name,kind) VALUES (?,'ams_2_pro')", (name,)
            )
        conn.execute("INSERT INTO migrations (name) VALUES ('default_ams_2_pro')")
