"""Shared paths and application version, independent of the working directory."""

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = os.environ.get("APP_VERSION") or (ROOT / "VERSION").read_text().strip()
DB = Path(os.environ.get("DATABASE_PATH", ROOT / "data" / "filaments.sqlite3"))


@dataclass(frozen=True)
class OpenAISettings:
    """Backend-only settings; credentials must never appear in representations."""

    api_key: str = field(repr=False)
    model: str


def openai_settings():
    """Validate lazily so inventory and manual knowledge work without OpenAI."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    model = os.environ.get("OPENAI_MODEL", "").strip()
    if not key:
        raise ValueError(
            "OpenAI er ikke konfigureret: angiv OPENAI_API_KEY i den lokale .env-fil."
        )
    if not model:
        raise ValueError(
            "OpenAI er ikke konfigureret: angiv OPENAI_MODEL i den lokale .env-fil."
        )
    if not key.isascii() or any(
        ord(character) < 33 or ord(character) > 126 for character in key
    ):
        raise ValueError(
            "OPENAI_API_KEY skal bestå af gyldige tegn uden mellemrum eller kontroltegn."
        )
    if any(character.isspace() for character in model):
        raise ValueError("OPENAI_MODEL må ikke indeholde mellemrum eller linjeskift.")
    return OpenAISettings(api_key=key, model=model)
