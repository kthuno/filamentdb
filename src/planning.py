"""Read-only project demand and persistent manual shopping wishes."""

import json
import math

from .prints import validate_project_url

PRODUCT_FIELDS = (
    "name",
    "manufacturer",
    "material",
    "product_id",
    "product_url",
    "color",
    "color_hex",
    "transparency",
    "diameter",
    "weight",
    "purchase_format",
)


def product_key(product):
    return tuple(product[field] for field in PRODUCT_FIELDS)


def validate_choices(plate):
    choices = plate.get("material_choices", [])
    count = len(plate["filaments"]) or 1
    if not isinstance(choices, list) or len(choices) > count:
        raise ValueError("Ugyldigt produktvalg.")
    for product in choices:
        if product is None:
            continue
        if not isinstance(product, dict) or set(product) != set(PRODUCT_FIELDS):
            raise ValueError("Ugyldigt filamentprodukt.")
        for field, value in product.items():
            if field in {"diameter", "weight"}:
                if (
                    type(value) not in (int, float)
                    or not math.isfinite(value)
                    or not 0 < value <= 1000000
                ):
                    raise ValueError("Ugyldig produktstørrelse.")
            elif not isinstance(value, str) or len(value) > (
                5000 if field == "product_url" else 500
            ):
                raise ValueError("Ugyldigt produktfelt.")
        validate_project_url(product["product_url"])


def planning_overview(conn):
    products = {}
    for row in conn.execute("SELECT * FROM filaments ORDER BY id"):
        product = {field: row[field] for field in PRODUCT_FIELDS}
        key = product_key(product)
        entry = products.setdefault(
            key, {"product": product, "available": 0, "largest_spool": 0}
        )
        if not row["archived"]:
            entry["available"] += row["remaining"]
            entry["largest_spool"] = max(entry["largest_spool"], row["remaining"])
    needs = {}
    unresolved = []
    estimate_warnings = []
    for row in conn.execute(
        "SELECT id,name,metadata FROM projects WHERE print_id IS NULL ORDER BY id"
    ):
        plate = json.loads(row["metadata"])["plate"]
        quantity = plate.get("quantity", 1)
        lines = plate["filaments"] or [{}]
        if (
            len(lines) > 1
            and plate["estimated_grams"] is not None
            and all(line.get("grams") is not None for line in lines)
            and abs(sum(line["grams"] for line in lines) - plate["estimated_grams"])
            > 0.01
        ):
            estimate_warnings.append({"project_id": row["id"], "name": row["name"]})
        choices = plate.get("material_choices", [])
        for index, line in enumerate(lines):
            grams = (
                plate["estimated_grams"]
                if len(lines) == 1 and plate["estimated_grams"] is not None
                else line.get("grams")
            )
            per_print_grams = grams
            grams = None if grams is None else grams * quantity
            product = choices[index] if index < len(choices) else None
            reference = {
                "project_id": row["id"],
                "name": row["name"],
                "line": index + 1,
                "grams": grams,
                "quantity": quantity,
                "per_print_grams": per_print_grams,
            }
            if product is None:
                unresolved.append(reference)
                continue
            key = product_key(product)
            stock = products.get(
                key, {"product": product, "available": 0, "largest_spool": 0}
            )
            need = needs.setdefault(
                key,
                {
                    **stock,
                    "required": 0,
                    "unknown": 0,
                    "projects": [],
                    "split_required": False,
                },
            )
            need["projects"].append(reference)
            if grams is None:
                need["unknown"] += 1
            else:
                need["required"] += grams
                if stock["available"] >= per_print_grams > stock["largest_spool"]:
                    need["split_required"] = True
    for need in needs.values():
        need["missing"] = max(0, need["required"] - need["available"])
    return {
        "products": list(products.values()),
        "needs": list(needs.values()),
        "unresolved": unresolved,
        "estimate_warnings": estimate_warnings,
        "wishes": [
            dict(row)
            for row in conn.execute("SELECT * FROM shopping_wishes ORDER BY id")
        ],
    }


def save_wish(conn, payload, identity=None):
    if not isinstance(payload, dict) or set(payload) != {
        "name",
        "grams",
        "product_url",
        "note",
    }:
        raise ValueError("Ugyldigt indkøbsønske.")
    name, note, grams = payload["name"], payload["note"], payload["grams"]
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise ValueError("Angiv et navn på højst 200 tegn.")
    if not isinstance(note, str) or len(note) > 5000:
        raise ValueError("Noten må højst være 5000 tegn.")
    if grams is not None and (
        type(grams) not in (int, float)
        or not math.isfinite(grams)
        or not 0 < grams <= 1000000
    ):
        raise ValueError(
            "Angiv gram over nul og højst 1.000.000, eller lad feltet være tomt."
        )
    values = (
        name.strip(),
        grams,
        validate_project_url(payload["product_url"]),
        note.strip(),
    )
    if identity is None:
        conn.execute(
            "INSERT INTO shopping_wishes (name,grams,product_url,note) VALUES (?,?,?,?)",
            values,
        )
    else:
        conn.execute(
            "UPDATE shopping_wishes SET name=?,grams=?,product_url=?,note=? WHERE id=?",
            (*values, identity),
        )
