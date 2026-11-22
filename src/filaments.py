"""Individual spool creation and editing within a caller-owned transaction."""

import uuid

from .locations import location_label
from .validation import validate


def save_filament(conn, payload, identity=None):
    """Preserve identity on edits and create a unique QR token for each new spool."""
    creating = identity is None
    quantity = 1
    if creating and isinstance(payload, dict):
        quantity = payload.pop("quantity", 1)
        if type(quantity) is not int or not 1 <= quantity <= 100:
            raise ValueError("Antal skal være et heltal mellem 1 og 100.")
    old = (
        None
        if creating
        else conn.execute(
            "SELECT f.*, l.kind AS location_kind FROM filaments f LEFT JOIN locations l ON l.id=f.location_id WHERE f.id=?",
            (identity,),
        ).fetchone()
    )
    selected = (
        conn.execute(
            "SELECT kind FROM locations WHERE id=?",
            (payload.get("location_id"),),
        ).fetchone()
        if isinstance(payload, dict) and type(payload.get("location_id")) is int
        else None
    )
    # Managed AMS slots derive their active label from the physical location.
    if isinstance(payload, dict) and (
        (selected and selected["kind"] in ("ams_2_pro", "ams_ht"))
        or (old and old["location_kind"] in ("ams_2_pro", "ams_ht"))
    ):
        payload["active_slot"] = ""
    data = validate(payload)
    if (
        old
        and old["archived"]
        and (data["location_id"] is not None or data["location"] or data["active_slot"])
    ):
        raise ValueError("Gendan spolen fra arkivet, før du tildeler en placering.")
    if creating and quantity > 1 and data["active_slot"]:
        raise ValueError(
            "Opret flere spoler uden aktiv plads, og aktivér dem enkeltvis bagefter."
        )
    if data["location_id"] is not None:
        place = conn.execute(
            "SELECT * FROM locations WHERE id=?", (data["location_id"],)
        ).fetchone()
        if (
            not place
            or data["location_slot"] is None
            or data["location_slot"] > (4 if place["kind"] == "ams_2_pro" else 1)
        ):
            raise ValueError("Vælg en eksisterende placering og et gyldigt slot.")
        if creating and quantity > 1:
            raise ValueError(
                "En placering kan kun tildeles én spole. Opret spolerne uden placering først."
            )
        data["location"] = location_label(
            place["name"], place["kind"], data["location_slot"]
        )
    elif data["location_slot"] is not None:
        raise ValueError("Vælg en placering til slottet.")
    from .materials import remember_material

    remember_material(conn, data["material"])
    # SQL identifiers come from validated field names; all user values are parameters.
    keys = sorted(data)
    if creating:
        conn.executemany(
            f"INSERT INTO filaments ({','.join(keys)},label_token) VALUES ({','.join('?' for _ in keys)},?)",
            [[data[key] for key in keys] + [uuid.uuid4().hex] for _ in range(quantity)],
        )
    else:
        conn.execute(
            f"UPDATE filaments SET {','.join(key + '=?' for key in keys)} WHERE id=?",
            [data[key] for key in keys] + [identity],
        )


def archive_filament(conn, identity, payload):
    """Archive empty rolls without deleting identity/history; release physical slots."""
    if not isinstance(payload, dict) or set(payload) != {"archived"}:
        raise ValueError("Ugyldig arkivering.")
    if type(payload["archived"]) is not bool:
        raise TypeError("Arkivstatus skal være sand eller falsk.")
    if payload["archived"]:
        updated = conn.execute(
            """UPDATE filaments SET archived=1, active_slot='',
            location='', location_id=NULL, location_slot=NULL WHERE id=? AND remaining=0""",
            (identity,),
        )
        if updated.rowcount != 1:
            raise ValueError("Kun tomme spoler kan arkiveres.")
    else:
        conn.execute("UPDATE filaments SET archived=0 WHERE id=?", (identity,))
