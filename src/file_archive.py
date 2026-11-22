"""Original 3MF files on disk, with searchable metadata and independent notes."""

import copy
import json
import math
import os
import re
import uuid
from pathlib import Path

from . import database
from .three_mf import extract_3mf


def archive_root():
    return Path(os.environ.get("FILE_ARCHIVE_PATH", database.DB.parent / "files"))


def storage_path(key):
    # Only server-generated keys can address disk; filenames never become paths.
    if not isinstance(key, str) or not re.fullmatch(r"[0-9a-f]{32}\.3mf", key):
        raise ValueError("Ugyldig arkivfil.")
    return archive_root() / key


def apply_estimates(draft, estimates):
    """Apply user defaults to a new preview, never to the source metadata/bytes."""
    for plate in draft["plates"]:
        override = estimates.get(plate["id"], {})
        for field in ("estimated_seconds", "estimated_grams"):
            if override.get(field) is not None:
                plate[field] = override[field]
    return draft


def upload_file(conn, content, filename, created):
    if not isinstance(filename, str) or not filename.lower().endswith(".3mf"):
        raise ValueError("Vælg en fil med endelsen .3mf.")
    draft = extract_3mf(content, filename)
    existing = conn.execute(
        "SELECT id,storage_key,plate_estimates FROM archive_files WHERE sha256=?",
        (draft["sha256"],),
    ).fetchone()
    if existing:
        # A retry of the same upload preserves the user's title and notes.
        if not storage_path(existing["storage_key"]).is_file():
            raise ValueError(
                "Originalfilen mangler på serveren. Gendan den fra backup."
            )
        return existing["id"], apply_estimates(
            draft, json.loads(existing["plate_estimates"])
        )
    metadata = copy.deepcopy(draft)
    for plate in metadata["plates"]:
        plate.pop("thumbnail", None)
    key = uuid.uuid4().hex + ".3mf"
    path = storage_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    # New keys are never reused. Until the DB commit, only this request knows it.
    with path.open("xb") as stream:
        created.append(path)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    identity = conn.execute(
        """INSERT INTO archive_files
        (name,note,filename,storage_key,sha256,size_bytes,metadata)
        VALUES (?,?,?,?,?,?,?)""",
        (
            draft["name"] or "3MF-fil",
            "",
            draft["filename"],
            key,
            draft["sha256"],
            len(content),
            json.dumps(metadata, ensure_ascii=False, allow_nan=False),
        ),
    ).lastrowid
    return identity, draft


def get_file(conn, identity):
    row = conn.execute(
        "SELECT id,name,note,filename,sha256,size_bytes,metadata,plate_estimates,created_at,updated_at FROM archive_files WHERE id=?",
        (identity,),
    ).fetchone()
    if row is None:
        return None
    result = dict(row)
    result["metadata"] = json.loads(result["metadata"])
    result["plate_estimates"] = json.loads(result["plate_estimates"])
    result["projects"] = [
        dict(project)
        for project in conn.execute(
            "SELECT id,name,print_id FROM projects WHERE archive_file_id=? ORDER BY id DESC",
            (identity,),
        )
    ]
    result["prints"] = [
        dict(printing)
        for printing in conn.execute(
            "SELECT id,name,print_date,status FROM prints WHERE archive_file_id=? ORDER BY print_date DESC,id DESC",
            (identity,),
        )
    ]
    return result


def update_file(conn, identity, payload):
    if not isinstance(payload, dict) or set(payload) - {"plate_estimates"} != {
        "name",
        "note",
    }:
        raise ValueError("Angiv filens titel og note.")
    name, note = payload["name"], payload["note"]
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise ValueError("Angiv en titel på højst 200 tegn.")
    if not isinstance(note, str) or len(note) > 5000:
        raise ValueError("Noten må højst være 5000 tegn.")
    if "plate_estimates" in payload:
        estimates = payload["plate_estimates"]
        source = conn.execute(
            "SELECT metadata FROM archive_files WHERE id=?", (identity,)
        ).fetchone()
        plate_ids = {plate["id"] for plate in json.loads(source["metadata"])["plates"]}
        if not isinstance(estimates, dict) or set(estimates) - plate_ids:
            raise ValueError("Vælg en eksisterende printplade til forventningerne.")
        for estimate in estimates.values():
            if not isinstance(estimate, dict) or set(estimate) != {
                "estimated_seconds",
                "estimated_grams",
            }:
                raise ValueError("Angiv forventet tid og forbrug pr. printplade.")
            seconds, grams = estimate["estimated_seconds"], estimate["estimated_grams"]
            if seconds is not None and (
                type(seconds) is not int or not 0 <= seconds <= 100000000
            ):
                raise ValueError(
                    "Forventet tid skal være et heltal mellem 0 og 100.000.000 sekunder."
                )
            if grams is not None and (
                type(grams) not in (int, float)
                or not 0 <= grams <= 1000000
                or not math.isfinite(grams)
            ):
                raise ValueError(
                    "Forventet forbrug skal være mellem 0 og 1.000.000 gram."
                )
        conn.execute(
            "UPDATE archive_files SET plate_estimates=? WHERE id=?",
            (json.dumps(estimates, allow_nan=False), identity),
        )
    conn.execute(
        "UPDATE archive_files SET name=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (name.strip(), note.strip(), identity),
    )


def delete_file(conn, identity, deleted):
    row = conn.execute(
        "SELECT storage_key FROM archive_files WHERE id=?", (identity,)
    ).fetchone()
    deleted.append(storage_path(row["storage_key"]))
    conn.execute(
        "UPDATE projects SET archive_file_id=NULL WHERE archive_file_id=?", (identity,)
    )
    conn.execute(
        "UPDATE prints SET archive_file_id=NULL WHERE archive_file_id=?", (identity,)
    )
    conn.execute("DELETE FROM archive_files WHERE id=?", (identity,))
