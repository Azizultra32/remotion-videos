#!/usr/bin/env bash
# scripts/check-ownership.sh
#
# PreToolUse hook wrapper: blocks Write/Edit to engine paths unless the
# user has unlocked via ENGINE_UNLOCK=1 in their shell env.
#
# Hook input is JSON on stdin, e.g.
#   {"tool_name":"Edit","tool_input":{"file_path":"/abs/path/to/file"}, ...}
#
# Exit codes (per Claude Code hook spec):
#   0  — allow the tool call
#   2  — BLOCK the tool call, stderr is shown to the agent
#   (other non-zero) — non-blocking error, tool proceeds
#
# Behaviour is gated by ENGINE_LOCK_ENFORCE:
#   unset / not "1"  → log-only (exits 0, prints WOULD-BLOCK to stderr)
#   "1"              → enforce (exits 2 on violation)
#
# Phase J wires the hook in log-only mode (ENGINE_LOCK_ENFORCE unset).
# Phase L will flip ENGINE_LOCK_ENFORCE=1 in .claude/settings.json.
set -euo pipefail

# Use python3 for reliable JSON parsing — avoids jq dependency on fresh machines.
path=$(python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get("tool_input", {}).get("file_path", ""))
except Exception:
    pass
')

# If no file_path (e.g. tool has a different input shape), allow through.
if [ -z "$path" ]; then
    exit 0
fi

# Normalize to absolute path for pattern matching.
case "$path" in
    /*) abs="$path" ;;
    *)  abs="$PWD/$path" ;;
esac

# Resolve the repo root; bail allow if we're not inside a git repo.
repo=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$repo" ]; then
    exit 0
fi

# Compute the path relative to repo root. If it doesn't live under the repo,
# allow through (writing outside the repo is an unrelated concern).
case "$abs" in
    "$repo"/*) rel="${abs#"$repo"/}" ;;
    "$repo")   exit 0 ;;
    *)         exit 0 ;;
esac

# Engine path matchers. Keep in sync with OWNERSHIP.md.
is_engine=false
case "$rel" in
    src/*|editor/*|scripts/*|docs/*|public/fonts/*|public/tokens/*|.claude/*)
        is_engine=true ;;
    package.json|package-lock.json|tsconfig.json|remotion.config.ts|.gitignore|.gitattributes|CLAUDE.md|ENGINE.md|OWNERSHIP.md|README.md)
        is_engine=true ;;
    # Project paths (must be checked explicitly as "allow" so the engine
    # match above doesn't sweep them in by accident).
    projects/*|brands/*|out/*|.current-project)
        is_engine=false ;;
esac

if [ "$is_engine" = "false" ]; then
    exit 0
fi

# Engine write attempted. Is the user's env unlocked?
if [ "${ENGINE_UNLOCK:-0}" = "1" ]; then
    exit 0
fi

# Engine path + no unlock. Decide based on enforcement mode.
msg="[engine-lock] blocked write to engine path: $rel"
msg="$msg\n  To unlock, start Claude Code with ENGINE_UNLOCK=1 in your shell env:"
msg="$msg\n    ENGINE_UNLOCK=1 claude"
msg="$msg\n  Or export it in the current terminal:"
msg="$msg\n    export ENGINE_UNLOCK=1"
msg="$msg\n  See OWNERSHIP.md for the full path list."

if [ "${ENGINE_LOCK_ENFORCE:-0}" = "1" ]; then
    printf '%b\n' "$msg" >&2
    exit 2
else
    printf '[engine-lock] (log-only) WOULD-BLOCK engine write: %s\n' "$rel" >&2
    printf '  set ENGINE_LOCK_ENFORCE=1 in settings.json to enforce\n' >&2
    exit 0
fi
