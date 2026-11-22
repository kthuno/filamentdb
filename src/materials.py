"""Database-owned material suggestions and data-preserving administration."""

import json
from pathlib import Path

DEFAULTS = Path(__file__).with_name("reference") / "material_types.json"
DEFAULTS_MIGRATION = "material_type_defaults_v1"


def material_key(name):
    return " ".join(name.split()).casefold()


def find_material(conn, name):
    key = material_key(name)
    return next(
        (
            row["name"]
            for row in conn.execute("SELECT name FROM material_types")
            if material_key(row["name"]) == key
        ),
        None,
    )


def remember_material(conn, name):
    name = " ".join(name.split())
    if name and find_material(conn, name) is None:
        conn.execute("INSERT INTO material_types (name) VALUES (?)", (name,))


def seed_materials(conn):
    """Import former UI defaults once and retain names used by existing records."""
    if not conn.execute(
        "SELECT name FROM migrations WHERE name=?", (DEFAULTS_MIGRATION,)
    ).fetchone():
        for name in json.loads(DEFAULTS.read_text(encoding="utf-8")):
            remember_material(conn, name)
        conn.execute("INSERT INTO migrations (name) VALUES (?)", (DEFAULTS_MIGRATION,))
    for row in conn.execute("SELECT DISTINCT material FROM filaments").fetchall():
        remember_material(conn, row["material"])
    for row in conn.execute("SELECT filament_types FROM projects").fetchall():
        for name in json.loads(row["filament_types"]):
            remember_material(conn, name)


def list_materials(conn):
    """Return usage without changing stored names or historical records."""
    materials = {}
    for row in conn.execute("SELECT name FROM material_types"):
        materials.setdefault(
            material_key(row["name"]),
            {"name": row["name"], "spool_count": 0, "project_count": 0},
        )
    for row in conn.execute("SELECT material FROM filaments"):
        key = material_key(row["material"])
        if key in materials:
            materials[key]["spool_count"] += 1
    for row in conn.execute("SELECT filament_types FROM projects"):
        for key in {material_key(name) for name in json.loads(row["filament_types"])}:
            if key in materials:
                materials[key]["project_count"] += 1
    for item in materials.values():
        item["in_use"] = bool(item["spool_count"] or item["project_count"])
    return sorted(materials.values(), key=lambda item: material_key(item["name"]))


def mutate_material(conn, method, payload):
    """Use the caller's transaction; never rename values already used by data."""
    fields = {"name", "new_name"} if method == "PUT" else {"name"}
    if not isinstance(payload, dict) or set(payload) != fields:
        raise ValueError("Ugyldig materialetype.")
    original = payload["name"]
    if not isinstance(original, str) or not original.strip():
        raise ValueError("Angiv et materialenavn på 1–100 tegn.")
    existing = find_material(conn, original)
    if method != "POST":
        if existing is None:
            raise ValueError("Materialetypen findes ikke længere.")
        record = next(item for item in list_materials(conn) if item["name"] == existing)
        if record["in_use"]:
            raise ValueError(
                "Materialetypen bruges af spoler eller projekter og kan ikke omdøbes eller slettes."
            )
    if method == "DELETE":
        conn.execute("DELETE FROM material_types WHERE name=?", (existing,))
        return
    name = payload["new_name"] if method == "PUT" else original
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise ValueError("Angiv et materialenavn på 1–100 tegn.")
    name = " ".join(name.split())
    duplicate = find_material(conn, name)
    if duplicate is not None and (method == "POST" or duplicate != existing):
        raise ValueError("Der findes allerede en materialetype med det navn.")
    if method == "POST":
        conn.execute("INSERT INTO material_types (name) VALUES (?)", (name,))
    else:
        conn.execute("UPDATE material_types SET name=? WHERE name=?", (name, existing))
