"""Server-side validation of individual spool fields."""

from datetime import date
from urllib.parse import urlparse

FIELDS = {
    "active_slot",
    "transparency",
    "product_url",
    "product_id",
    "purchase_format",
    "name",
    "manufacturer",
    "material",
    "color",
    "color_hex",
    "purchase_date",
    "opened_date",
    "weight",
    "remaining",
    "price",
    "diameter",
    "nozzle_temp",
    "bed_temp",
    "location",
    "location_id",
    "location_slot",
    "notes",
}


def validate(data):
    if not isinstance(data, dict) or set(data) - FIELDS:
        raise ValueError("Ukendte felter i formularen.")
    result = {}
    for field in FIELDS:
        value = data.get(
            field,
            {"purchase_format": "unknown", "transparency": "opaque"}.get(field, ""),
        )
        if field in {"location_id", "location_slot"}:
            if value is None or value == "":
                value = None
            elif type(value) is not int or value < 1:
                raise ValueError("Ugyldig placering eller slot.")
        elif field in {
            "weight",
            "remaining",
            "price",
            "diameter",
            "nozzle_temp",
            "bed_temp",
        }:
            try:
                value = float(value)
            except (ValueError, TypeError):
                raise ValueError("Udfyld alle talfelter med gyldige tal.")
            import math

            if not math.isfinite(value) or value < 0 or value > 1000000:
                raise ValueError("Tal skal være mellem 0 og 1.000.000.")
        else:
            if not isinstance(value, str) or len(value) > 5000:
                raise ValueError("Et tekstfelt er for langt eller ugyldigt.")
            value = value.strip()
        result[field] = value
    if result["transparency"] not in {"opaque", "transparent"}:
        raise ValueError("Vælg dækkende eller transparent farve.")
    if len(result["active_slot"]) > 100:
        raise ValueError("Aktiv plads må højst være 100 tegn.")
    result["active_slot"] = " ".join(result["active_slot"].split())
    if result["active_slot"] and result["remaining"] <= 0:
        raise ValueError("En tom spole kan ikke aktiveres. Vælg ingen aktiv plads.")
    if result["product_url"]:
        link = urlparse(result["product_url"])
        if (
            link.scheme not in {"http", "https"}
            or not link.hostname
            or link.username is not None
            or link.password is not None
            or any(char.isspace() or ord(char) < 32 for char in result["product_url"])
            or "\\" in result["product_url"]
        ):
            raise ValueError(
                "Produktlink skal være en gyldig http:// eller https:// adresse."
            )
    if len(result["product_id"]) > 200:
        raise ValueError("Produkt-id må højst være 200 tegn.")
    if result["purchase_format"] not in {"spool", "refill", "unknown"}:
        raise ValueError("Vælg med spole, refill eller ikke angivet.")
    for field in ("name", "manufacturer", "material"):
        if not result[field]:
            raise ValueError("Navn, producent og materiale skal udfyldes.")
    if (
        result["weight"] <= 0
        or result["remaining"] > result["weight"]
        or result["diameter"] <= 0
    ):
        raise ValueError("Kontrollér spolevægt, resterende vægt og diameter.")
    import re

    if not re.fullmatch(r"#[0-9a-fA-F]{6}", result["color_hex"]):
        raise ValueError("Ugyldig farvekode.")
    for field in ("purchase_date", "opened_date"):
        if result[field]:
            try:
                date.fromisoformat(result[field])
            except ValueError:
                raise ValueError("Ugyldig dato.")
    return result
