"""Persistent filament type suggestions, independent of current inventory."""


def remember_material(conn, name):
    name = " ".join(name.split())
    if (
        name
        and not conn.execute(
            "SELECT name FROM material_types WHERE name=? COLLATE NOCASE", (name,)
        ).fetchone()
    ):
        conn.execute("INSERT INTO material_types (name) VALUES (?)", (name,))


def seed_materials(conn):
    for row in conn.execute("SELECT DISTINCT material FROM filaments").fetchall():
        remember_material(conn, row["material"])
