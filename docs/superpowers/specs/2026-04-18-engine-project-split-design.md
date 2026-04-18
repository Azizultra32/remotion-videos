# Engine / Project Split + Lock — Design

**Status:** approved in session 2026-04-17/18, execution starting now.
**Scope:** reorganize the repo so the engine (reusable render + editor code) is cleanly separated from per-project content (audio, analysis, timeline state), enforce that separation at the tool-call level, and give fresh Claude Code sessions a deterministic entry point into the music-video workflow.

---

## Problem

The repo currently mixes three concerns in the same folders:

- **Engine code** (`src/`, `editor/`, `scripts/`) — reusable infrastructure that should be stable
- **Per-track analysis data** (`public/*-beats.json`, `public/*-energy-24fps.json`, `public/waveform-phase1/*`) — one-track-specific, scattered
- **Source audio** (`public/*.mp3`, `public/*.wav`) — gitignored, not reproducible from a fresh clone

Consequences observed this session:

- Agents edit engine files by accident (no enforcement boundary)
- Track-specific content is scattered across `public/` with no per-track grouping
- Audio isn't in git at all — a fresh clone can't render
- Timeline state (the user's edit work) lives in browser localStorage only, lost on tab close or device switch, invisible to CLI or other Claude sessions
- Two terminals stepped on each other around `public/*.json` and `scripts/*.py` because there was no ownership contract

## Goals

1. **One track = one folder under `projects/<stem>/`** containing everything about that track: audio, analysis output, timeline state, notes.
2. **Engine paths are physically write-protected** against agents unless explicitly unlocked by the user.
3. **Source audio is in git** via git-LFS, so a fresh clone + LFS pull = operational.
4. **Timeline state is on disk, in git, per project** — not in localStorage. Editable from the GUI, from Claude Code, from a CLI, all three keeping a single source of truth.
5. **Fresh Claude Code sessions have a documented, skill-backed entry point** so there's no rediscovery tax per session.
6. **The lock engages last** — everything must work before enforcement turns on.

## Non-goals

- Segment-within-a-project breakdown (e.g., 2-hour dubfire mix broken into sections). Not needed for current tracks; can be added later without restructuring.
- Team collaboration (multiple humans on the repo). Single-user plus their Claude Code sessions only.
- GitHub branch protection / CODEOWNERS / CI gates. Local hooks sufficient.
- MCP server. CLI + skills + sidecar HTTP are the three surfaces; no additional daemon.

---

## Final directory layout

```
remotion-videos/
│
├── ENGINE  (write-locked after Phase L; read + execute always allowed)
│   ├── src/                      Remotion compositions + hooks
│   ├── editor/                   Vite editor app + vite-plugin-sidecar
│   ├── scripts/                  Render glue + analysis pipeline + CLI commands
│   │   ├── energy-bands.py       audio analysis (Python)
│   │   ├── plot-pioneer.py       waveform PNG renderer
│   │   ├── slice-pioneer-png.py  phase-2 segment cropper
│   │   ├── cli/
│   │   │   ├── mv-render.ts
│   │   │   ├── mv-scaffold.ts
│   │   │   ├── mv-current.sh
│   │   │   └── mv-analyze.ts
│   │   └── check-ownership.sh    used by PreToolUse hook
│   ├── public/fonts/             engine-level assets
│   ├── public/tokens/            design tokens (if any)
│   ├── .claude/                  hooks + project-scoped skills
│   │   ├── settings.json         PreToolUse runs check-ownership.sh + agents-claim-hook.py
│   │   └── skills/
│   │       ├── music-video-workflow.skill.md
│   │       └── analyze-music.skill.md
│   ├── docs/                     documentation (including master prompt)
│   │   └── waveform-analysis-protocol.md    master prompt for mv:analyze
│   ├── package.json, tsconfig.json, .gitignore, .gitattributes
│   └── CLAUDE.md, ENGINE.md, OWNERSHIP.md, README.md
│
├── projects/  (unlocked — agents free to write)
│   ├── love-in-traffic/
│   │   ├── audio.mp3             via git-LFS
│   │   ├── analysis.json         canonical event list — what Scrubber + composition read
│   │   ├── timeline.json         editor state: {version, fps, compositionDuration, elements[]}
│   │   ├── notes.md              cut decisions, vocabulary (zeta points, bell curves…)
│   │   └── analysis/             pipeline artifacts (PNGs, manifest, raw source.json)
│   │       ├── source.json       energy bands from energy-bands.py (bulk data)
│   │       ├── full.png          unmarked mirrored waveform
│   │       ├── phase1-confirmed-full.png
│   │       ├── phase2-confirmed-full.png
│   │       ├── phase2-manifest.json
│   │       ├── phase1-zoom-NN.png  (Phase 1 candidates; variable count)
│   │       ├── phase2-segment-NN.png  (phase-2 slices between Phase 1 lines)
│   │       └── phase2-segment-NN-zoom-MM.png  (per-segment zooms; up to 4 per segment)
│   ├── as-the-rush-comes/  (same shape — already has clean analysis output from this session)
│   └── dubfire-sake/       (same shape — analysis artifacts likely legacy/partial)
│
├── brands/                       unchanged — per-client brand workspaces
├── out/                          gitignored — rendered MP4s land here
└── .current-project              gitignored — one-line file; editor writes it, CLI reads it
```

## Write-access matrix

| Path | Agent writes | Requires unlock | Read + execute always OK |
|---|---|---|---|
| `src/`, `editor/`, `scripts/`, `public/fonts/`, `public/tokens/`, `.claude/`, `docs/`, `package.json`, `tsconfig.json`, `CLAUDE.md`, `ENGINE.md`, `OWNERSHIP.md`, `.gitignore`, `.gitattributes` | ❌ blocked | ✅ `ENGINE_UNLOCK=1` in shell env | ✅ |
| `projects/`, `brands/`, `out/`, `.current-project` | ✅ free | — | ✅ |
| `node_modules/`, `.venv-allin1/`, `editor/dist/`, `.DS_Store`, `estimations/`, `scripts/__pycache__/` | gitignored | — | — |

**Enforcement mechanism:** `.claude/settings.json` `PreToolUse` hook runs `scripts/check-ownership.sh <path>` before any `Write`/`Edit`. Script exits non-zero when the path matches engine paths and `ENGINE_UNLOCK=1` is absent. The hook's subprocess inherits env from the Claude Code process, which inherits from the user's shell — agents cannot self-unlock by prefixing their own Bash invocations because hooks run in separately spawned subprocesses that don't see the Bash tool's env.

---

## Data flow model

All edits land in `projects/<stem>/timeline.json` regardless of entry point:

```
GUI drag ──┐
ChatPane ──┼─► editor Zustand store ──► POST /api/timeline/save ──► projects/<stem>/timeline.json
Claude CLI ─┘          ▲                                                       │
                       │                                                       ▼
                       └───────── file watcher notifies editor ◄───────────────┘
                                    (external edit → re-hydrate store)
                                    
                 (preview always reflects the store; store reflects the file)
```

**Save model:**
- **Autosave** — 500 ms debounce after any element mutation, flush on significant events (element added/removed, project switched, 30 s idle)
- **Manual ⌘S** — flush pending debounce immediately
- **Git commit** — user-initiated, captures meaningful checkpoints; working tree being dirty between commits is expected

**Undo model:**
- **UI undo** (⌘Z / ⌘⇧Z) — store history stack, 50 levels, covers any mutation regardless of entry point
- **Chat-turn undo** — already shipped; reverts the last assistant mutation batch as one unit
- **Git revert** — long-term recovery via `git log projects/<stem>/timeline.json`

**Race condition handling:**
- All writes when editor is running go through `POST /api/timeline/save` (serialization point in sidecar)
- External edits (Claude Code editing `timeline.json` directly) detected via file watcher → re-hydrate store
- No LWW (last-write-wins) clobbers between GUI autosave and external edits

---

## Sidecar endpoints (added/modified)

| Method + Path | Purpose |
|---|---|
| `GET /api/songs` | Scans `projects/*/` (not `public/`), returns `[{stem, hasAudio, hasAnalysis, hasTimeline, sizeBytes}]` |
| `GET /api/projects/:stem/:file` | Streams `projects/<stem>/<file>` with path-traversal guard; used for `audio.mp3`, `analysis.json`, `timeline.json`, and `analysis/<file>` via `:file="analysis/NAME"` |
| `POST /api/timeline/save` | Body `{stem, timeline}` → writes `projects/<stem>/timeline.json`; in-process lock serializes concurrent writers |
| `GET /api/timeline/:stem` | Returns current `projects/<stem>/timeline.json` contents (or 404 if absent) |
| `GET /api/timeline/watch/:stem` (SSE) | Streams `change` events when the timeline file is modified externally |
| `GET /api/out/:file` | Unchanged — streams rendered MP4 from `out/` |
| `POST /api/render` | Unchanged — spawns `npx remotion render` (input JSON already comes from the store, so it works with the new layout without modification) |
| `POST /api/chat` | Unchanged — sidecar-side claude CLI invocation |

---

## CLI commands (new, under `scripts/cli/`)

```bash
npm run mv:render    -- --project <stem> [--out out/custom-name.mp4]
npm run mv:scaffold  -- --audio /abs/path/to/new-track.mp3 [--stem custom-stem]
npm run mv:current                                               # echoes .current-project
npm run mv:analyze   -- --project <stem>                         # runs master prompt
```

- `mv:render` reads `projects/<stem>/timeline.json` + `audio.mp3`, hands props to `npx remotion render`. Same output as clicking Render button in editor — one engine, two drivers.
- `mv:scaffold` copies audio into `projects/<stem>/audio.mp3` (via git-LFS), creates empty `timeline.json` + stub `notes.md`.
- `mv:current` prints the active project stem from `.current-project`; agents run this before editing.
- `mv:analyze` reads `docs/waveform-analysis-protocol.md` (master prompt), substitutes `AUDIO_PATH`, `AUDIO_STEM`, `OUT_DIR`, invokes `claude -p` with tool access, writes artifacts under `projects/<stem>/analysis/`.

---

## Git-LFS configuration

`.gitattributes` (new):
```
projects/**/*.mp3 filter=lfs diff=lfs merge=lfs -text
projects/**/*.wav filter=lfs diff=lfs merge=lfs -text
*.mp3             filter=lfs diff=lfs merge=lfs -text
*.wav             filter=lfs diff=lfs merge=lfs -text
```

Current MP3 total: 140 MB (love-in-traffic 9.4 MB + dubfire-sake-audio 122 MB + as-the-rush-comes 8.3 MB). Free tier = 1 GB storage + 1 GB bandwidth/month — comfortably enough for ~6 more full-length tracks before paid ($5/mo for 50 GB) kicks in.

`.gitignore` removes `public/*.mp3` / `public/*.wav` lines (those paths are dead after migration).

---

## Fresh-session entry point

A Claude Code session arriving in this repo must be able to drive the workflow within 30 seconds. Load-order:

1. **`CLAUDE.md`** — always read on session start (project instructions). Documents the new paths, CLI commands, and engine-lock rule.
2. **`OWNERSHIP.md`** — referenced by CLAUDE.md. Concise table of write permissions.
3. **`.claude/skills/music-video-workflow.skill.md`** — invoked on user intents like "edit this track", "add a spectrum bar", "render". Contains workflow steps, file paths, CLI references.
4. **`.claude/skills/analyze-music.skill.md`** — invoked on user intents like "find the drops", "analyze this track". Calls `mv:analyze` and handles outputs.
5. **`.current-project`** — run `npm run mv:current` (or `cat .current-project`) to find active project. Agent then operates in `projects/<stem>/`.

---

## Migration sequencing (12 phases, one commit per phase)

| Phase | What |
|---|---|
| A | Commit other terminal's work (new scripts, new docs, modified love-in-traffic beats JSON) as a clean baseline |
| B | `git lfs install`; add `.gitattributes` for MP3/WAV; remove `public/*.mp3`/`*.wav` from `.gitignore` |
| C | Create `projects/<stem>/`; `git mv` or `cp`+`git add` audio + analysis files into new structure |
| D | Update sidecar endpoints (`/api/songs` scans `projects/`, new `/api/projects/:stem/:file`, `/api/timeline/*`) |
| E | Editor reads from new paths: `useBeatData`, SongPicker, Preview, Scrubber, MusicVideo composition |
| F | Timeline autosave subscriber + `.current-project` write on SongPicker change + disk-hydrate on boot |
| G | UI undo (⌘Z / ⌘⇧Z) via store history stack |
| H | CLI commands (`mv:render`, `mv:scaffold`, `mv:current`, `mv:analyze`) |
| I | Skills, `OWNERSHIP.md`, `ENGINE.md`, `CLAUDE.md` updates |
| J | `check-ownership.sh` + PreToolUse hook wired but **disabled** (returns 0) |
| K | End-to-end test — kill stale dev servers, start fresh, verify every path |
| L | **Engage the lock** — flip check-ownership.sh to enforce; commit + push |

Each phase is a single commit for revertability. Lock engages at the very end.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Large audio files hit GitHub's 100 MB hard limit on push | `.gitattributes` tracks `*.mp3`/`*.wav` via LFS BEFORE any `git add` — never goes through regular git |
| Browser tab pointed at old URLs 404s after migration | User hard-refreshes after Phase E; no permanent state in tabs |
| Race between editor autosave and Claude Code Edit on `timeline.json` | All writes through sidecar POST endpoint when editor running; file watcher detects external edits and re-hydrates |
| Agents can't self-unlock engine | `ENGINE_UNLOCK=1` is shell env; hooks run in parent-spawned subprocesses; agents' Bash-tool env doesn't leak into hook subprocess |
| Other terminal's pipeline still runs and writes to old paths | Pipeline writes to `OUT_DIR` parameter; `mv:analyze` sets it to `projects/<stem>/analysis/`. Legacy `public/` paths untouched; if someone runs the script manually with old args, fine, but the CLI route is deterministic |
| Lock engages prematurely and blocks legitimate work | Phase J wires the hook but returns 0. Phase L flips it. Enables testing of the hook pipeline in isolation |
| Merge conflicts between concurrent Claude sessions | `agents.py` claim/release hook continues to run (pre-existing); adds file-level serialization on top of everything else |

---

## Acceptance criteria

Before Phase L engages the lock, the following must all pass:

1. `npm run dev` in `editor/` starts cleanly; no 404s in the network tab
2. SongPicker lists 3 projects from `projects/*/`; switching works
3. Each project's audio plays; Scrubber shows event markers (legacy and new-schema analysis both render)
4. Render button produces an MP4 that opens via click-to-open
5. `npm run mv:render -- --project love-in-traffic` produces equivalent MP4 from CLI
6. `npm run mv:scaffold -- --audio /path/to/track.mp3` creates `projects/<stem>/` and picks up in SongPicker after reload
7. `npm run mv:analyze -- --project as-the-rush-comes` runs the master prompt end-to-end and produces `projects/as-the-rush-comes/analysis/*` artifacts matching the Filenames convention
8. Drag an element in GUI → `projects/<stem>/timeline.json` changes on disk within 1 s
9. Edit `projects/<stem>/timeline.json` via `Edit` tool → editor preview updates within 1 s
10. `npm run mv:current` prints the correct active stem after clicking a different track
11. ⌘Z in editor undoes the last element mutation; ⌘⇧Z redoes
12. `tsc --noEmit` clean on editor and root
13. With hook in Phase-J "return 0" mode: attempt a Write to `src/compositions/MusicVideo.tsx` succeeds (hook doesn't block)
14. With hook in Phase-L "enforce" mode: same Write is blocked; `ENGINE_UNLOCK=1` in shell env allows it through
