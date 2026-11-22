"""Project print registration, images and atomic consumption changes.

The caller owns the transaction: these functions never commit partial changes.
"""

import base64
import binascii
from datetime import date
from urllib.parse import urlparse

from .consumption import replace_consumption_lines


def validate_print_image(value):
    """Accept a bounded JPEG data URL; browser uploads are resized before submission."""
    if not isinstance(value, str) or len(value) > 700000:
        raise ValueError("Billedet er for stort eller ugyldigt.")
    if not value:
        return value
    prefix = "data:image/jpeg;base64,"
    if not value.startswith(prefix):
        raise ValueError("Billedet skal være JPEG.")
    try:
        data = base64.b64decode(value[len(prefix) :], validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("Ugyldigt billede.") from None
    if not data.startswith(b"\xff\xd8\xff") or not data.endswith(b"\xff\xd9"):
        raise ValueError("Ugyldigt JPEG-billede.")
    return value


def validate_project_url(value):
    """Allow optional public web links without credentials or control characters."""
    if not isinstance(value, str) or len(value) > 5000:
        raise ValueError("Projektlinket er for langt eller ugyldigt.")
    value = value.strip()
    if value:
        link = urlparse(value)
        if (
            link.scheme not in {"http", "https"}
            or not link.hostname
            or link.username is not None
            or link.password is not None
            or any(char.isspace() or ord(char) < 32 for char in value)
            or "\\" in value
        ):
            raise ValueError(
                "Projektlink skal være en gyldig http:// eller https:// adresse."
            )
    return value


def register_print(conn, payload, print_id=None):
    """Create or replace a project while preserving its print and spool identities."""
    if not isinstance(payload, dict) or set(payload) - {
        "name",
        "print_date",
        "note",
        "items",
        "image",
        "project_url",
        "status",
        "duration_minutes",
        "planned_project_id",
        "archive_file_id",
    }:
        raise ValueError("Ugyldigt print.")
    name, print_date, note = (
        payload.get(key, "") for key in ("name", "print_date", "note")
    )
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise ValueError("Angiv et projektnavn på højst 200 tegn.")
    if not isinstance(note, str) or len(note) > 5000:
        raise ValueError("Noten må højst være 5000 tegn.")
    duration = payload.get("duration_minutes")
    if duration is not None and (
        type(duration) is not int or not 1 <= duration <= 1000000
    ):
        raise ValueError(
            "Printtid skal være et helt antal minutter mellem 1 og 1.000.000 eller ikke angivet."
        )
    status = payload.get("status", "completed")
    if status not in ("completed", "failed", "in_progress", "pending"):
        raise ValueError(
            "Vælg afventer, igangværende, gennemført eller fejlet som printstatus."
        )
    # Outcome is descriptive only: failed prints still consumed their recorded filament.
    project_url = validate_project_url(payload.get("project_url", ""))
    image = validate_print_image(payload.get("image", ""))
    date.fromisoformat(print_date)
    items = payload.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        raise ValueError("Tilføj mellem 1 og 100 spoler.")
    planned_project = payload.get("planned_project_id")
    if planned_project is not None:
        if print_id is not None or type(planned_project) is not int:
            raise ValueError("Ugyldigt kommende projekt.")
        project = conn.execute(
            "SELECT print_id,archive_file_id FROM projects WHERE id=?",
            (planned_project,),
        ).fetchone()
        if not project or project["print_id"] is not None:
            raise ValueError(
                "Projektet findes ikke eller er allerede registreret som print."
            )
    if (
        payload.get("archive_file_id") is not None
        and type(payload["archive_file_id"]) is not int
    ):
        raise ValueError("Vælg en eksisterende fil fra filarkivet.")
    if planned_project is not None and project["archive_file_id"] is not None:
        archive_file_id = project["archive_file_id"]
        if (
            "archive_file_id" in payload
            and payload["archive_file_id"] != archive_file_id
        ):
            raise ValueError("Arkivfilen skal matche det kommende projekt.")
    elif "archive_file_id" in payload:
        archive_file_id = payload["archive_file_id"]
    elif print_id is not None:
        archive_file_id = conn.execute(
            "SELECT archive_file_id FROM prints WHERE id=?", (print_id,)
        ).fetchone()["archive_file_id"]
    else:
        archive_file_id = None
    if archive_file_id is not None and (
        type(archive_file_id) is not int
        or not conn.execute(
            "SELECT id FROM archive_files WHERE id=?", (archive_file_id,)
        ).fetchone()
    ):
        raise ValueError("Vælg en eksisterende fil fra filarkivet.")
    previous = {}
    if print_id is None:
        print_id = conn.execute(
            "INSERT INTO prints (name, print_date, note, image, project_url, status, duration_minutes, archive_file_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                name.strip(),
                print_date,
                note.strip(),
                image,
                project_url,
                status,
                duration,
                archive_file_id,
            ),
        ).lastrowid
    else:
        previous = {
            row["filament_id"]: row["grams"]
            for row in conn.execute(
                "SELECT * FROM consumption WHERE print_id=?", (print_id,)
            )
        }
        conn.execute(
            "UPDATE prints SET name=?, print_date=?, note=?, image=?, project_url=?, status=?, duration_minutes=?, archive_file_id=? WHERE id=?",
            (
                name.strip(),
                print_date,
                note.strip(),
                image,
                project_url,
                status,
                duration,
                archive_file_id,
                print_id,
            ),
        )
        conn.execute("DELETE FROM consumption WHERE print_id=?", (print_id,))
    replace_consumption_lines(conn, items, previous, note.strip(), "print_id", print_id)
    if planned_project is not None:
        conn.execute(
            "UPDATE projects SET print_id=? WHERE id=?", (print_id, planned_project)
        )


def undo_print(conn, identity):
    """Undo every project line together; a failed restoration rolls back the caller."""
    if not conn.execute("SELECT id FROM prints WHERE id=?", (identity,)).fetchone():
        return False
    if conn.execute(
        "SELECT article_id FROM knowledge_sources WHERE print_id=?", (identity,)
    ).fetchone():
        raise ValueError(
            "Printet bruges som kilde i Erfaringer. Fjern kildekoblingen i artiklen, før printet slettes."
        )
    conn.execute("UPDATE projects SET print_id=NULL WHERE print_id=?", (identity,))
    conn.execute("UPDATE waste SET project_id=NULL WHERE project_id=?", (identity,))
    for entry in conn.execute(
        "SELECT * FROM consumption WHERE print_id=?", (identity,)
    ).fetchall():
        updated = conn.execute(
            "UPDATE filaments SET remaining=remaining+? WHERE id=? AND remaining+?<=weight",
            (entry["grams"], entry["filament_id"], entry["grams"]),
        )
        if updated.rowcount != 1:
            raise ValueError(
                "Kan ikke gendanne en af spolerne. Kontrollér dens restvægt og oprindelige vægt."
            )
    conn.execute("DELETE FROM consumption WHERE print_id=?", (identity,))
    conn.execute("DELETE FROM prints WHERE id=?", (identity,))
    return True
