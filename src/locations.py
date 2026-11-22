"""Location names, capacity rules and derived active AMS slots."""


def location_label(name, kind, slot):
    return f"{name} · slot {slot}" if kind == "ams_2_pro" else name


def sync_ams_slots(conn, migrating=False):
    # Undoing consumption can restore stock to an archived roll. Bring it back to
    # inventory in the same transaction, without reclaiming its old physical slot.
    if not migrating:
        conn.execute("UPDATE filaments SET archived=0 WHERE archived=1 AND remaining>0")
    rows = conn.execute("""SELECT f.*, l.name AS location_name, l.kind AS location_kind
        FROM filaments f JOIN locations l ON l.id=f.location_id
        WHERE l.kind IN ('ams_2_pro','ams_ht')""").fetchall()
    # Free managed labels first, allowing renames without transient collisions.
    for row in rows:
        conn.execute("UPDATE filaments SET active_slot='' WHERE id=?", (row["id"],))
    for row in rows:
        label = location_label(
            row["location_name"], row["location_kind"], row["location_slot"]
        )
        if row["remaining"] > 0:
            conflict = conn.execute(
                "SELECT id FROM filaments WHERE active_slot=? COLLATE NOCASE", (label,)
            ).fetchone()
            if conflict and migrating:
                # Preserve legacy manual assignments; resolve them explicitly in the editor.
                continue
            conn.execute(
                "UPDATE filaments SET active_slot=? WHERE id=?", (label, row["id"])
            )


def save_location(conn, data, identity=None):
    """Create or update a location within the caller's transaction."""
    if not isinstance(data, dict) or set(data) != {"name", "kind"}:
        raise ValueError("Ugyldig placering.")
    name, kind = data["name"], data["kind"]
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise ValueError("Angiv et placeringsnavn på højst 100 tegn.")
    if kind not in ("box", "ams_ht", "ams_2_pro"):
        raise ValueError("Vælg boks, AMS HT eller AMS 2 Pro.")
    name = " ".join(name.split())
    if identity is None:
        conn.execute(
            "INSERT INTO locations (name,kind) VALUES (?,?)",
            (name, kind),
        )
    else:
        capacity = 4 if kind == "ams_2_pro" else 1
        if conn.execute(
            "SELECT id FROM filaments WHERE location_id=? AND location_slot>?",
            (identity, capacity),
        ).fetchone():
            raise ValueError("Flyt spolerne fra de ekstra slots, før typen ændres.")
        if kind not in ("ams_2_pro", "ams_ht"):
            conn.execute(
                """UPDATE filaments SET active_slot='' WHERE location_id=?
                AND EXISTS (SELECT 1 FROM locations WHERE id=? AND kind IN ('ams_2_pro','ams_ht'))""",
                (identity, identity),
            )
        conn.execute(
            "UPDATE locations SET name=?,kind=? WHERE id=?",
            (name, kind, identity),
        )
        for row in conn.execute(
            "SELECT id,location_slot FROM filaments WHERE location_id=?",
            (identity,),
        ).fetchall():
            conn.execute(
                "UPDATE filaments SET location=? WHERE id=?",
                (
                    location_label(name, kind, row["location_slot"]),
                    row["id"],
                ),
            )


def assign_location_content(conn, identity, payload):
    """Move one roll and release the previous occupant within the caller's transaction."""
    if not isinstance(payload, dict) or set(payload) != {
        "slot",
        "filament_id",
        "expected_filament_id",
    }:
        raise ValueError("Ugyldigt valg af indhold.")
    place = conn.execute("SELECT * FROM locations WHERE id=?", (identity,)).fetchone()
    if place is None:
        raise ValueError("Placeringen findes ikke længere.")
    slot = payload["slot"]
    if type(slot) is not int or not 1 <= slot <= (
        4 if place["kind"] == "ams_2_pro" else 1
    ):
        raise ValueError("Vælg et gyldigt slot.")
    selected_id, expected = payload["filament_id"], payload["expected_filament_id"]
    for value in (selected_id, expected):
        if value is not None and (type(value) is not int or value < 1):
            raise ValueError("Vælg en eksisterende spole eller ingen spole.")
    current = conn.execute(
        "SELECT id,active_slot FROM filaments WHERE location_id=? AND location_slot=?",
        (identity, slot),
    ).fetchone()
    if (current["id"] if current else None) != expected:
        raise ValueError(
            "Pladsens indhold er ændret. Luk dialogen og vælg indhold igen."
        )
    selected = None
    if selected_id is not None:
        selected = conn.execute(
            """SELECT f.*,l.kind AS location_kind FROM filaments f
            LEFT JOIN locations l ON l.id=f.location_id WHERE f.id=?""",
            (selected_id,),
        ).fetchone()
        if selected is None or selected["archived"]:
            raise ValueError("Vælg en spole fra det aktuelle lager.")
    if selected_id == expected:
        return
    managed = place["kind"] in ("ams_2_pro", "ams_ht")
    if current:
        conn.execute(
            "UPDATE filaments SET location_id=NULL,location_slot=NULL,location='',active_slot=? WHERE id=?",
            ("" if managed else current["active_slot"], current["id"]),
        )
    if selected:
        active = (
            ""
            if managed or selected["location_kind"] in ("ams_2_pro", "ams_ht")
            else selected["active_slot"]
        )
        conn.execute(
            "UPDATE filaments SET location_id=?,location_slot=?,location=?,active_slot=? WHERE id=?",
            (
                identity,
                slot,
                location_label(place["name"], place["kind"], slot),
                active,
                selected_id,
            ),
        )
