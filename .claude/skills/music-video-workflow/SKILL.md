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

**Agents write freely** to `projects/<stem>/`. Engine paths (`src/`, `editor/`, `scripts/`, `public/fonts/`, `.claude/`, `docs/`, `package.json`, `tsconfig.json`, `CLAUDE.md`, `OWNERSHIP.md`, `ENGINE.md`) are **write-locked**. If you need to change engine code, STOP and tell the user: *"this requires `ENGINE_UNLOCK=1` in your shell env before I can proceed"*.

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

Element `type` must be one of the 16 registered in `src/compositions/elements/registry.ts`. Unknown types are rejected by the chat layer's `applyMutations` and will crash the render.

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
- Don't invent element `type` strings — they must exist in `src/compositions/elements/registry.ts`.
- Don't commit `.current-project` (gitignored by design).
- Don't manually move files between `projects/<stem>/` and the old `public/*` paths; the migration is complete.
