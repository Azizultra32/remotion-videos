# Engine

The "engine" is the reusable infrastructure of this repo: render code, editor app, analysis pipeline, build config. Engine code is stable by design — agents and external contributors should treat it as write-locked unless the user explicitly requests a change.

Per-track content goes in `projects/<stem>/`, which is free to write. Per-brand content goes in `brands/<name>/`, same rule.

See [OWNERSHIP.md](./OWNERSHIP.md) for the authoritative path tables and enforcement mechanism.

---

## What lives in the engine and why

### `src/` — Remotion compositions + hooks

The render pipeline. Every composition that Remotion knows how to render lives here. Changes affect every project's render output, so they should be deliberate.

Notable files:
- `src/Root.tsx` — composition registrations
- `src/compositions/MusicVideo.tsx` — the generic dispatcher that powers the editor
- `src/compositions/elements/` — the 16-element library (7 text, 3 audio-reactive, 3 shapes, 3 overlays)
- `src/hooks/useBeats.ts`, `useFFT.ts` — composition-side helpers

### `editor/` — Vite editor app + sidecar

The GUI. Talks to `/api/render`, `/api/chat`, `/api/songs`, `/api/projects/*`, `/api/timeline/*`, `/api/current-project`, `/api/out/*` all implemented in `editor/vite-plugin-sidecar.ts`.

Changes here affect the editing experience but not render output.

### `scripts/` — Analysis pipeline + CLI + render glue

Python (`energy-bands.py`, `plot-pioneer.py`, `slice-pioneer-png.py`) does audio analysis. TypeScript CLIs (`cli/mv-*.ts`) are the headless counterparts of the editor's actions. Shell scripts orchestrate multi-step flows.

Agents can **execute** these scripts freely (`Bash("npm run mv:analyze -- --project X")`); they just can't **modify** them without unlock.

### `docs/` — Documentation including the master prompt

`docs/waveform-analysis-protocol.md` is the canonical waveform-analysis master prompt. `docs/superpowers/specs/` holds design specs. Content here changes the agent protocol that drives analysis, so treat it as engine.

### `.claude/` — Hooks + project-scoped skills

`.claude/settings.json` defines the PreToolUse hook that enforces engine locking. `.claude/skills/` holds project-scoped skill bundles. Modifying these changes how *all* Claude sessions in this repo behave.

### Build + config

`package.json`, `tsconfig.json`, `remotion.config.ts`, `.gitignore`, `.gitattributes`, `editor/package.json`, `editor/vite.config.ts`, `editor/tsconfig.json` — all config files that define how the project compiles, tests, or deploys.

### `public/projects` (managed symlink)

One-file symlink that bridges `staticFile("projects/<stem>/audio.mp3")` to wherever project data actually lives. Remotion's render path resolves `staticFile()` through `public/<path>`, and project audio lives under `MV_PROJECTS_DIR`. The symlink target is:
- `../projects` (relative) when `MV_PROJECTS_DIR` is unset — portable across machines, commitable.
- The absolute resolved path of `MV_PROJECTS_DIR` when set — per-machine, not committed in that form.

The sidecar keeps the symlink in sync on boot via `syncStaticProjectsSymlink()` in `scripts/cli/paths.ts`. Deleting it will break every render until the sidecar restarts and recreates it.

---

## What the engine currently does

Quick capability reference for the engine as it ships on `main`. This section is descriptive of function, not architecture — read "What lives in the engine and why" above for the code layout.

### Event editing on the waveform (Scrubber.tsx)

Phase 2 event markers render as yellow lines on the waveform with amber downward-triangle handles (▼) at the top — the handle signals they are grabbable without requiring hover-discovery. Click-and-drag horizontally to move an event. The line follows the cursor live (via `dragState` local preview) and only releases to its final position once `/api/analyze/events/update` round-trips through SSE. Hold Shift during drag to disable the pipeline-element beat-snap for a free placement.

Click a line (without dragging) selects the corresponding pipeline element so Delete/Backspace routes through the Timeline deletion path. Shift-click on empty waveform area adds a new event at that time.

### Per-event action row (EventCycler.tsx)

