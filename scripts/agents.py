#!/usr/bin/env python3
"""
agents.py — lightweight coordination between parallel Claude Code terminals.

Pattern: each running Claude session claims the files it's editing BEFORE it
starts editing. Other sessions can `check` a file or `status` the whole board
to avoid stomping. Claims auto-expire after STALE_HOURS so a crashed session
doesn't wedge a file forever.

State: .agents-active.json at repo root (gitignored).
Lock : fcntl.flock() on the same file, so concurrent claim/release/check are
       atomic across processes on the same host.

Why this design:
  - No daemon, no broker, no dependencies beyond stdlib.
  - Works today (no experimental flags like CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).
  - For more ambitious setups see docs/AGENT-COORDINATION.md.

Usage:
  scripts/agents.py claim    <agent-id> <file>...
  scripts/agents.py release  <agent-id> [<file>...]     # no files = release all
  scripts/agents.py check    <file>                     # exits 0 free, 1 held
  scripts/agents.py status
  scripts/agents.py prune                               # drop stale claims now
  scripts/agents.py message  <from> <to|all> <text...>  # leave a note
  scripts/agents.py messages [<agent-id>]               # read notes (all, or visible to agent)

Environment:
  AGENTS_STATE_FILE  override state file path (default: repo-root/.agents-active.json)
  AGENTS_STALE_HOURS claim TTL in hours (default: 2)
"""

from __future__ import annotations

import datetime as _dt
import fcntl
import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = Path(
    os.environ.get("AGENTS_STATE_FILE", str(REPO_ROOT / ".agents-active.json"))
)
STALE_HOURS = float(os.environ.get("AGENTS_STALE_HOURS", "2"))


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _parse_ts(ts: str) -> _dt.datetime:
    # Python 3.11+ handles trailing 'Z'; for portability strip it if present.
    ts = ts.rstrip("Z")
    try:
        return _dt.datetime.fromisoformat(ts).replace(tzinfo=_dt.timezone.utc)
    except ValueError:
        return _dt.datetime.now(_dt.timezone.utc)


def _is_stale(ts: str, hours: float | None = None) -> bool:
    age = _dt.datetime.now(_dt.timezone.utc) - _parse_ts(ts)
    limit = (hours if hours is not None else STALE_HOURS) * 3600
    return age.total_seconds() > limit


def _load_and_prune(fh) -> dict[str, Any]:
    fh.seek(0)
    raw = fh.read()
    if not raw.strip():
        return {"claims": [], "messages": []}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Corrupt file — start fresh rather than refuse to run.
        return {"claims": [], "messages": []}
    claims = [c for c in data.get("claims", []) if not _is_stale(c.get("at", ""))]
    # Messages have a longer TTL (24h) since agents may check less often
    messages = [
        m for m in data.get("messages", []) if not _is_stale(m.get("at", ""), hours=24)
    ]
    return {"claims": claims, "messages": messages}


def _save(fh, data: dict[str, Any]) -> None:
    fh.seek(0)
    fh.truncate()
    json.dump(data, fh, indent=2, sort_keys=True)
    fh.write("\n")
    fh.flush()
    os.fsync(fh.fileno())


def _open_locked():
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    fh = open(STATE_FILE, "a+")
    fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
    return fh


def cmd_claim(agent: str, files: list[str]) -> int:
    if not files:
        print("claim: at least one file required", file=sys.stderr)
        return 2
    with _open_locked() as fh:
        data = _load_and_prune(fh)
        held_by_other = [
            c for c in data["claims"] if c["file"] in files and c["agent"] != agent
        ]
        if held_by_other:
            for c in held_by_other:
                print(
                    f"CONFLICT: {c['file']} held by {c['agent']} since {c['at']}",
                    file=sys.stderr,
                )
            return 1
        existing = {(c["agent"], c["file"]) for c in data["claims"]}
        now = _now()
        for f in files:
            if (agent, f) not in existing:
                data["claims"].append({"agent": agent, "file": f, "at": now})
        _save(fh, data)
        for f in files:
            print(f"CLAIMED {f} for {agent}")
    return 0


