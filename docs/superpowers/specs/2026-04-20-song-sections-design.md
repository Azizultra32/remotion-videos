# Song Sections — Design

**Date:** 2026-04-20
**Status:** Approved — ready for implementation planning.
**Supersedes:** the existing Storyboard feature (StoryboardStrip component, useStoryboardSync hook, Scene data model, /api/storyboard sidecar endpoints, storyboard.json on disk).

---

## Problem

The Storyboard feature (shipped 2026-04-19 in `4a9546f`, redesigned as a proportional-canvas in `d48086b`) imports cinematic / animation metaphors into music-video editing. The underlying need — external memory for song structure across sessions — is real, but the framing is wrong:

- "Storyboard" invokes film/animation planning where the narrative is invented; in music video editing, the narrative is given by the track and the user is decoding it.
- The current `Scene` data model (`name`, `startSec`, `endSec`, `intent`, `linkedElementIds`, `linkedEventNames`) is larger than needed. `intent` / `linked*` fields are never populated in practice.
- "Scenes" as discrete cards with hard boundaries misrepresent how musical sections flow continuously.
- Every major DAW (Ableton Live, Logic Pro, Pro Tools) has exactly this feature under the established names "Arrangement Markers" / "Locators" / "Memory Locations", rendered as colored time-ranged regions on a lane above / inside the waveform — not as cinematic cards.

## Decision

Replace Storyboard with **Song Sections** — a DAW-native named-section feature. Minimal data model. Translucent overlay on the existing waveform (Ableton Live arrangement-view style). Hard cutover; no migration because only test-seed data exists today.

## Data Model

```typescript
type SectionType = "intro" | "build" | "drop" | "breakdown" | "outro" | "custom";

type Section = {
  id: string;
  name: string;
  startSec: number;
  endSec: number;
  type: SectionType;
  color: string;  // resolved hex; follows type except when type === "custom"
};
```

**Persisted** to `projects/<stem>/sections.json`:

```json
{
  "version": 1,
  "stem": "<stem>",
  "sections": [ { ...Section } ]
}
```

No `intent` / `linkedElementIds` / `linkedEventNames`. If "notes per section" becomes a real need later, add a `notes: string` field then — YAGNI.

## Placement — translucent overlay on the waveform

The Scrubber gains an absolutely-positioned `SectionOverlay` layer sitting on top of the waveform bars (behind event markers and playhead).

- **Section body**: translucent colored fill (~20% alpha), 2px opaque vertical boundary line at each edge, spans the full waveform height.
- **Label strip**: the top 20px of the waveform is reserved for section labels. Each label shows the section name in uppercase monospace, colored by the section's type.
- Sections are sized in % relative to the waveform width: `left = startSec / totalSec * 100`, `width = (endSec - startSec) / totalSec * 100`. Auto-scales with waveform zoom.
- Z-order: waveform bars → section fills → section boundary lines → section labels (in the top strip) → event markers → playhead.

## Click Resolution — spatial split

| Click target | Behavior |
|---|---|
| Top 20px label strip, on a label | Select that section. Outline highlights. |
| Top 20px label strip, drag label body | Move the whole section (left/right). Snap-enabled. |
| Top 20px label strip, drag within 8px of a section edge | Resize that edge only. Snap-enabled. |
| Top 20px label strip, double-click a label | Open edit modal. |
| Top 20px label strip, hover a label | Reveal × delete button on the right edge. |
| Waveform body (below 20px strip) | Unchanged. Click = seek playhead. Event markers still clickable, draggable, Delete-removable. Shift-click = add event. |
| Waveform body, Shift-drag | Create a new section from drag start to release; open modal to name it. |

Shift-drag on the body wins over any section-body visual overlap because the user's intent is explicit (Shift = override default).

## Interaction Model

### Create

Four paths, all ship:

