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

### `public/projects` (symlink)

This is a one-file symlink pointing at `../projects`. It exists because Remotion's render path uses `staticFile()` which resolves to `public/<path>`, and our audio lives in `projects/<stem>/audio.mp3`. The symlink bridges those two worlds. Deleting it will break every render.

---

## What is NOT the engine

### `projects/<stem>/`

Per-track everything: the audio file, the analysis output, the timeline state, the notes. Agents should edit these freely based on the user's requests.

### `brands/<name>/`

Per-client brand workspaces: logos, colors, typography, photos. Consumed by `BrandedDemo`, `LogoReveal`, `AdCreative` compositions. Already correctly scoped.

### `out/`, `.current-project`, transient caches

Renders land in `out/` (gitignored). `.current-project` is a one-line marker written by the editor. Build caches and venvs are gitignored.

---

## How to change the engine

1. The user says "change X in the engine" (not just "change X"; agents should confirm).
2. The user unlocks: `ENGINE_UNLOCK=1` in the shell env.
3. Agent makes the change.
4. Commit with a message that explains the engine-level impact.
5. After commit, user re-locks by closing the shell or unsetting the var.

Step 5 matters: leaving the var set in a long-lived shell means the next agent invocation inherits unlock — easy to forget.
