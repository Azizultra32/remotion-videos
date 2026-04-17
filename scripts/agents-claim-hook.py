#!/usr/bin/env python3
"""
agents-claim-hook.py — Claude Code PreToolUse hook for Write/Edit.

Reads the hook JSON on stdin. If the target file is inside this repo, claims
it in scripts/agents.py for the current session. A conflict (file claimed by
a different agent) returns a non-zero exit, which blocks the tool call.

Fails open on anything unexpected (missing file_path, file outside repo,
malformed JSON, scripts/agents.py absent) so the hook never breaks routine
editing when the coordination tool isn't set up.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        return 0  # fail open: don't block edits on garbled hook input

    file_path = (data.get("tool_input") or {}).get("file_path")
    if not isinstance(file_path, str) or not file_path:
        return 0  # nothing to claim

    repo_root = Path(__file__).resolve().parent.parent

    try:
        rel = Path(file_path).resolve().relative_to(repo_root)
    except ValueError:
        return 0  # file is outside this repo — don't pollute the claim board

    session_id = data.get("session_id") or ""
    agent_id = session_id[:8] if session_id else f"pid-{os.getpid()}"

    agents_py = repo_root / "scripts" / "agents.py"
    if not agents_py.exists():
        return 0  # coord tool not installed in this branch — allow edit

    result = subprocess.run(
        [sys.executable, str(agents_py), "claim", agent_id, str(rel)],
        capture_output=True,
        text=True,
    )
    # Surface messages so the user sees why a block happened.
    if result.stdout:
        sys.stderr.write(result.stdout)
    if result.stderr:
        sys.stderr.write(result.stderr)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
