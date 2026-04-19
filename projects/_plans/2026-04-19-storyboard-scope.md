# Storyboard Creator — scoping

**Date:** 2026-04-19
**Status:** proposal, not implemented
**Relates to:** `memory/project_music_video_system.md` — "Storyboard Creator: visual scene planning before code"

## What the vision says

The user's vision has two editor surfaces:
1. **Timeline editor** — exists today. Beats, pipeline elements (zeta points), drag/snap.
2. **Storyboard creator** — plan the story STRUCTURALLY before placing it on the timeline.

"Visual scene planning before code" is the whole spec. Interpreting:

- A **scene** is a named chunk of the video with intent (e.g. "zoom-in reveal of AHURA over bass drop at 2:30").
- Scenes exist before the user commits to specific elements and timing.
- The storyboard is the **plan**; the timeline is the **execution**.
- Moving from storyboard → timeline should be explicit (user "locks in" a scene), not automatic.

## Minimum viable v1

A right-side panel in the editor that lists scene cards.

**Data:** `projects/<stem>/storyboard.json`
```json
{
  "version": 1,
  "scenes": [
    {
      "id": "scene-01",
      "name": "Intro rise",
      "startSec": 0,
      "endSec": 30,
      "zetaSec": null,
      "intent": "Slow build, camera pushing in, no text until the first drop.",
      "linkedElementIds": []
    },
    {
      "id": "scene-02",
      "name": "First drop — AHURA",
      "startSec": 30,
      "endSec": 58,
      "zetaSec": 30,
      "intent": "Bell-curve reveal of 'AHURA' on beat, bass-reactive glow.",
      "linkedElementIds": ["pipeline-<stem>-30.000"]
    }
  ]
}
```

**UI** (new component `StoryboardPane`):
- Vertical stack of scene cards. Each card: name, time range, intent text, list of linked elements (chips with remove button).
- Click a card → scrubber seeks to `startSec`, highlighted on timeline.
- "+ Scene" at bottom opens a modal: name + start/end + intent.
- Drag-reorder by timestamp (auto-sort), not manual.
- "Lock in" button on a card: opens mini-form to create the implied element (type picker + props) and auto-link it.

**Sidecar endpoint:** `POST /api/storyboard/:stem/save {scenes}` — read-merge-write like the timeline save.

**Chat ops** (extend `applyMutations`):
- `{op: "addScene", scene: {...}}`
- `{op: "updateScene", id, patch}`
- `{op: "removeScene", id}`
- `{op: "linkSceneElement", sceneId, elementId}`

This lets the user say "storyboard a 3-scene arc: intro / first drop at 2:30 / outro from 8:00" in chat and see cards appear.

## What v1 does NOT do

- Auto-generation of elements from scene intent. Locking in a scene opens a form; the user picks the element type. (Auto-generation needs a separate "scene → element" prompting pass and can confabulate — out of scope for v1.)
- Thumbnails/image references per scene. Text-only.
- Multi-column layout or visual timeline within the storyboard. A flat list is enough.
- Branching / alt-takes per scene. One scene = one plan.

## What v2 can add

- Scene thumbnails (either auto-rendered from Remotion at `startSec`, or user-uploaded reference images).
- Auto-layout from vocabulary: "zeta at 2:30" → auto-creates a linked `text.bellCurve` pipeline element.
- Export: `storyboard.json` → markdown outline for sharing outside the editor.

## Estimated effort

| Task | Time |
|---|---|
| `projects/<stem>/storyboard.json` schema + sidecar read/write endpoints | 30 min |
| Zustand store: scenes slice + persist partialize | 20 min |
| `StoryboardPane` component (list + card + add/edit modal) | 60 min |
| Chat op extensions + CHAT_SYSTEM prompt entries | 30 min |
| Mount + grid wiring in App.tsx | 20 min |
| QA + vocabulary polish (label tooltips for zeta / bell-curve / beat-mapped) | 40 min |
| **Total** | **~3h 20min** |

## Open decisions (need user sign-off)

1. **Panel location.** Right drawer (collapsible, swap with ElementDetail) or new modal/tab?
2. **Scene boundaries.** Strict `startSec < endSec` (scenes don't overlap), or overlap allowed?
3. **Locked pipeline elements vs. scene-linked elements.** If a scene links a pipeline-origin element, does unlocking the element break the link, or just flag it?
4. **Vocabulary in the UI.** How far to push "zeta" / "bell-curve"? Tooltips only, or replace raw labels ("text.bellCurve" → "Bell-Curve Reveal")?

Decision needed before implementation starts. No code written against this plan yet.
