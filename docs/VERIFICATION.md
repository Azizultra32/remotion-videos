# Editor Verification Checklist

Manual browser-side test procedures for flows that can't be curl-tested. Run these against a fresh dev server (`cd editor && npm run dev`) after any change to the editor, sidecar, or compositions. Each flow has explicit setup, actions, and expected/failure signals.

## Prerequisites

1. Single dev server running on :4000 (`pkill -f vite; cd editor && npm run dev`)
2. `projects/` populated with at least `love-in-traffic`, `as-the-rush-comes`, `dubfire-sake`
3. Browser tab open on `http://localhost:4000/`
4. DevTools open to Network + Console tabs (most failures surface there first)

## Flow 1 — GUI drag → disk autosave

**Setup:** Pick `love-in-traffic` in SongPicker. Confirm `projects/love-in-traffic/timeline.json` does NOT exist on disk yet (`ls projects/love-in-traffic/timeline.json` should 404).

**Actions:**
1. Drag a `text.bellCurve` element from the Sidebar onto the timeline around t=10s.
2. Wait 1 second (for the 500 ms debounce plus write latency).

**Expected:**
- `cat projects/love-in-traffic/timeline.json` shows the new element.
- Network tab shows `POST /api/timeline/save` with HTTP 200.
- `cat .current-project` outputs `love-in-traffic`.

**Failure signal:** file absent, 500/4xx in network tab, console error mentioning autosave.

**Cleanup:** `rm projects/love-in-traffic/timeline.json`

---

## Flow 2 — ChatPane mutation → disk autosave

**Setup:** Same as Flow 1 (empty timeline).

**Actions:**
1. In ChatPane, type: `add a bell-curve text "TEST" at 20 seconds`
2. Wait for the assistant's "applied N mutation(s)" reply.
3. Wait 1 additional second for autosave.

**Expected:**
- `projects/love-in-traffic/timeline.json` contains an element with label or text "TEST" at startSec: 20.
- Scrubber shows no change (chat doesn't directly drive Scrubber).
- Timeline panel shows the new element block.

**Failure signal:** chat returns "applied 0 mutations", 429 banner (rate-limited), file unchanged.

**Cleanup:** `rm projects/love-in-traffic/timeline.json`

---

## Flow 3 — Cmd-Z / Cmd-Shift-Z undo/redo

**Setup:** Make 3 consecutive element mutations (drag 3 elements onto the timeline).

**Actions:**
1. Press ⌘Z three times.
2. Observe element count: 3 → 2 → 1 → 0.
3. Press ⌘⇧Z three times.
4. Observe element count: 0 → 1 → 2 → 3.

**Expected:**
- Each ⌘Z removes the most recently added element (LIFO).
- Redo brings them back in the same order.
- The timeline panel rerenders instantly (no network round-trip; pure in-memory stack).
- **Each undo ALSO triggers an autosave** → `timeline.json` gets overwritten within 500 ms with the pre-undo state. Verify by watching `watch -n 0.5 cat projects/love-in-traffic/timeline.json | jq '.elements | length'`.

**Failure signal:** ⌘Z does nothing, undoes the wrong element, or doesn't propagate to disk.

**Cleanup:** `rm projects/love-in-traffic/timeline.json`

---

## Flow 4 — External edit → live-reload (requires Task 1 + Task 2 committed)

**Setup:** Empty timeline, project = `love-in-traffic`. DevTools Network tab filtered to "EventSource".

**Actions:**
1. In DevTools, confirm one open EventSource to `/api/timeline/watch/love-in-traffic` with `readyState: 1 (OPEN)`.
2. In a terminal, write:

   ```bash
   cat > projects/love-in-traffic/timeline.json <<'EOF'
   {"version":1,"stem":"love-in-traffic","fps":24,"compositionDuration":10,"elements":[
     {"id":"ext-1","type":"text.bellCurve","trackIndex":0,"startSec":2,"durationSec":3,"label":"EXT","props":{"text":"EXTERNAL"}}
   ]}
   EOF
   ```

3. Wait 1 second.

**Expected:**
- EventSource receives a `change` event (visible in Network → EventSource → Messages tab).
- Timeline panel shows the "EXT" element at 2s.
- Composition preview briefly re-renders.

**Failure signal:** nothing appears until you manually reload the tab.

**Cleanup:** `rm projects/love-in-traffic/timeline.json`

---

## Flow 5 — Phase event markers in Scrubber (requires Task 3 committed)

**Setup:** None beyond prerequisites.

**Actions:**
1. Pick `as-the-rush-comes` in SongPicker.
2. Wait for waveform to render.

**Expected:**
- 7 bright yellow vertical lines in the Scrubber overlay at ~63.5 s, 2:02, 4:11, 4:28, 5:58, 7:14, 8:58.
- Scrubber header strip text includes "7 events".
- Switch to `love-in-traffic`: 3 paler-orange lines at roughly the phase1 timestamps; header says "3 events".
- Switch to `dubfire-sake`: no phase lines (legacy schema); existing red drop lines + breakdown regions render as before.

**Failure signal:** no markers visible for rush-comes, or all three projects render identically.

---

## Flow 6 — End-to-end render from editor

**Setup:** Project = `love-in-traffic`, empty timeline.

**Actions:**
1. Click the green **Render** button (leftmost in ProjectActions toolbar).
2. Watch progress bar go: Bundling → Rendering N/M → Encoding.
3. When it turns green "Rendered ✓", click to open.

**Expected:**
- Browser opens a new tab with the MP4 playing via `/api/out/musicvideo-<ts>.mp4`.
- File exists at `out/musicvideo-<ts>.mp4` on disk (~5–12 MB depending on composition duration).

**Failure signal:** render hangs, 500 error, or "Rendered ✓" click 404s.

---

## What passes = what to claim

After running all 6 flows green, you can honestly claim:
- Bidirectional timeline sync (GUI drag, chat, external edit all converge on `timeline.json`)
- Undo/redo covers all mutations regardless of entry point
- Scrubber renders the new analysis schema's event points
- Render pipeline end-to-end from UI to playable MP4

Any flow that can't be exercised (e.g. Flow 4 before Tasks 1+2 ship) must be explicitly marked "N/A — feature not yet shipped" in the verification report, not assumed pass.
