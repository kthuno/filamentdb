"""Shared size-specific label templates; caller owns write transactions."""

import codecs
import json
import math
import re
import uuid
from datetime import UTC, datetime

SIZES = {"40x30": (40, 30), "60x40": (60, 40), "70x80": (70, 80)}
MAX_TEMPLATE = 1024 * 1024
VARIABLES = {
    "spoolid",
    "spoolnumber",
    "filamentname",
    "filamenttype",
    "manufacturer",
    "filamentcolor",
    "filamentcolorrgb",
    "filamentcolorname",
    "productid",
    "producturl",
    "diameter",
    "weight",
    "remainingweight",
    "location",
    "activeslot",
    "notes",
    "nozzletemperature",
    "bedtemperature",
    "flowratio",
    "drying",
    "qrurl",
    "labelwidth",
    "labelheight",
    "appversion",
}
FIELDS = {"text", "qrData", "color", "background", "fill", "stroke"}
TOKEN = re.compile(r"\$([a-zA-Z_][a-zA-Z0-9_]*)\$")
INVALID = "Ugyldig labeltemplate."
CONFLICT = (
    "Labeltemplaten er ændret i en anden browser. Genindlæs opsætningen og prøv igen."
)


class TemplateConflict(ValueError):
    """Optimistic write precondition failed; do not overwrite another client."""


def initialize(conn, mysql=False):
    design_type = "MEDIUMTEXT" if mysql else "TEXT"
    suffix = (
        " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin"
        if mysql
        else ""
    )
    conn.execute(
        f"""CREATE TABLE IF NOT EXISTS label_templates (
        size VARCHAR(5) PRIMARY KEY, revision VARCHAR(32) NOT NULL,
        design {design_type} NOT NULL, updated_at VARCHAR(32) NOT NULL)"""
        + suffix
    )


def _number(value, minimum=-1000, maximum=1000):
    return (
        type(value) in (int, float)
        and math.isfinite(value)
        and minimum <= value <= maximum
    )


def _color(value):
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    if re.fullmatch(r"black|white|transparent|none|#[0-9a-f]{6}", value, re.IGNORECASE):
        return True
    rgb = re.fullmatch(
        r"rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)", value, re.IGNORECASE
    )
    return bool(rgb and all(int(channel) <= 255 for channel in rgb.groups()))


def _substitute(value, path=()):
    if isinstance(value, str):
        matches = TOKEN.findall(value)
        allowed = path == ("name",) or (
            len(path) == 3 and path[0] == "elements" and path[2] in FIELDS
        )
        if matches and (not allowed or any(name not in VARIABLES for name in matches)):
            raise ValueError(INVALID)
        defaults = {
            "filamentcolor": "#0000FF",
            "filamentcolorrgb": "rgb(0, 0, 255)",
            "qrurl": "https://filament.example/#spool/example",
        }
        return TOKEN.sub(lambda match: defaults.get(match[1], "Example"), value)
    if isinstance(value, list):
        return [_substitute(item, (*path, index)) for index, item in enumerate(value)]
    if isinstance(value, dict):
        return {key: _substitute(item, (*path, key)) for key, item in value.items()}
    return value


