# Post-Migration Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three gaps flagged in the post-migration verification pass: (1) live-reload of externally-edited `timeline.json`, (2) render phase1/phase2 event markers in the Scrubber overlay, (3) a manual-verification checklist for GUI flows that can't be curl-tested.

**Architecture:** Additive changes only. Sidecar gains one SSE endpoint + `fs.watch` on the project dir. Editor's existing `useTimelineSync` hook adds an `EventSource` subscriber that re-hydrates the store on change events. Scrubber's existing SVG overlay gains one new `<line>` layer driven by `beatData.phase1_events_sec` / `phase2_events_sec`. Verification becomes a committed markdown checklist the user runs in a browser against a live dev server.

**Tech Stack:** TypeScript, Node `fs.watch`, Server-Sent Events, Vite dev-server middleware, React/Zustand, SVG.

**Engine-lock note:** Every file touched by this plan (`editor/vite-plugin-sidecar.ts`, `editor/src/hooks/useTimelineSync.ts`, `editor/src/components/Scrubber.tsx`, `docs/VERIFICATION.md`) is in an engine path. The executing session must be launched with `ENGINE_UNLOCK=1` in the shell env, or the PreToolUse hook will block every Write/Edit. This plan doc lives at `projects/_plans/` because `projects/` is unlocked — if you want to promote it to `docs/superpowers/plans/` once unlocked, `git mv projects/_plans/2026-04-18-post-migration-closure.md docs/superpowers/plans/`.

---

## File Structure

| File | Role | Change |
|---|---|---|
| `editor/vite-plugin-sidecar.ts` | Sidecar HTTP endpoints | **Modify** — add `handleTimelineWatch` + register under `/api/timeline/watch/` |
| `editor/src/hooks/useTimelineSync.ts` | Timeline ↔ disk binding | **Modify** — add `EventSource` subscription that re-hydrates on remote change |
| `editor/src/components/Scrubber.tsx` | Waveform + overlay markers | **Modify** — add phase-event SVG lines alongside existing drop/breakdown lines |
| `docs/VERIFICATION.md` | Manual test checklist | **Create** — document the 5 GUI flows that need browser verification |

No files beyond these four. No schemas change. No persist-version bumps needed.

---

## Task 1: Sidecar file-watcher SSE endpoint

**Files:**
- Modify: `editor/vite-plugin-sidecar.ts` (add `handleTimelineWatch`, register middleware)

- [ ] **Step 1.1: Add `handleTimelineWatch` above the middleware registration block**

Insert this handler just before the existing `const handleChat = async` function:

```typescript
// ---------------------------------------------------------------------------
// /api/timeline/watch/:stem  (GET — SSE stream of external edits to timeline.json)
// ---------------------------------------------------------------------------
//
// Pushes a `change` event whenever projects/<stem>/timeline.json is modified
// by something OTHER than the autosave round-trip (e.g. Claude Code's Edit
// tool touching the file, or the user editing it in vim). The editor's
// useTimelineSync hook consumes this stream and re-hydrates the store so
// the preview reflects the external change without a manual refresh.
//
// Watches the PARENT DIRECTORY and filters on filename because our own
// /api/timeline/save writes a tmp file then renames — fs.watch on the
// file itself loses the inode during that rename. Dir-watch + filter is
// race-free.

const handleTimelineWatch = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  // Connect strips "/api/timeline/watch/"; req.url is "/love-in-traffic".
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a dir");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "project not found", stem }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable nginx-style buffering if ever behind a proxy
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ stem })}\n\n`);

  const { watch } = await import("node:fs");
  let watcher: import("node:fs").FSWatcher | null = null;
  try {
    watcher = watch(projectDir, { persistent: false }, (eventType, filename) => {
      if (filename !== "timeline.json") return;
      if (eventType !== "change" && eventType !== "rename") return;
      try {
        res.write(
          `event: change\ndata: ${JSON.stringify({ stem, ts: Date.now() })}\n\n`,
        );
      } catch {
        // connection closed; ignore
      }
    });
  } catch (err) {
    // Directory watch failed (unlikely). Surface as a one-off SSE error
    // and hold the connection so the client doesn't reconnect-storm.
    res.write(
      `event: error\ndata: ${JSON.stringify({ stem, detail: String(err) })}\n\n`,
    );
  }

  // SSE keep-alive — some intermediaries close idle connections at 30s.
  const keepalive = setInterval(() => {
    try { res.write(":keepalive\n\n"); } catch { /* closed */ }
  }, 20000);

  req.on("close", () => {
    clearInterval(keepalive);
    if (watcher) watcher.close();
  });
};
```

- [ ] **Step 1.2: Register the new middleware**

Find the existing block in `configureServer`:

```typescript
    server.middlewares.use("/api/timeline/save", wrap("POST", handleTimelineSave));
    server.middlewares.use("/api/timeline/", wrap("GET", handleTimelineGet));
    server.middlewares.use("/api/current-project", wrap("GET", handleCurrentGet));
    server.middlewares.use("/api/current-project", wrap("POST", handleCurrentSave));