1. **`+ SECTION` button** in the analysis strip — opens modal with blank name, `startSec = currentTimeSec`, `endSec = currentTimeSec + 30`, `type = "custom"`.
2. **Shift-drag on waveform body** — creates section from drag start to release; modal opens pre-filled to name it.
3. **`S` key at playhead** — first press marks `startSec = currentTimeSec` (visible ghost indicator); second press sets `endSec = currentTimeSec` and opens modal. `Esc` during ghost state cancels.
4. **Seed from events** — one-click button visible only when `sections.length === 0` AND `phase2_events_sec.length > 0`. Creates `N-1` sections between each consecutive pair of Phase 2 events; types auto-guessed from event index (first→intro, second→build, middle→drop(s)/breakdown, last→outro).

### Edit

- Modal opens via double-click on label OR clicking `edit` control in the label strip.
- Fields: name (text), start/end (number in seconds), type (dropdown), color swatch (visible only when type = custom).
- Save writes to store → debounced autosave POSTs to sidecar.
- Cancel reverts all changes.
- `Esc` closes without saving; `Cmd/Ctrl+Enter` saves.

### Move & Resize

- Drag label body → moves both `startSec` and `endSec` by the same delta. Clamped to `[0, compositionDuration]`.
- Drag an edge (within 8px of start or end boundary) → moves only that edge. Clamped so `endSec > startSec`.
- Snap target priority: **Phase 2 events → downbeats → beats**, threshold 0.25s (closest target within threshold wins). Shift disables all snapping.
- On release, debounced autosave fires.

### Delete

- Hover a label → reveal `×` button on the right edge of the label; click deletes without confirm (undo-via-save-history if needed later).
- Select a section (click label) + press `Delete` / `Backspace` → same as `×` click. Skipped when focus is inside an input / textarea.

## Snap Target Resolver

Pure function, unit-testable:

```typescript
type SnapContext = {
  events: number[];    // phase2_events_sec from beatData
  downbeats: number[]; // beatData.downbeats
  beats: number[];     // beatData.beats
  thresholdSec: number; // 0.25
};

const snapToNearest = (t: number, ctx: SnapContext, shiftHeld: boolean): number => {
  if (shiftHeld) return t;
  // Try priority tiers: events → downbeats → beats
  for (const tier of [ctx.events, ctx.downbeats, ctx.beats]) {
    const nearest = nearestWithinThreshold(t, tier, ctx.thresholdSec);
    if (nearest !== null) return nearest;
  }
  return t;
};
```

Tier check: find the list entry minimizing `|candidate - t|`; return it iff `|candidate - t| <= thresholdSec`, else null. Empty tier returns null.

## Backend

New sidecar endpoints in `editor/vite-plugin-sidecar.ts`:

### `GET /api/sections/:stem`

- Returns `sections.json` contents (or `{ version: 1, stem, sections: [] }` on missing file).
- 400 if stem fails `STEM_RE`; 200 otherwise.

### `POST /api/sections/save`

- Body: `{ stem: string, sections: { version: 1, stem, sections: Section[] } }`.
- Validates stem against `STEM_RE`; validates sections is an array, each entry has required fields, type is in the allowed enum.
- Per-stem lock (follow the `TIMELINE_LOCK` / `STORYBOARD_LOCK` pattern — new `SECTIONS_LOCK` map).
- Atomic write: tmp file + rename.
- 200 `{ ok: true }` on success; 400 on validation error; 404 if project directory missing.

### `POST /api/sections/seed-from-events`

- Body: `{ stem: string }`.
- Reads `analysis.json`; if `phase2_events_sec.length < 2` → 400 "need at least 2 events to seed sections".
- Reads current `sections.json`; if `sections.length > 0` → 409 "sections already exist, clear first".
- Generates `events.length - 1` sections between consecutive event pairs.
- Auto-assigns types by position: first = `intro`, last = `outro`, second = `build`, any remaining odd-indexed = `drop`, even-indexed = `breakdown`. Names match type capitalized (`Intro`, `Build`, `Drop 1`, `Drop 2`, etc.).
- Writes sections.json atomically; returns 200 `{ ok: true, count: N }`.

### Deletions

- `GET /api/storyboard/:stem` — remove.
- `POST /api/storyboard/save` — remove.
- Route registration for both — remove.
- `handleStoryboardGet` / `handleStoryboardSave` / `STORYBOARD_LOCK` — delete.