Click any `EVT N M:SS` chip to select + seek. An action row opens underneath with:
- Time number input + `SET` button for precise typed edits (Enter commits).
- `← NUDGE` / `NUDGE →` for ±0.05s fine adjustment (~1/10 of an IBI at 130 BPM).
- `Snap to beat` — snap to nearest entry in `beatData.beats`. Inline error if no beat grid.
- `Snap to playhead` — snap event to current `currentTimeSec`.
- `Duplicate` — add a new event 0.1s after this one (past the server-side 0.05s dedupe threshold).
- `Delete` — confirm + remove from `analysis.json`.
- Hint pointing at drag on the waveform as the primary movement path.

Click outside the row deselects. All writes share one `postEvents()` helper → `POST /api/analyze/events/update`.

### Analysis strip (StageStrip.tsx)

Persistent Phase 1 + Phase 2 completion badges. A phase is "done" (blue) when its events exist OR when a subsequent phase has events (phase2 success implies phase1 ran — the pipeline drops phase1 events from the final `analysis.json`). Completed phase without surviving events shows `Phase 1 ✓` instead of `Phase 1 -`.

Live stage chips (`SETUP → PHASE1-REVIEW → PHASE1-ZOOM → PHASE1-CONFIRMED → PHASE2-SLICE → PHASE2-ZOOM → PHASE2-CONFIRMED → DONE`) render only while a run is in flight, with the active chip pulsing. Failed runs show a red `LAST RUN FAILED` chip.

Actions: `Add event at playhead`, `Re-analyze` / `Analyze` (label depends on whether phase2 has ever produced events), `Clear events`. A `Seed beats` button appears alongside a `NO BEAT GRID` chip when `beats.length === 0`.

### SongPicker with upload (SongPicker.tsx)

Dropdown of projects under `MV_PROJECTS_DIR` (or `<engineRoot>/projects/`). `+ New` button opens a hidden file input (`.mp3/.wav/.m4a`); selecting a file streams its bytes to `POST /api/projects/create` with the filename in `X-Audio-Filename`. Server scaffolds the project and spawns `mv:analyze` detached. Editor auto-switches `audioSrc`/`beatsSrc` to the new stem so StageStrip tracks the running analysis.

### Auto-seed beats on load (useAutoSeedBeats.ts)

When a project loads with `beatData.beats.length === 0` and no analysis is in flight, fires `POST /api/analyze/seed-beats` after a 2.5s debounce. Per-stem latch in a ref prevents retry spam. Status probe (`GET /.analyze-status.json`) skips the call if `mv:analyze` is already running (its own Setup seeds beats).

### Chat pane with full Claude Code tool access + live streaming (ChatPane.tsx + useChat + /api/chat/stream)

Natural-language interface backed by a streaming sidecar endpoint. The spawn is `claude -p --output-format stream-json --verbose --permission-mode bypassPermissions` — same tool surface as `mv:analyze` uses (Read/Bash/Glob/Grep/Edit/Write/WebFetch), with each assistant text fragment / tool_use / tool_result emitted as a separate event so the client can render them in real time.

Events emitted by `POST /api/chat/stream` (newline-delimited JSON over the POST response body):
- `{type:"text", delta}` — assistant text fragment; client appends to the active bubble
- `{type:"tool_use", id, name, input}` — tool invocation; client adds a chip
- `{type:"tool_result", tool_use_id, content, is_error}` — corresponding result; client attaches to the matching chip
- `{type:"done", reply, mutations}` — final turn; the `<final>{...}</final>` sentinel is parsed server-side and delivered as a normalized payload
- `{type:"error", code, error, stderr}` — non-zero exit (rate limits surface as `error:"claude-cli-rate-limited"`)

The older non-streaming `POST /api/chat` endpoint is retained as a fallback for headless/CLI callers that want a single JSON response.

