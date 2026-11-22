"""Named build surfaces, independent of numbered plates inside a 3MF package."""


def save_build_plate(conn, payload, identity=None):
    if not isinstance(payload, dict) or set(payload) != {"name"}:
        raise ValueError("Ugyldig byggeplade.")
    name = payload["name"]
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise ValueError("Angiv et pladenavn på højst 100 tegn.")
    name = " ".join(name.split())
    duplicate = conn.execute(
        "SELECT id FROM build_plates WHERE name=? COLLATE NOCASE", (name,)
    ).fetchone()
    if duplicate and duplicate["id"] != identity:
        raise ValueError("Der findes allerede en byggeplade med det navn.")
    if identity is None:
        conn.execute("INSERT INTO build_plates (name) VALUES (?)", (name,))
    else:
        conn.execute("UPDATE build_plates SET name=? WHERE id=?", (name, identity))
