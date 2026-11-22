"""Single-spool consumption and undo rules; project lines are managed as a whole."""


def register_consumption(conn, identity, payload):
    """Deduct weight conditionally so insufficient stock cannot become negative."""
    import math

    if not isinstance(payload, dict) or set(payload) - {
        "grams",
        "note",
    }:
        raise ValueError("Ugyldig forbrugsregistrering.")
    grams = payload.get("grams")
    note = payload.get("note", "")
    if type(grams) not in (int, float) or not math.isfinite(grams) or grams <= 0:
        raise ValueError("Forbrug skal være et positivt antal gram.")
    if not isinstance(note, str) or len(note) > 5000:
        raise ValueError("Noten må højst være 5000 tegn.")
    updated = conn.execute(
        "UPDATE filaments SET remaining=remaining-? WHERE id=? AND remaining>=?",
        (grams, identity, grams),
    )
    if updated.rowcount != 1:
        raise ValueError("Forbruget overstiger spolens restvægt.")
    conn.execute(
        "UPDATE filaments SET active_slot='' WHERE id=? AND remaining=0",
        (identity,),
    )
    conn.execute(
        "INSERT INTO consumption (filament_id, grams, note) VALUES (?, ?, ?)",
        (identity, grams, note.strip()),
    )


def undo_consumption(conn, entry):
    """Restore weight only if it still fits within the original spool weight."""
    if entry["print_id"] is not None or entry["waste_id"] is not None:
        raise ValueError(
            "Slet hele printet eller spildregistreringen for at gendanne materialeforbruget."
        )
    updated = conn.execute(
        "UPDATE filaments SET remaining=remaining+? WHERE id=? AND remaining+?<=weight",
        (entry["grams"], entry["filament_id"], entry["grams"]),
    )
    if updated.rowcount != 1:
        raise ValueError(
            "Kan ikke gendanne vægten. Kontrollér spolens restvægt og oprindelige vægt, som kan være ændret manuelt."
        )
    conn.execute("DELETE FROM consumption WHERE id=?", (entry["id"],))


def replace_consumption_lines(conn, items, previous, note, parent_column, parent_id):
    """Apply deltas in the caller's transaction; parent columns are application-owned."""
    import math

    if parent_column not in {"print_id", "waste_id"}:
        raise ValueError("Ugyldig registrering.")
    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        raise ValueError("Tilføj mellem 1 og 100 spoler.")
    seen = set()
    for item in items:
        if not isinstance(item, dict) or set(item) != {"filament_id", "grams"}:
            raise ValueError("Ugyldig spolelinje.")
        identity, grams = item["filament_id"], item["grams"]
        if type(identity) is not int or identity in seen:
            raise ValueError("Vælg hver spole én gang.")
        seen.add(identity)
        if type(grams) not in (int, float) or not math.isfinite(grams) or grams <= 0:
            raise ValueError("Forbrug skal være et positivt antal gram.")
        # Apply only the difference on edits; restoring the full old amount first
        # could exceed a spool weight that has since been corrected manually.
        delta = grams - previous.pop(identity, 0)
        updated = conn.execute(
            "UPDATE filaments SET remaining=remaining-? WHERE id=? AND remaining-?>=0 AND remaining-?<=weight",
            (delta, identity, delta, delta),
        )
        if updated.rowcount != 1:
            raise ValueError(
                "En af de valgte spoler findes ikke eller har ikke nok filament."
            )
        conn.execute(
            "UPDATE filaments SET active_slot='' WHERE id=? AND remaining=0",
            (identity,),
        )
        conn.execute(
            f"INSERT INTO consumption (filament_id, grams, note, {parent_column}) VALUES (?, ?, ?, ?)",
            (identity, grams, note, parent_id),
        )

    # Removed lines return their consumption to the original spool in this transaction.
    for identity, grams in previous.items():
        updated = conn.execute(
            "UPDATE filaments SET remaining=remaining+? WHERE id=? AND remaining+?<=weight",
            (grams, identity, grams),
        )
        if updated.rowcount != 1:
            raise ValueError(
                "Kan ikke gendanne spolens restvægt. Kontrollér dens oprindelige vægt."
            )