## Frontend

### Files to create

- `editor/src/hooks/useSectionsSync.ts` — mirror of the deleted `useStoryboardSync.ts`. On stem change, GET `/api/sections/:stem` → `setSections`. Debounced (500ms) POSTs when `sections` changes in store.
- `editor/src/components/SectionOverlay.tsx` — absolutely-positioned layer mounted inside `Scrubber.tsx` wrapping the existing waveform. Renders fills, boundary lines, label strip, hit-target overlays for create/select/drag/resize. Consumes store `sections`, `currentTimeSec`, `beatData`, `compositionDuration`.
- `editor/src/components/SectionEditModal.tsx` — controlled modal for create / edit. Fields as above. Emits `onSave(Section)` / `onCancel()`.
- `editor/src/utils/snapSection.ts` — pure `snapToNearest` + `nearestWithinThreshold` helpers. Unit-tested.

### Files to modify

- `editor/src/types.ts` — delete `Scene` + `SectionType`/`Section` added; add `sections: Section[]` + actions to `EditorState`; remove `scenes`.
- `editor/src/store.ts` — replace `scenes` slice with `sections` slice; matching actions (`addSection`, `updateSection`, `removeSection`, `setSections`). Persist partial config for `sections` does NOT need partialize (sections autosave to disk; they are re-fetched on stem change).
- `editor/src/App.tsx` — replace `useStoryboardSync()` call with `useSectionsSync()`.
- `editor/src/components/Scrubber.tsx` — mount `<SectionOverlay />` inside the waveform container. Give the waveform body a `z-index` below the overlay's label strip. Shift-drag handler on the waveform body for section creation.
- `editor/src/components/TransportControls.tsx` — remove the `<StoryboardStrip />` mount.
- `editor/src/components/StageStrip.tsx` — add `+ SECTION` button + `Seed sections from events` button (the latter visible only when `sections.length === 0 && phase2_events_sec.length >= 2`).
- `editor/src/hooks/useKeyboardShortcuts.ts` — add `S`-key handler for start/end marking.

### Files to delete

- `editor/src/components/StoryboardStrip.tsx`
- `editor/src/hooks/useStoryboardSync.ts`
- Any test files pinned to either of those (none currently exist in `editor/tests/`).

## Testing

| Test | Coverage |
|---|---|
| `editor/tests/store.test.ts` (extend) | `addSection`, `updateSection`, `removeSection`, `setSections` — add/patch/delete semantics, id collision handling |
| `editor/tests/snapSection.test.ts` (new) | `snapToNearest` priority tiers, threshold behavior, empty lists, shift-held bypass |
| `editor/tests/sidecar-integration.test.ts` (extend) | POST `/api/sections/save` round-trips; GET returns empty on missing file; POST `/api/sections/seed-from-events` with N events produces N-1 sections; 409 when sections already exist |

No E2E / visual regression tests — out of scope (no Playwright suite).

## Not in Scope

- Sections linked to timeline elements. Deliberately dropped. If demand appears, add `linkedElementIds: string[]` later as an additive field.
- Sections linked to named events (`linkedEventNames`). Same reasoning.
- Per-section `notes` / `intent` free-text. Same reasoning.
- Auto-generating sections continuously as the track plays.
- Import/export sections across projects.
- Section templates / reusable palettes.

## Open Questions

None. Every decision was pinned during brainstorm.

## Self-Review

1. **Placeholder scan** — no TBDs, no TODOs in requirements, all paths named explicitly.
2. **Internal consistency** — data model, backend endpoints, frontend files all reference the same `Section` shape and the same `sections.json` on-disk name; snap priority (events > downbeats > beats) matches the resolver pseudocode.
3. **Scope** — single implementation plan. Distinct files. Clear removals. Additions don't depend on each other except for the obvious (store before sync before overlay).
4. **Ambiguity** — no overlapping-section constraint specified (deliberately left open — sections can overlap if the user wants, same as current Storyboard v1 rule). Edge-resize 8px threshold is specific. Snap threshold 0.25s is specific.