```

Add the watch route **before** `/api/timeline/` so the more specific path matches first:

```typescript
    server.middlewares.use("/api/timeline/save", wrap("POST", handleTimelineSave));
    server.middlewares.use("/api/timeline/watch/", wrap("GET", handleTimelineWatch));
    server.middlewares.use("/api/timeline/", wrap("GET", handleTimelineGet));
    server.middlewares.use("/api/current-project", wrap("GET", handleCurrentGet));
    server.middlewares.use("/api/current-project", wrap("POST", handleCurrentSave));
```

Middleware order matters in Connect: more specific paths must register before less specific prefixes. `/api/timeline/watch/` is a prefix of `/api/timeline/`, so it has to come first or a GET to `/api/timeline/watch/love-in-traffic` would match `handleTimelineGet` and try to read a file called `watch/love-in-traffic`.

- [ ] **Step 1.3: tsc verify**

Run: `npx tsc --noEmit -p editor/tsconfig.json`
Expected: exit 0, no output.

- [ ] **Step 1.4: Smoke test the endpoint via curl**

With the dev server running on :4000:

```bash
# Terminal 1 — start listening, timeout after 6s so the script exits cleanly
curl -s -N --max-time 6 http://localhost:4000/api/timeline/watch/love-in-traffic &
CURL_PID=$!

sleep 1

# Terminal 2 — trigger a change
curl -s -X POST http://localhost:4000/api/timeline/save \
  -H "Content-Type: application/json" \
  -d '{"stem":"love-in-traffic","timeline":{"version":1,"stem":"love-in-traffic","fps":24,"compositionDuration":5,"elements":[]}}' > /dev/null

wait $CURL_PID
rm -f projects/love-in-traffic/timeline.json
```

Expected: you see `event: hello` then `event: change` in the curl output within 2 seconds of the POST.

- [ ] **Step 1.5: Commit**

```bash
git add editor/vite-plugin-sidecar.ts
git commit -m "feat(sidecar): /api/timeline/watch/:stem SSE for external-edit detection

Watches projects/<stem>/ via fs.watch (dir-level, filename-filtered to
beat the rename-on-save inode change). Emits 'change' SSE events the
editor subscribes to in the next task. Keep-alive ping every 20s to
survive idle-connection closers.

Middleware registered BEFORE /api/timeline/ so the more specific prefix
wins in Connect's match order.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Editor EventSource consumer in `useTimelineSync`

**Files:**
- Modify: `editor/src/hooks/useTimelineSync.ts` (add EventSource subscription)

- [ ] **Step 2.1: Add a ref for the EventSource + a helper to (re)open it**

Above the existing `useEffect` that handles hydrate + stem switch, add this inside the `useTimelineSync` hook body:

