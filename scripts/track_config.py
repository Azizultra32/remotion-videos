"""Shared per-track config loader used by every analyze-audio.sh stage.

A track config is a JSON file at `public/<stem>-config.json`. Any missing
field falls back to the script's hardcoded default — nothing breaks if
the file doesn't exist. See docs/track-config-schema.md for the shape.
"""
from __future__ import annotations

import json
from pathlib import Path


def load_config(path: str | None, section: str) -> dict:
    """Return the `section` block from a config JSON, or `{}` if absent.

    Callers read fields via `cfg.get("name", default)` — the return value
    is always a dict, so .get() never fails."""
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"track config is not valid JSON: {path}: {exc}")
    if not isinstance(data, dict):
        raise SystemExit(f"track config must be a JSON object: {path}")
    block = data.get(section, {})
    if not isinstance(block, dict):
        raise SystemExit(
            f"track config section '{section}' must be an object: {path}"
        )
    return block
