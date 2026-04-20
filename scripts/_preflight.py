"""Tiny pre-flight helper for scripts/*.py.

Rather than letting a fresh clone that skipped `pip install -r requirements.txt`
blow up with a raw ``ModuleNotFoundError``, each audio/plot helper calls
``require("<module>")`` at import time. When the module is missing we print a
friendly one-liner pointing at requirements.txt and exit cleanly.

Not a dependency manager — version pinning stays in requirements.txt.
"""
from __future__ import annotations

import importlib
import sys


def require(mod: str, *, install: str = "") -> None:
    """Ensure ``mod`` is importable; otherwise print a hint and exit(1)."""
    try:
        importlib.import_module(mod)
    except ModuleNotFoundError:
        hint = install or mod
        sys.stderr.write(
            f"[preflight] missing Python dependency: {mod}\n"
            f"  run: pip install -r requirements.txt (or pip install {hint})\n"
        )
        sys.exit(1)