```typescript
  // Long-lived EventSource that notifies us when projects/<stem>/timeline.json
  // is changed by something other than our own autosave (e.g. Claude Code's
  // Edit tool, or vim). Closed and re-opened on every stem change.
  const watchRef = useRef<EventSource | null>(null);

  const openWatcher = (stem: string, onRemoteChange: () => void) => {
    if (watchRef.current) {
      watchRef.current.close();
      watchRef.current = null;
    }
    try {
      const es = new EventSource(`/api/timeline/watch/${stem}`);
      es.addEventListener("change", () => onRemoteChange());
      es.addEventListener("error", () => {
        // Browser will auto-reconnect; nothing to do. EventSource handles
        // reconnection internally with a 3s backoff by default.
      });
      watchRef.current = es;
    } catch {
      // Older browsers without EventSource — skip silently. Autosave
      // still works; only live-reload from external edits is lost.
    }
  };
```

- [ ] **Step 2.2: Wire the watcher into the stem-switch effect**

Find the existing stem-switch subscription:

```typescript
    const unsubSwitch = useEditorStore.subscribe((state, prev) => {
      const nextStem = stemFromAudioSrc(state.audioSrc);
      const prevStem = stemFromAudioSrc(prev.audioSrc);
      if (nextStem && nextStem !== prevStem) {
        currentStemRef.current = nextStem;
        void hydrate(nextStem);
        void fetch("/api/current-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stem: nextStem }),
        }).catch(() => {});
      }
    });
```

Replace it with the version that also opens a watcher for the new stem:

```typescript
    const unsubSwitch = useEditorStore.subscribe((state, prev) => {
      const nextStem = stemFromAudioSrc(state.audioSrc);
      const prevStem = stemFromAudioSrc(prev.audioSrc);
      if (nextStem && nextStem !== prevStem) {
        currentStemRef.current = nextStem;
        void hydrate(nextStem);
        void fetch("/api/current-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stem: nextStem }),
        }).catch(() => {});
        openWatcher(nextStem, () => void hydrate(nextStem));
      }
    });
```

- [ ] **Step 2.3: Open the watcher on mount too**

Find the bootstrap block at the bottom of the same effect:

```typescript
    const initialStem = stemFromAudioSrc(
      useEditorStore.getState().audioSrc,
    );
    if (initialStem) {
      currentStemRef.current = initialStem;
      void hydrate(initialStem);
      void fetch("/api/current-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stem: initialStem }),
      }).catch(() => {});
    }
```

Change it to also open the initial watcher:

```typescript
    const initialStem = stemFromAudioSrc(
      useEditorStore.getState().audioSrc,
    );
    if (initialStem) {
      currentStemRef.current = initialStem;
      void hydrate(initialStem);
      void fetch("/api/current-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stem: initialStem }),
      }).catch(() => {});
      openWatcher(initialStem, () => void hydrate(initialStem));
    }
```

- [ ] **Step 2.4: Close the watcher on unmount**

Find the cleanup return at the end of the hydrate effect:

```typescript
    return () => {
      cancelled = true;
      unsubSwitch();
    };
```

Extend it:

```typescript
    return () => {
      cancelled = true;
      unsubSwitch();
      if (watchRef.current) {
        watchRef.current.close();
        watchRef.current = null;
      }
    };
```

- [ ] **Step 2.5: tsc verify**

Run: `npx tsc --noEmit -p editor/tsconfig.json`
Expected: exit 0.

- [ ] **Step 2.6: Manual verification — external edit triggers re-hydrate**

Dev server on :4000, browser tab open on the editor, project = `love-in-traffic` in SongPicker. Then:

```bash
# Write a timeline.json directly to disk
cat > projects/love-in-traffic/timeline.json <<'EOF'
{"version":1,"stem":"love-in-traffic","fps":24,"compositionDuration":10,"elements":[
  {"id":"ext-1","type":"text.bellCurve","trackIndex":0,"startSec":2,"durationSec":3,"label":"EXT","props":{"text":"EXTERNAL"}}
]}
EOF
```

Expected (in the browser, within ~1s):
- Timeline panel shows a new element labeled "EXT" at 2s.
- Composition preview briefly re-renders.

If nothing happens, open DevTools Network tab — confirm an open `EventSource` connection to `/api/timeline/watch/love-in-traffic` and that it received a `change` event.

Cleanup: `rm projects/love-in-traffic/timeline.json`.

