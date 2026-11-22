"""Upcoming projects store estimates only and never change inventory."""

import json
import math

from .planning import validate_choices
from .prints import validate_print_image, validate_project_url


def validate_project(payload):
    if not isinstance(payload, dict) or set(payload) - {
        "build_plate_id",
        "filament_types",
        "archive_file_id",
    } != {
        "name",
        "note",
        "project_url",
        "image",
        "metadata",
    }:
        raise ValueError("Ugyldigt kommende projekt.")
    name, note = payload["name"], payload["note"]
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise ValueError("Angiv et projektnavn på højst 200 tegn.")
    if not isinstance(note, str) or len(note) > 5000:
        raise ValueError("Noten må højst være 5000 tegn.")
    data = payload["metadata"]
    if not isinstance(data, dict) or set(data) - {
        "filename",
        "sha256",
        "designer",
        "license",
        "application",
        "printer",
        "layer_height",
        "infill",
        "configured_filaments",
        "plate",
    }:
        raise ValueError("Ugyldige projektmetadata.")
    for key in (
        "filename",
        "sha256",
        "designer",
        "license",
        "application",
        "printer",
        "layer_height",
        "infill",
    ):
        if not isinstance(data.get(key, ""), str) or len(data.get(key, "")) > 500:
            raise ValueError("Ugyldige metadatafelter.")
    plate = data.get("plate")
    if not isinstance(plate, dict) or set(plate) - {"material_choices", "quantity"} != {
        "id",
        "name",
        "objects",
        "filaments",
        "estimated_seconds",
        "estimated_grams",
    }:
        raise ValueError("Ugyldig printplade.")
    quantity = plate.get("quantity", 1)
    if type(quantity) is not int or not 1 <= quantity <= 1000:
        raise ValueError("Antal skal være et heltal mellem 1 og 1000.")
    for key in ("id", "name"):
        if not isinstance(plate[key], str) or len(plate[key]) > 500:
            raise ValueError("Ugyldigt pladenavn.")
    if (
        not isinstance(plate["objects"], list)
        or len(plate["objects"]) > 100
        or any(
            not isinstance(item, str) or len(item) > 500 for item in plate["objects"]
        )
    ):
        raise ValueError("Ugyldige objekter.")
    for key in ("estimated_seconds", "estimated_grams"):
        value = plate[key]
        if value is not None and (
            type(value) not in (int, float)
            or not math.isfinite(value)
            or not 0 <= value <= 100000000
        ):
            raise ValueError("Ugyldigt estimat.")
    for key, lines in [
        ("configured_filaments", data.get("configured_filaments", [])),
        ("filaments", plate["filaments"]),
    ]:
        if not isinstance(lines, list) or len(lines) > 100:
            raise ValueError("Ugyldig filamentliste.")
        for line in lines:
            allowed = (
                {"id", "type", "color", "profile", "vendor"}
                if key == "configured_filaments"
                else {"id", "type", "color", "grams"}
            )
            if not isinstance(line, dict) or set(line) - allowed:
                raise ValueError("Ugyldigt filament.")
            for field, value in line.items():
                if field == "grams":
                    if value is not None and (
                        type(value) not in (int, float)
                        or not math.isfinite(value)
                        or not 0 <= value <= 1000000
                    ):
                        raise ValueError("Ugyldigt gramforbrug.")
                elif not isinstance(value, str) or len(value) > 500:
                    raise ValueError("Ugyldigt filamentfelt.")
    validate_choices(plate)
    encoded = json.dumps(data, ensure_ascii=False, allow_nan=False)
    if len(encoded.encode()) > 64000:
        raise ValueError("Projektmetadata er for store.")
    return (
        name.strip(),
        note.strip(),
        validate_project_url(payload["project_url"]),
        validate_print_image(payload["image"]),
        encoded,
    )


def save_project(conn, payload, identity=None):
    values = validate_project(payload)
    if "archive_file_id" in payload:
        archive_file_id = payload["archive_file_id"]
    elif identity is not None:
        archive_file_id = conn.execute(
            "SELECT archive_file_id FROM projects WHERE id=?", (identity,)
        ).fetchone()["archive_file_id"]
    else:
        archive_file_id = None
    if archive_file_id is not None:
        if type(archive_file_id) is not int:
            raise ValueError("Vælg en eksisterende arkivfil.")
        source = conn.execute(
            "SELECT sha256 FROM archive_files WHERE id=?", (archive_file_id,)
        ).fetchone()
        if source is None or source["sha256"] != payload["metadata"].get("sha256"):
            raise ValueError(
                "Arkivfilen findes ikke eller matcher ikke projektets metadata."
            )
    build_plate_id = payload.get("build_plate_id")
    if build_plate_id is not None and (
        type(build_plate_id) is not int
        or not conn.execute(
            "SELECT id FROM build_plates WHERE id=?", (build_plate_id,)
        ).fetchone()
    ):
        raise ValueError("Vælg en eksisterende byggeplade eller ikke angivet.")
    filament_types = payload.get("filament_types", [])
    if not isinstance(filament_types, list) or len(filament_types) > 20:
        raise ValueError("Angiv højst 20 filamenttyper.")
    normalized = []
    seen = set()
    for kind in filament_types:
        if not isinstance(kind, str) or not kind.strip() or len(kind) > 100:
            raise ValueError("Filamenttyper skal være tekst på 1–100 tegn.")
        kind = " ".join(kind.split())
        if kind.casefold() not in seen:
            normalized.append(kind)
            seen.add(kind.casefold())
    from .materials import remember_material

    for kind in normalized:
        remember_material(conn, kind)
    values = (
        *values,
        build_plate_id,
        json.dumps(normalized, ensure_ascii=False),
        archive_file_id,
    )
    if identity is None:
        return conn.execute(
            "INSERT INTO projects (name,note,project_url,image,metadata,build_plate_id,filament_types,archive_file_id) VALUES (?,?,?,?,?,?,?,?)",
            values,
        ).lastrowid
    if (
        conn.execute(
            "SELECT print_id FROM projects WHERE id=?", (identity,)
        ).fetchone()["print_id"]
        is not None
    ):
        raise ValueError(
            "Projektet er allerede registreret som print. Redigér printet i historikken."
        )
    conn.execute(
        "UPDATE projects SET name=?,note=?,project_url=?,image=?,metadata=?,build_plate_id=?,filament_types=?,archive_file_id=? WHERE id=?",
        (*values, identity),
    )
    return identity