def cmd_release(agent: str, files: list[str]) -> int:
    with _open_locked() as fh:
        data = _load_and_prune(fh)
        before = len(data["claims"])
        if files:
            keep = [
                c
                for c in data["claims"]
                if not (c["agent"] == agent and c["file"] in files)
            ]
        else:
            keep = [c for c in data["claims"] if c["agent"] != agent]
        data["claims"] = keep
        _save(fh, data)
        print(f"RELEASED {before - len(keep)} claim(s) for {agent}")
    return 0


def cmd_check(file: str) -> int:
    with _open_locked() as fh:
        data = _load_and_prune(fh)
        _save(fh, data)  # persist any stale-prune
        for c in data["claims"]:
            if c["file"] == file:
                print(f"HELD by {c['agent']} since {c['at']}")
                return 1
    print(f"FREE {file}")
    return 0


def cmd_status() -> int:
    with _open_locked() as fh:
        data = _load_and_prune(fh)
        _save(fh, data)
    claims = data["claims"]
    if not claims:
        print("(no active claims)")
        return 0
    by_agent: dict[str, list[dict[str, Any]]] = {}
    for c in claims:
        by_agent.setdefault(c["agent"], []).append(c)
    for agent in sorted(by_agent):
        print(f"{agent}:")
        for c in sorted(by_agent[agent], key=lambda x: x["file"]):
            age = _dt.datetime.now(_dt.timezone.utc) - _parse_ts(c["at"])
            mins = int(age.total_seconds() // 60)
            print(f"  {c['file']}  ({mins}m ago)")
    return 0


def cmd_message(from_agent: str, to_agent: str, text: str) -> int:
    with _open_locked() as fh:
        data = _load_and_prune(fh)
        data["messages"].append(
            {
                "from": from_agent,
                "to": to_agent,  # "all" or a specific agent id
                "text": text,
                "at": _now(),
                "read_by": [],
            }
        )
        _save(fh, data)
    print(f"MESSAGE sent from {from_agent} to {to_agent}")
    return 0


def cmd_messages(for_agent: str | None) -> int:
    with _open_locked() as fh:
        data = _load_and_prune(fh)
        # If reading for a specific agent, mark matching unread messages as read.
        changed = False
        for m in data["messages"]:
            if for_agent is not None and (m["to"] == "all" or m["to"] == for_agent):
                if for_agent not in m["read_by"]:
                    m["read_by"].append(for_agent)
                    changed = True
        if changed:
            _save(fh, data)
    msgs = data["messages"]
    if for_agent is not None:
        msgs = [m for m in msgs if m["to"] in ("all", for_agent)]
    if not msgs:
        print("(no messages)")
        return 0
    for m in sorted(msgs, key=lambda x: x["at"]):
        age = _dt.datetime.now(_dt.timezone.utc) - _parse_ts(m["at"])
        mins = int(age.total_seconds() // 60)
        target = m["to"] if m["to"] != "all" else "all"
        print(f"[{mins}m ago] {m['from']} → {target}: {m['text']}")
    return 0


def cmd_prune() -> int:
    with _open_locked() as fh:
        raw_before = len(json.loads(fh.read() or '{"claims":[]}').get("claims", []))
        fh.seek(0)
        data = _load_and_prune(fh)
        _save(fh, data)
    dropped = raw_before - len(data["claims"])
    print(f"Pruned {dropped} stale claim(s); {len(data['claims'])} remain")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    if cmd == "claim" and len(argv) >= 4:
        return cmd_claim(argv[2], argv[3:])
    if cmd == "release" and len(argv) >= 3:
        return cmd_release(argv[2], argv[3:])
    if cmd == "check" and len(argv) == 3:
        return cmd_check(argv[2])
    if cmd == "status" and len(argv) == 2:
        return cmd_status()
    if cmd == "prune" and len(argv) == 2:
        return cmd_prune()
    if cmd == "message" and len(argv) >= 5:
        # message FROM TO "body text (remaining args joined)"
        return cmd_message(argv[2], argv[3], " ".join(argv[4:]))
    if cmd == "messages" and len(argv) in (2, 3):
        # messages               → all messages
        # messages <agent-id>    → messages visible to this agent (all + to=agent-id)
        return cmd_messages(argv[2] if len(argv) == 3 else None)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