def validate_template(design, size):
    """Validate stored JSON independently of the browser; never execute/fetch it."""
    try:
        encoded = json.dumps(
            design, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        )
        if (
            size not in SIZES
            or len(encoded.encode()) > MAX_TEMPLATE
            or not isinstance(design, dict)
        ):
            raise ValueError(INVALID)
        w, h = SIZES[size]
        if design.get("labelSize") != {"width": w, "height": h}:
            raise ValueError(
                "Labeltemplatens størrelse matcher ikke det valgte format."
            )
        resolved = _substitute(design)
        if (
            resolved.get("version") != 3
            or not isinstance(design.get("name"), str)
            or len(design["name"]) > 200
        ):
            raise ValueError(INVALID)
        if (resolved.get("multiLabel") or {}).get("enabled") or (
            "isTemplate" in design and type(design["isTemplate"]) is not bool
        ):
            raise ValueError(INVALID)
        elements = resolved.get("elements")
        if not isinstance(elements, list) or len(elements) > 100:
            raise ValueError(INVALID)
        identities = set()
        for element in elements:
            if not isinstance(element, dict) or element.get("type") not in {
                "text",
                "image",
                "shape",
                "qr",
                "barcode",
            }:
                raise ValueError(INVALID)
            identity = element.get("id")
            if (
                not isinstance(identity, str)
                or identity in identities
                or element.get("zone", 0) != 0
            ):
                raise ValueError(INVALID)
            identities.add(identity)
            if (
                any(
                    not _number(element.get(field))
                    for field in ("x", "y", "width", "height")
                )
                or min(element["width"], element["height"]) < 1
            ):
                raise ValueError(INVALID)
            if not _number(element.get("rotation", 0), -360, 360) or any(
                not _color(element.get(field))
                for field in ("color", "fill", "stroke", "background")
            ):
                raise ValueError(INVALID)
            for field in ("strokeWidth", "cornerRadius"):
                if field in element and not _number(element[field], 0, 100):
                    raise ValueError(INVALID)
            kind = element["type"]
            if kind == "text":
                if (
                    not isinstance(element.get("text"), str)
                    or len(element["text"]) > 5000
                    or not _number(element.get("fontSize"), 1, 200)
                ):
                    raise ValueError(INVALID)
                if "fontFamily" in element and (
                    not isinstance(element["fontFamily"], str)
                    or not re.fullmatch(r"[a-zA-Z ,'\-]{1,100}", element["fontFamily"])
                ):
                    raise ValueError(INVALID)
                if element.get("align", "left") not in {
                    "left",
                    "center",
                    "right",
                } or element.get("verticalAlign", "middle") not in {
                    "top",
                    "middle",
                    "bottom",
                }:
                    raise ValueError(INVALID)
            if kind == "barcode" and (
                not isinstance(element.get("barcodeData"), str)
                or not 1 <= len(element["barcodeData"]) <= 500
                or element.get("barcodeFormat", "CODE128")
                not in {
                    "CODE128",
                    "CODE128A",
                    "CODE128B",
                    "CODE128C",
                    "EAN13",
                    "EAN8",
                    "EAN5",
                    "EAN2",
                    "UPC",
                    "UPCE",
                    "CODE39",
                    "ITF14",
                    "ITF",
                    "MSI",
                    "MSI10",
                    "MSI11",
                    "MSI1010",
                    "MSI1110",
                    "pharmacode",
                    "codabar",
                }
                or (
                    "textFontSize" in element
                    and not _number(element["textFontSize"], 1, 200)
                )
            ):
                raise ValueError(INVALID)
            if kind == "qr":
                if (
                    not isinstance(element.get("qrData"), str)
                    or not 1 <= len(element["qrData"]) <= 2953
                    or element.get("rotation", 0) % 90
                ):
                    raise ValueError(INVALID)
                if element.get("errorCorrection", "M") not in {
                    "L",
                    "M",
                    "Q",
                    "H",
                } or element.get("finderStyle", "square") not in {
                    "square",
                    "round-top-left",
                }:
                    raise ValueError(INVALID)
            if kind == "shape" and element.get("shapeType") not in {
                "rectangle",
                "ellipse",
                "triangle",
                "line",
            }:
                raise ValueError(INVALID)
            if kind == "image":
                data = element.get("imageData")
                if (
                    not isinstance(data, str)
                    or len(data) > 700000
                    or not (
                        re.fullmatch(
                            r"data:image/(png|jpeg);base64,[a-zA-Z0-9+/=\r\n]+", data
                        )
                        or data == _bundled_logo()
                    )
                ):
                    raise ValueError(INVALID)
                if (
                    not _number(element.get("brightness", 0), -100, 100)
                    or not _number(element.get("contrast", 0), -100, 100)
                    or element.get("dither", "none")
                    not in {
                        "none",
                        "threshold",
                        "floyd-steinberg",
                        "atkinson",
                        "ordered",
                        "auto",
                    }
                ):
                    raise ValueError(INVALID)
        return encoded
    except (
        TypeError,
        KeyError,
        AttributeError,
        RecursionError,
        OverflowError,
    ) as error:
        raise ValueError(INVALID) from error


def _bundled_logo():
    # The exact data URI is generated from the bundled JS artwork, not user input.
    from urllib.parse import quote

    from .config import ROOT

    source = (ROOT / "static/vendor/bambu-lab-logo.js").read_text()
    literal = source.split("export const bambuLabLogo = ", 1)[1].strip().rstrip(";")
    # Current vendor file is a single quoted JS string with escaped newlines only.
    logo = codecs.decode(literal[1:-1], "unicode_escape")
    attribution = "Logo: Lwde, CC BY-SA 4.0, https://commons.wikimedia.org/wiki/File:BambuLab_logo.svg; monochrome horizontal adaptation; https://creativecommons.org/licenses/by-sa/4.0/"
    logo = logo.replace("<svg ", '<svg width="560" height="66" ', 1).replace(
        "</svg>", "<metadata>" + attribution + "</metadata></svg>"
    )
    return "data:image/svg+xml;charset=utf-8," + quote(logo, safe="~()*!.'-_")


def list_templates(conn):
    return [
        {
            "version": 1,
            "size": row["size"],
            "revision": row["revision"],
            "design": json.loads(row["design"]),
            "updated_at": row["updated_at"],
        }
        for row in conn.execute("SELECT * FROM label_templates ORDER BY size")
    ]


def mutate_template(conn, method, size, payload):
    if (
        size not in SIZES
        or not isinstance(payload, dict)
        or "expected_revision" not in payload
    ):
        raise ValueError(INVALID)
    allowed = (
        {"expected_revision", "design"} if method == "PUT" else {"expected_revision"}
    )
    if set(payload) != allowed or (
        payload["expected_revision"] is not None
        and not isinstance(payload["expected_revision"], str)
    ):
        raise ValueError(INVALID)
    design = validate_template(payload["design"], size) if method == "PUT" else None
    existing = conn.execute(
        "SELECT revision FROM label_templates WHERE size=?", (size,)
    ).fetchone()
    if (existing["revision"] if existing else None) != payload["expected_revision"]:
        raise TemplateConflict(CONFLICT)
    if method == "DELETE":
        conn.execute("DELETE FROM label_templates WHERE size=?", (size,))
    else:
        revision = uuid.uuid4().hex
        updated = datetime.now(UTC).isoformat(timespec="seconds")
        if existing:
            conn.execute(
                "UPDATE label_templates SET revision=?,design=?,updated_at=? WHERE size=?",
                (revision, design, updated, size),
            )
        else:
            conn.execute(
                "INSERT INTO label_templates (size,revision,design,updated_at) VALUES (?,?,?,?)",
                (size, revision, design, updated),
            )
