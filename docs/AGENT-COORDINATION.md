# Agent Coordination

A lightweight protocol for running two (or more) Claude Code / coding-agent
terminals on this repo in parallel without stepping on each other's edits.

## The problem

Claude Code doesn't have built-in real-time messaging between independent
terminal sessions. Two terminals editing the same repo will happily race on
the same files, push conflicting commits, or undo each other's in-flight work.
We hit this hard during the editor + enhancements rollout.

Anthropic's experimental **Agent Teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
adds asynchronous mailboxes between teammates. It works, but it's flag-gated
and adds a layer. When you just want two agents on one laptop to not clobber
each other, a tiny filesystem claim board is enough.

## The protocol

Each terminal picks an **agent id** (e.g. `terminal-A`, `editor-work`,
`$(whoami)-$$`) and claims the files it plans to edit **before** editing them.
Claims live in `.agents-active.json` (gitignored) and are guarded by `fcntl`
file locks, so claim/release/check are atomic.

All state is local to the machine. No daemon, no broker, no network.

## CLI

```bash
# Claim files before editing
scripts/agents.py claim terminal-A editor/src/App.tsx editor/src/store.ts

# See the full board
scripts/agents.py status

# Non-blocking check (exits 0 if free, 1 if held)
scripts/agents.py check editor/src/App.tsx

# Release when done (omit file list to release everything for this agent)
scripts/agents.py release terminal-A

# Manually drop claims older than AGENTS_STALE_HOURS (default 2h)
scripts/agents.py prune
```

## Typical workflow (two terminals)

Terminal A:

```bash
scripts/agents.py claim A editor/src/components/Preview.tsx
# ... do work ...
git add editor/src/components/Preview.tsx && git commit && git push
scripts/agents.py release A
```

Terminal B (before starting):

```bash
scripts/agents.py status            # see what A is on
scripts/agents.py check editor/src/components/Preview.tsx   # exit 1 → skip
scripts/agents.py claim B editor/src/components/ElementDetail.tsx
# ... do work ...
scripts/agents.py release B
```

## Conflict behavior

`claim` fails (exit 1) if **any** of the requested files is already held by a
different agent. It prints who holds it and since when, then leaves the board
untouched. The caller can back off, pick different files, or wait.

Claims by the **same** agent are idempotent — re-claiming a file you already
hold is a no-op.

## Stale claims

If an agent crashes without releasing, its claims auto-expire after
`AGENTS_STALE_HOURS` (default 2). `status`, `check`, and `prune` all evaluate
freshness; `claim` ignores stale entries when deciding conflicts.

Override with:

```bash
AGENTS_STALE_HOURS=0.25 scripts/agents.py status     # 15-minute TTL
```

## When this is not enough

- **Need push notifications between agents** — move to Anthropic Agent Teams
  (experimental) or a local NATS / Redis Streams sidecar exposed as an MCP
  tool. See the research notes in chat history.
- **Coordinating >3 agents** — a real pub/sub bus (NATS on localhost) starts
  to pay for itself.
- **Cross-machine** — file locks don't work over NFS; use NATS or Redis.
- **You want the receiver to wake up instantly** — LLMs don't receive pushes;
  they poll tool output. Any "real-time" ceiling is a tool-cycle (~seconds)
  even with the fastest transport.

## Why not just use git branches?

Branches help with *committed* work but do nothing for uncommitted edits on
the same worktree. Worktrees (`git worktree add`) are the heavier alternative
— use those when you need true filesystem isolation (see
`superpowers:using-git-worktrees`). The claim board is for when both agents
want to stay on the same worktree.