Client behavior (ChatPane.tsx + useChat.ts):
- Assistant messages stream in live with a pulsing cursor; tool-call chips appear inline as Claude invokes tools. Each chip shows the tool name + truncated input; click to expand full input + up to 1200 chars of result.
- When a chip is for a `Read` of an image file (`png/jpg/jpeg/gif/webp`) under `projects/`, the expanded view renders an inline `<img>` preview served via `/api/projects/<rel-path>`. Non-image reads stay text-only.
- Conversation memory: the client re-sends the last 8 user/assistant turns (content trimmed to 600 chars each) as a `history` array on every request; the sidecar weaves them into the user prompt so `"now make it bigger"` resolves against the prior turn. No server-side session state.
- Chat history persists to `localStorage` across tab close; explicit `Clear` button wipes it.
- Keyboard: plain `Enter` or `Cmd/Ctrl+Enter` submits; `Shift+Enter` inserts a newline.
- Cancel during a streaming turn aborts the fetch, which closes the HTTP connection, which triggers the sidecar\'s `req.on("close")` handler to SIGTERM the spawned claude child. Partial content already streamed stays visible; the bubble\'s `streaming` flag flips off.

Engine-lock: chat-driven `Edit`/`Write` on engine paths (`src/`, `editor/`, `scripts/`, `docs/`, etc.) is still blocked by the `PreToolUse` hook. The system prompt tells Claude to reply `"requires ENGINE_UNLOCK=1; set ENGINE_UNLOCK=1 in your shell and restart the editor, then re-issue"` in that case rather than attempting a write that would fail the hook.

Mutation extraction is unchanged: Claude ends every turn with `<final>{reply, mutations}</final>`; the sidecar greedily matches the LAST such block and parses JSON. If the sentinel is missing, a fallback brace-match on the full output degrades gracefully. The `applyMutations` dispatcher then applies element + project-lifecycle ops as described above.

Latency: simple mutation turns round-trip in ~9s (up from ~5s of the non-streaming path — the cost of free-form reasoning). Tool-using turns are 20–90s depending on how many tools Claude chains; users see progress throughout via the streaming cursor and filling chip row.

### Chat mutation vocabulary (applyMutations.ts)

Timeline ops: `addElement`, `updateElement`, `removeElement`, `seekTo`, `setPlaying`.

Project lifecycle ops (chat equivalents of the `mv:*` CLIs):
- `scaffold` `{audioPath}` → `POST /api/projects/create-from-path`; auto-switches to the new stem on success.
- `analyze` `{stem?}` → `POST /api/analyze/run`; stem defaults to current audioSrc.
- `seedBeats` `{stem?}` → `POST /api/analyze/seed-beats`.
- `clearEvents` `{stem?}` → `POST /api/analyze/clear`.
- `switchTrack` `{stem}` → `store.setTrack`.

### CLI surface (scripts/cli/)

Run from the engine root. All take `--project <stem>` unless noted:
- `mv:scaffold --audio <path>` — create project from audio file on disk.
- `mv:analyze` — full Setup (energy-bands → detect-beats → plot-pioneer) + Phase 1 + Phase 2 LLM review (~5-10 min). Merges results into `analysis.json` preserving beats + bands.
- `mv:seed-beats` — detect-beats.py only (~45s); merges beats/downbeats/bpm into `analysis.json`.
- `mv:clear-events` — wipe phase1/phase2 event arrays while preserving beats, downbeats, energy_bands, and on-disk PNG artifacts. Refuses while an analyze run is in flight.
- `mv:switch` — write stem to `.current-project` (validates stem exists). Bridges editor state to external CLI sessions.
- `mv:current` — read `.current-project`.
- `mv:render` — render MP4 from `timeline.json` + audio.

Every chat project-lifecycle op has a CLI equivalent and vice versa; parity is intentional.

### Analysis pipeline (mv:analyze flow)

1. `energy-bands.py` → `analysis/source.json` (spectral bands, duration, sample rate).
2. `detect-beats.py` → `analysis/beats.json` (beats, downbeats, bpm_global, tempo_curve).
3. `plot-pioneer.py` → `analysis/full.png` (Pioneer-style waveform for LLM review).
4. After Setup, `mv-analyze.ts` seeds `projects/<stem>/analysis.json` with beats + bands. `--setup-only` exits here.
5. `claude -p --permission-mode bypassPermissions` drives the multi-agent Phase 1 + Phase 2 protocol (see `docs/waveform-analysis-protocol.md`), producing `phase1-events.json` and `phase2-events.json`.
6. On successful close, mv-analyze.ts merges `phase2-events.json` into `analysis.json` (read-merge-write, not copy) so beats + bands persist.

Pipeline-origin elements in `timeline.json` are derived from `phase2_events_sec` with `startSec = snapToNearestBeat(eventSec - 1, beats)` — they sit on the actual tempo grid when one exists, degrading to raw `eventSec - 1` when it doesn't.