- [ ] **Step 2.7: Commit**

```bash
git add editor/src/hooks/useTimelineSync.ts
git commit -m "feat(editor): live-reload timeline.json on external edits

Adds an EventSource subscription in useTimelineSync to the new
/api/timeline/watch/:stem SSE endpoint. On every 'change' event the
hook re-runs hydrate(), pulling the latest disk state into the
Zustand store.

Open on mount + on every SongPicker stem change; closed on unmount
and before opening a new one. Browser handles reconnection on
transient sidecar restart automatically (EventSource default 3s
backoff).

Closes the inbound half of the 3-way data flow (GUI drag, ChatPane
mutation, external Claude Code Edit all now converge on
projects/<stem>/timeline.json with live updates in both directions).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Scrubber phase-event overlay markers

**Files:**
- Modify: `editor/src/components/Scrubber.tsx` (add phase1/phase2 SVG lines to the overlay)

- [ ] **Step 3.1: Add the new line markers above the existing drop/breakdown layers**

Find the existing SVG overlay block:

```tsx
        {ready && beatData && (
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
            preserveAspectRatio="none"
            viewBox={`0 0 ${totalSec} 100`}
          >
            {/* Breakdown regions */}
            {beatData.breakdowns.map((b, i) => (
```

Insert new marker groups immediately **after** the `<svg>` opening tag (so phase lines sit UNDER breakdown regions, not over them — beats the "red regions fill over yellow lines" layer-order issue):

```tsx
        {ready && beatData && (
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
            preserveAspectRatio="none"
            viewBox={`0 0 ${totalSec} 100`}
          >
            {/* Phase-1 event markers (new-pipeline intermediate events).
                Shown only when phase-2 isn't yet present — once phase-2 is
                merged we don't want both layers competing visually. */}
            {!beatData.phase2_events_sec?.length &&
              beatData.phase1_events_sec?.map((t, i) => (
                <line
                  key={`ph1-${i}`}
                  x1={t}
                  x2={t}
                  y1={0}
                  y2={100}
                  stroke="#ffaa44"
                  strokeWidth={0.22}
                  vectorEffect="non-scaling-stroke"
                  opacity={0.7}
                />
              ))}
            {/* Phase-2 event markers (final confirmed events from the
                waveform-analysis-protocol workflow). Bright yellow, full
                opacity — these are the canonical event lines. */}
            {beatData.phase2_events_sec?.map((t, i) => (
              <line
                key={`ph2-${i}`}
                x1={t}
                x2={t}
                y1={0}
                y2={100}
                stroke="#ffcc00"
                strokeWidth={0.28}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {/* Breakdown regions */}
            {beatData.breakdowns.map((b, i) => (
```

Keep the rest of the `<svg>` block unchanged (breakdowns + legacy drops still render when the legacy schema has them).

- [ ] **Step 3.2: tsc verify**

Run: `npx tsc --noEmit -p editor/tsconfig.json`
Expected: exit 0.

- [ ] **Step 3.3: Manual verification — phase2 events render for as-the-rush-comes**

Dev server on :4000. In the browser:
1. Pick `as-the-rush-comes` in the SongPicker dropdown.
2. Scrubber shows the waveform.
3. **Expected:** 7 bright yellow vertical lines at roughly 63.5 s, 2:02, 4:11, 4:28, 5:58, 7:14, 8:58 (matching `phase2_events_sec: [63.5, 122.0, 251.0, 268.8, 358.5, 434.0, 538.0]`).
4. The Scrubber header strip should say "7 events" alongside the beats/drops/bpm counters.

For `love-in-traffic`: because its `phase1_events_sec: [3 values]` is present but `phase2_events_sec` is not, you should see 3 lighter/paler orange lines and the header says "3 events".

For `dubfire-sake`: legacy schema (no phase fields), so neither marker layer renders; the existing red drops + breakdown regions render as before.

- [ ] **Step 3.4: Commit**

```bash
git add editor/src/components/Scrubber.tsx
git commit -m "feat(editor): render phase1/phase2 event markers in Scrubber overlay

Adds two SVG line layers to the Scrubber overlay, driven by the new
pipeline's phase1_events_sec / phase2_events_sec arrays:
- Phase 2 (canonical final events): bright yellow #ffcc00, full opacity
- Phase 1 (intermediate events): pale orange #ffaa44 at 0.7 opacity,
  shown only when phase-2 isn't yet available (prevents double-render
  of the same time points)

Legacy drop/breakdown markers continue to render from their respective
fields when present — this is purely additive for the new schema.

Fixes the 'as-the-rush-comes has 7 confirmed events invisible to the
UI' gap called out in the post-migration verification pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Manual verification checklist

**Files:**
- Create: `docs/VERIFICATION.md` (runnable browser checklist)

- [ ] **Step 4.1: Write the checklist**

Create `docs/VERIFICATION.md` with this content:

````markdown
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
````

- [ ] **Step 4.2: Commit**

```bash
git add docs/VERIFICATION.md
git commit -m "docs: manual verification checklist for GUI flows

Six-flow runbook for verifying the editor end-to-end in a live browser,
covering the interactions that curl/tsc can't test: GUI drag autosave,
chat mutations, Cmd-Z undo, external-edit live-reload, phase event
markers in the Scrubber, and end-to-end render.

Pairs with the curl/tsc checks that live in the task-by-task
verification inside each feature commit. Intended to be run after
any change touching the editor, sidecar, or compositions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Final end-to-end verification

**Files:**
- None modified (run the checklist from Task 4)

- [ ] **Step 5.1: Kill any stale dev servers**

```bash
pkill -f vite 2>/dev/null; sleep 1
lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep -E ":(400[0-9])" || echo "all clear"
```

Expected: "all clear".

- [ ] **Step 5.2: Start a single fresh dev server**

```bash
cd editor && npm run dev &
# wait for "VITE ... ready" in the output
```

- [ ] **Step 5.3: Walk through `docs/VERIFICATION.md` Flows 1-6, checking each box**

Expected: all 6 flows pass. If any fail, the commit for the relevant task needs a follow-up fix.

- [ ] **Step 5.4: Final push**

```bash
git push origin main
```

- [ ] **Step 5.5: Report verified state**

State: "All 5 tasks committed. Flows 1–6 in `docs/VERIFICATION.md` all pass against commit `<sha>`." Include evidence (file diffs, network tab screenshots if helpful). Do NOT claim completion without having actually run the flows.

---

## Self-Review

**Spec coverage:**
- Gap 1 (live-reload) → Tasks 1 + 2 ✓
- Gap 2 (phase markers) → Task 3 ✓
- Gap 3 (verification checklist) → Task 4 ✓
- End-to-end proof that all three land → Task 5 ✓

**Placeholder scan:** None. All code blocks are complete, all commit messages are written out, all file paths are exact.

**Type consistency:**
- `handleTimelineWatch` signature matches other sidecar handlers (`req, res => Promise<void>`) ✓
- `STEM_RE` constant exists in the file (introduced in Phase D commit `7e771a1`) ✓
- `PROJECTS_DIR` constant exists (same commit) ✓
- `openWatcher` helper declared and used inside `useTimelineSync`, not exported ✓
- `watchRef` is `useRef<EventSource | null>` — matches browser's `EventSource` global type ✓
- `beatData.phase1_events_sec` / `phase2_events_sec` already declared optional in `editor/src/types.ts` (commit `4b660af`) ✓

**Scope check:** All three gaps are small, additive, and independent; no subsystem needs decomposition into a separate plan.

---

## Execution Handoff

Plan complete and saved to `projects/_plans/2026-04-18-post-migration-closure.md` (stored here instead of `docs/superpowers/plans/` because `docs/` is engine-locked; once unlocked the file can be promoted with `git mv`).

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Caveat for both paths:** every file this plan modifies is in an engine path. The executing session must be launched with `ENGINE_UNLOCK=1` in its shell env, or the PreToolUse hook will block every Write/Edit. If you run this current (already-open) Claude Code session, that env var isn't set here and writes will fail the same way the plan-doc write just did.

**Which approach?**
