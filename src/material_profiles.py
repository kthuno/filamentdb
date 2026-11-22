"""Manufacturer reference values, independent of individual inventory records."""

import json
import re
from pathlib import Path

SEED_PATH = Path(__file__).with_name("reference") / "bambu_filament_guide.json"
MIGRATION = "bambu_filament_guide_77b0b697ca_v1"


def material_key(value):
    """Normalize separators, retaining variant markers such as + and /."""
    return re.sub(r"[\s\-‐‑–—]+", " ", value.strip().casefold())


def manufacturer_key(value):
    if re.sub(r"\s+", "", value.strip().casefold()) in {"bambu", "bambulab"}:
        return "bambu_lab"
    return None


def initialize(conn, mysql=False):
    suffix = (
        " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin"
        if mysql
        else ""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS material_profiles (
        manufacturer_key VARCHAR(80) NOT NULL, material_key VARCHAR(120) NOT NULL,
        manufacturer VARCHAR(100) NOT NULL, material VARCHAR(120) NOT NULL,
        nozzle_min_c INTEGER NOT NULL, nozzle_max_c INTEGER NOT NULL,
        bed_temperatures TEXT NOT NULL, drying_conditions TEXT NOT NULL,
        drying_required INTEGER NOT NULL, flow_ratio DOUBLE NULL,
        source_url TEXT NOT NULL, source_sha256 VARCHAR(64) NOT NULL,
        source_page INTEGER NOT NULL, retrieved_on VARCHAR(10) NOT NULL,
        PRIMARY KEY (manufacturer_key, material_key))"""
        + suffix
    )


def seed(conn):
    """Seed once from a versioned local snapshot without replacing user values."""
    if conn.execute(
        "SELECT name FROM migrations WHERE name=?", (MIGRATION,)
    ).fetchone():
        return
    data = json.loads(SEED_PATH.read_text())
    for profile in data["profiles"]:
        identity = (
            manufacturer_key(data["manufacturer"]),
            material_key(profile["material"]),
        )
        if conn.execute(
            "SELECT material_key FROM material_profiles WHERE manufacturer_key=? AND material_key=?",
            identity,
        ).fetchone():
            continue
        conn.execute(
            """INSERT INTO material_profiles
            (manufacturer_key,material_key,manufacturer,material,nozzle_min_c,nozzle_max_c,
             bed_temperatures,drying_conditions,drying_required,flow_ratio,
             source_url,source_sha256,source_page,retrieved_on)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            identity
            + (
                data["manufacturer"],
                profile["material"],
                *profile["nozzle_temperature_c"],
                json.dumps(profile["bed_temperatures"]),
                json.dumps(profile["drying_conditions"]),
                int(profile["drying_required"]),
                profile["flow_ratio"],
                data["source_url"],
                data["source_sha256"],
                data["source_page"],
                data["retrieved_on"],
            ),
        )
    conn.execute("INSERT INTO migrations (name) VALUES (?)", (MIGRATION,))


def lookup(conn, manufacturer, material):
    brand = manufacturer_key(manufacturer)
    if brand is None:
        return None
    row = conn.execute(
        "SELECT * FROM material_profiles WHERE manufacturer_key=? AND material_key=?",
        (brand, material_key(material)),
    ).fetchone()
    if row is None:
        return None
    result = dict(row)
    result["nozzle_temperature_c"] = [
        result.pop("nozzle_min_c"),
        result.pop("nozzle_max_c"),
    ]
    result["bed_temperatures"] = json.loads(result["bed_temperatures"])
    result["drying_conditions"] = json.loads(result["drying_conditions"])
    result["drying_required"] = bool(result["drying_required"])
    return result