### Sidecar endpoints (editor/vite-plugin-sidecar.ts)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/songs` | GET | list projects with audio/analysis/timeline presence flags |
| `/api/projects/<stem>/<path>` | GET | stream any file inside a project (audio Range-aware, PNGs, JSON) |
| `/api/timeline/<stem>` | GET | read `timeline.json` |
| `/api/timeline/save` | POST | atomic write of `timeline.json` (tmp + rename, per-stem serialized) |
| `/api/timeline/watch/<stem>` | GET (SSE) | push on external `timeline.json` changes |
| `/api/analyze/events/<stem>` | GET (SSE) | push full `analysis.json` contents on change (beats + events) |
| `/api/analyze/status/<stem>` | GET (SSE) | push `.analyze-status.json` contents on change (live phase) |
| `/api/analyze/run` | POST | spawn `mv:analyze` detached; pre-clears phase event arrays |
| `/api/analyze/seed-beats` | POST | spawn `mv:seed-beats` detached |
| `/api/analyze/clear` | POST | wipe phase event arrays; refuses if run in flight |
| `/api/analyze/events/update` | POST | write a full events array (dedupe + sort server-side) |
| `/api/projects/create` | POST (raw bytes) | byte-upload audio, scaffold, auto-analyze |
| `/api/projects/create-from-path` | POST (JSON) | path-based scaffold + analyze; chat uses this |
| `/api/current-project` | GET / POST | read/write active stem marker |
| `/api/chat` | POST | Claude Code subagent with full tools; returns `{reply, mutations}` |
| `/api/render` | POST (SSE) | spawn `npx remotion render`, stream `log`/`progress`/`done` events |
| `/api/out/<file>` | GET | stream a rendered MP4 out of `out/` |

### Coordination + safety

- `PreToolUse` hook in `.claude/settings.json` auto-claims files via `scripts/agents-claim-hook.py` on Write/Edit, so parallel Claude sessions don't collide.
- `scripts/check-ownership.sh` enforces engine-lock: writes to `src/**`, `editor/**`, `scripts/**`, `docs/**`, `.claude/**`, `package.json`, `ENGINE.md`, `OWNERSHIP.md`, etc. require `ENGINE_UNLOCK=1` in the shell env.
- Atomic writes (tmp + rename) on every critical file: `timeline.json`, `analysis.json`, `.analyze-status.json`, `.current-project`.
- `projects/**/.claude/` and `.claude/scheduled_tasks.lock` are gitignored to absorb subagent leakage.

---

## What is NOT the engine

### `projects/<stem>/` (gitignored — per-user creative output)

Per-track everything: the audio file, the analysis output, the timeline state, the notes. This tree is gitignored in the engine repo — it's user creative output, not engine infrastructure. Agents edit freely based on the user's requests; commits that add to `projects/<stem>/` get filtered out by `.gitignore`.

Projects live at `MV_PROJECTS_DIR` if the env var is set, else `<engineRoot>/projects/`. The sidecar and CLI both consult `scripts/cli/paths.ts` — that module is the single source of truth for the resolver.

### `projects/_plans/` (TRACKED — shared engine history)

Exception to the above. Design docs and implementation plans that document the engine's evolution live here and ARE tracked. Allow-listed via `!projects/_plans/` in `.gitignore`.

### `brands/<name>/`

Per-client brand workspaces: logos, colors, typography, photos. Consumed by `BrandedDemo`, `LogoReveal`, `AdCreative` compositions. Tracked.

### `out/`, `.current-project`, `.analyze-status.json`, transient caches

Renders land in `out/` (gitignored). `.current-project` is a one-line marker written by the editor. `.analyze-status.json` is the per-run status file the sidecar SSE reads. Build caches and venvs are gitignored.

---

## How to change the engine

1. The user says "change X in the engine" (not just "change X"; agents should confirm).
2. The user unlocks: `ENGINE_UNLOCK=1` in the shell env.
3. Agent makes the change.
4. Commit with a message that explains the engine-level impact.
5. After commit, user re-locks by closing the shell or unsetting the var.

Step 5 matters: leaving the var set in a long-lived shell means the next agent invocation inherits unlock — easy to forget.
