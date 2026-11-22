"""Additional waste consumes stock once; failed print waste is derived, never copied."""

from datetime import date

from .consumption import replace_consumption_lines

REASONS = ("failed_print", "purge", "calibration", "other")


def register_waste(conn, payload, identity=None):
    if not isinstance(payload, dict) or set(payload) - {
        "waste_date",
        "reason",
        "note",
        "project_id",
        "items",
    }:
        raise ValueError("Ugyldig spildregistrering.")
    waste_date = payload.get("waste_date")
    if not isinstance(waste_date, str):
        raise TypeError("Angiv en gyldig dato.")
    date.fromisoformat(waste_date)
    reason, note = payload.get("reason"), payload.get("note", "")
    if reason not in REASONS:
        raise ValueError("Vælg en gyldig årsag til spild.")
    if not isinstance(note, str) or len(note) > 5000:
        raise ValueError("Noten må højst være 5000 tegn.")
    project_id = payload.get("project_id")
    if project_id is not None and (
        type(project_id) is not int
        or not conn.execute(
            "SELECT id FROM prints WHERE id=?", (project_id,)
        ).fetchone()
    ):
        raise ValueError("Vælg et eksisterende print eller ingen tilknytning.")
    previous = {}
    if identity is None:
        identity = conn.execute(
            "INSERT INTO waste (waste_date, reason, note, project_id) VALUES (?, ?, ?, ?)",
            (waste_date, reason, note.strip(), project_id),
        ).lastrowid
    else:
        previous = {
            row["filament_id"]: row["grams"]
            for row in conn.execute(
                "SELECT * FROM consumption WHERE waste_id=?", (identity,)
            )
        }
        conn.execute(
            "UPDATE waste SET waste_date=?, reason=?, note=?, project_id=? WHERE id=?",
            (waste_date, reason, note.strip(), project_id, identity),
        )
        conn.execute("DELETE FROM consumption WHERE waste_id=?", (identity,))
    replace_consumption_lines(
        conn, payload.get("items"), previous, note.strip(), "waste_id", identity
    )


def undo_waste(conn, identity):
    for entry in conn.execute(
        "SELECT * FROM consumption WHERE waste_id=?", (identity,)
    ).fetchall():
        updated = conn.execute(
            "UPDATE filaments SET remaining=remaining+? WHERE id=? AND remaining+?<=weight",
            (entry["grams"], entry["filament_id"], entry["grams"]),
        )
        if updated.rowcount != 1:
            raise ValueError(
                "Kan ikke gendanne en af spolerne. Kontrollér dens oprindelige vægt og restvægt."
            )
    conn.execute("DELETE FROM consumption WHERE waste_id=?", (identity,))
    conn.execute("DELETE FROM waste WHERE id=?", (identity,))
