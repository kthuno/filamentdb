"""Shared JSON language catalogs for API messages and static locale delivery."""

import json
import re
from functools import lru_cache
from pathlib import Path

from .config import ROOT

LANGUAGE_ROOT = ROOT / "static" / "locales"
CODE = re.compile(r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*")
PARAMETER = re.compile(r"\{(p\d+)\}")


@lru_cache(maxsize=32)
def _read_version(path, _modified, _size):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_json(path):
    path = Path(path)
    stat = path.stat()
    return _read_version(str(path), stat.st_mtime_ns, stat.st_size)


def language_registry():
    result = read_json(LANGUAGE_ROOT / "index.json")
    return {
        item["code"]: item
        for item in result["languages"]
        if CODE.fullmatch(item["code"])
    }


def choose_language(header):
    languages = language_registry()
    normalized = {code.casefold(): code for code in languages}
    for item in (header or "").split(","):
        code = item.split(";", 1)[0].strip().casefold()
        for candidate in (code, code.split("-", 1)[0]):
            if candidate in normalized:
                return normalized[candidate]
    return "da"


def locale_asset(name):
    if name == "index":
        return LANGUAGE_ROOT / "index.json"
    if CODE.fullmatch(name) and name in language_registry():
        return LANGUAGE_ROOT / (name + ".json")
    return None


@lru_cache(maxsize=8)
def _default_lookup(path, modified, size):
    catalog = _read_version(path, modified, size)["messages"]
    exact, patterns = {}, []
    for key, value in catalog.items():
        if not key.startswith("api.") or not isinstance(value, str):
            continue
        if PARAMETER.search(value):
            parts, at = [], 0
            for match in PARAMETER.finditer(value):
                parts.append(re.escape(value[at : match.start()]))
                parts.append("(?P<" + match[1] + ">.*?)")
                at = match.end()
            parts.append(re.escape(value[at:]))
            patterns.append((key, re.compile("".join(parts), re.DOTALL)))
        else:
            exact[value] = key
    return catalog, exact, patterns


def translate_message(message, language):
    path = LANGUAGE_ROOT / "da.json"
    stat = path.stat()
    base, exact, patterns = _default_lookup(str(path), stat.st_mtime_ns, stat.st_size)
    key, params = exact.get(message), {}
    if key is None:
        for candidate, pattern in patterns:
            match = pattern.fullmatch(message)
            if match:
                key, params = candidate, match.groupdict()
                break
    if key is None:
        return message, None, {}
    target = read_json(LANGUAGE_ROOT / (language + ".json"))["messages"]
    value = target.get(key, base[key])
    if not isinstance(value, str):
        value = base[key]
    translated = PARAMETER.sub(lambda match: params.get(match[1], match[0]), value)
    return translated, key, params


def localize_response(body, header):
    if not isinstance(body, dict):
        return body
    try:
        language = choose_language(header)
        result = dict(body)
        if isinstance(result.get("error"), str):
            text, key, params = translate_message(result["error"], language)
            result["error"] = text
            if key:
                result["error_key"] = key
                result["error_params"] = params
        if isinstance(result.get("warnings"), list):
            result["warnings"] = [
                translate_message(value, language)[0]
                if isinstance(value, str)
                else value
                for value in result["warnings"]
            ]
        return result
    except (OSError, ValueError, KeyError, TypeError):
        # API operations remain usable even if a translation file is damaged.
        return body


def translated_value(key, language, default):
    try:
        fallback = read_json(LANGUAGE_ROOT / "da.json")["messages"].get(key, default)
        value = read_json(LANGUAGE_ROOT / (language + ".json"))["messages"].get(
            key, fallback
        )
        return value if isinstance(value, str) else fallback
    except (OSError, ValueError, KeyError, TypeError):
        return default
