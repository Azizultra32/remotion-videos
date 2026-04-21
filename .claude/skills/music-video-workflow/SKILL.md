---
name: music-video-workflow
description: Use this skill when the user wants to edit, render, scaffold, or otherwise operate on a music-video track in this repo. Covers the editor GUI, the mv:* CLI commands, the timeline.json file format, and where per-project content lives under projects/<stem>/.
---

> **Path note:** Everywhere this doc says `projects/<stem>/`, the actual path on disk is `<MV_PROJECTS_DIR>/<stem>/` if the env var is set, else `<engineRoot>/projects/<stem>/`. The sidecar, editor, and every mv:* CLI share the resolver in `scripts/cli/paths.ts`. The engine repo gitignores `projects/<stem>/` — per-track data lives wherever the user chooses.

# Music Video Workflow

## When to use

Invoke this skill on user intents like:
- "edit the love-in-traffic track"
- "add a spectrum bar to the current project"
- "render this"
- "switch to rush-comes"
- "scaffold a new track from /path/to/song.mp3"

Do NOT invoke for audio analysis / event detection — that's the `analyze-music` skill.

## Repo layout (critical)

```
projects/<stem>/
  audio.mp3          ← the track (git-LFS tracked)
  analysis.json      ← event timestamps (Phase 1/2 output; editor reads this)
  timeline.json      ← editor state: elements, fps, compositionDuration
  notes.md           ← free-form cut notes
  analysis/          ← pipeline diagnostic artifacts (PNGs, source.json)
```

**Write-free zones** (NO `ENGINE_UNLOCK=1` needed — just write):
- `projects/<stem>/**` — everything under any project, including `custom-elements/*.tsx`, `timeline.json`, `notes.md`, `analysis.json`
- `brands/**` — brand-config.json, logos, photos
- `src/compositions/**` — composition + element authoring library (adding a new element module is NOT engine work)
- `out/**`, `.current-project` — gitignored artifacts

**Write-locked engine paths** (require `ENGINE_UNLOCK=1`):
`src/hooks/**`, `src/lib/**`, `src/utils/**`, `src/components/**`, `src/Root.tsx`, `editor/**`, `scripts/**`, `public/fonts/**`, `.claude/**`, `docs/**`, `package.json`, `tsconfig.json`, `CLAUDE.md`, `OWNERSHIP.md`, `ENGINE.md`.

**Before invoking the ENGINE_UNLOCK ceremony, check the path first.** If the target is under `projects/<stem>/`, `src/compositions/`, `brands/`, or `out/` → just write. No stop, no ask, no unlock. Only if the path is truly engine infrastructure should you STOP and reply: *"this requires `ENGINE_UNLOCK=1` in your shell env before I can proceed"*.

**Common bug to avoid:** a subagent dispatched to render, verify, or iterate on per-project creative work (`projects/<stem>/custom-elements/*.tsx`, `projects/<stem>/timeline.json`, out-of-tree stills, etc.) starts grepping for `ENGINE_UNLOCK` or reciting the unlock ceremony. That's the reflex firing on the wrong paths. Every file in the per-project custom-element flow is free-write — kill the subagent and do the work inline.

## Finding the active project

Before editing anything, discover which project the user is working on:

```bash
npm run --silent mv:current
```

Prints the active stem (e.g. `love-in-traffic`). Exits 1 if no project is active — in that case, ask the user or list `projects/` to choose.

If the editor is running, it writes `.current-project` whenever the SongPicker dropdown changes; `mv:current` reads that file.

## Editing a timeline

Three ways to modify `projects/<stem>/timeline.json`:

1. **Via the editor GUI** (if running) — use the `Sidebar` (drag elements), the `ChatPane` ("add a bell curve at 63.5s"), or the detail panel. Autosave writes to disk within 500 ms.
2. **Via the sidecar API** (if editor running) — `POST /api/timeline/save` with `{ stem, timeline }`. Serializes with GUI autosave. Preferred when the editor is up and you want changes reflected live.
3. **Direct file edit** (editor not running) — just `Edit` the JSON. Schema:

```json
{
  "version": 1,
  "stem": "love-in-traffic",
  "fps": 24,
  "compositionDuration": 300,
  "elements": [
    { "id": "el-abc123", "type": "text.bellCurve",
      "trackIndex": 0, "startSec": 63.5, "durationSec": 4,
      "label": "RUSH", "props": { "text": "RUSH", "sigmaSec": 1.0 } }
  ]
}
```

Element `type` must be one of (a) a built-in registered in `src/compositions/elements/registry.ts` OR (b) a per-project custom element at `projects/<stem>/custom-elements/<Name>.tsx` — the barrel generator (for `mv:render`) and the editor's Vite plugin (for live preview) both merge per-project modules into the registry. Unknown types (neither built-in nor per-project) are rejected by `applyMutations` and will crash the render. Adding a new custom element does NOT require `ENGINE_UNLOCK=1`.

## Rendering

```bash
npm run mv:render -- --project <stem>
```

Produces `out/<stem>-<timestamp>.mp4`. Same engine as the editor's Render button. Identical output for identical timeline+audio.

Options:
- `--out out/my-cut.mp4` — custom output path
- `--fps 30` — override timeline fps

## Scaffolding a new track

```bash
npm run mv:scaffold -- --audio /absolute/path/to/track.mp3
npm run mv:scaffold -- --audio ./incoming.mp3 --stem custom-name
```

Creates `projects/<stem>/` with audio copied in + empty timeline. Git-LFS picks up the audio on next `git add`. Follow-up: `npm run mv:analyze -- --project <stem>` to fill in events.

## Common workflows

### "Add a big RUSH text at the first drop"

1. `stem=$(npm run --silent mv:current)` — find active project
2. Read `projects/$stem/analysis.json` — find `phase2_events_sec[0]` (first event)
3. Read `projects/$stem/timeline.json` — get current elements
4. Append a `text.bellCurve` element at `startSec: events[0]` with `text: "RUSH"`
5. Write `timeline.json` back
6. Editor picks up the change via its file watcher; preview updates

### "Render the current track"

1. `stem=$(npm run --silent mv:current)`
2. `npm run mv:render -- --project $stem`
3. Report the output path when render finishes

### "Switch the track"

Ask the user to pick in the SongPicker dropdown (it updates `.current-project` and reloads `timeline.json`). Don't try to set `.current-project` directly from an agent — the editor's state won't match.

## What NOT to do

- Don't write to engine paths — see OWNERSHIP.md.
- Don't re-encode audio when modifying a project; keep `audio.mp3` as-is.
- Don't invent element `type` strings — they must exist in `src/compositions/elements/registry.ts` OR as a default-exported `ElementModule` at `projects/<stem>/custom-elements/<Name>.tsx` (free-write, no `ENGINE_UNLOCK`).
- Don't commit `.current-project` (gitignored by design).
- Don't manually move files between `projects/<stem>/` and the old `public/*` paths; the migration is complete.
