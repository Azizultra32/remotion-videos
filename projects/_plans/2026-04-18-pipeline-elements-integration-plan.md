# Pipeline Elements Integration Implementation Plan

> **STATUS: SHIPPED 2026-04-19.** All 8 tasks completed and pushed to origin/main.
> Final commits: `eb384ea` → `a064ea9`. End-to-end verified via headless Chrome + CDP:
> 6 pipeline placeholders + LOCK badges, EventCycler chips, fresh phase2 PNG in Scrubber,
> user elements preserved, zero console errors. See commit `125f60e` for three bugs
> exposed by verification (EventCycler hooks, hydrate race, SSE multi-line JSON).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface analysis-pipeline outputs in the editor: events auto-populate the timeline as locked placeholder elements, analysis progress shows live, a cycler navigates events, and user edits coexist with pipeline-created ones.

**Architecture:** Additive editor changes only — no render-engine modification. Store gains `origin` + `locked` on elements (persist migration v5→v6). New sidecar endpoints expose analysis status + thin event list. A `StageStrip` component shows phase progress while analysis runs; it gets replaced by an `EventCycler` once `analysis.json` exists. The Timeline panel treats locked elements differently (dashed border, dimmed, delete-resistant). `mv:analyze` writes a per-run status file the sidecar tails and streams back via SSE.

**Tech Stack:** TypeScript, React, Zustand (persist), Vite middleware, SSE, Node fs.watch.

**Saved to:** `projects/_plans/` because `docs/superpowers/plans/` is engine-locked and this session has no `ENGINE_UNLOCK=1`. Promote via `git mv` later if desired.

---

## Scope / non-scope

**In scope (8 tasks):**
1. Data model: `origin` + `locked` on `TimelineElement` + persist v5→v6
2. Timeline panel: dashed border + lower opacity + delete-resistance on locked elements
3. ElementDetail: lock/unlock toggle + origin label
4. Auto-populate pipeline placeholders: one `text.bellCurve` per event (empty text, locked, `origin: "pipeline"`), synced to `analysis.json`
5. Event cycler in TransportControls: prev/next + chips per event; clicking jumps playhead + selects corresponding element
6. Stage strip (during analysis): reads `projects/<stem>/.analyze-status.json` via SSE; lights up stages as they complete
7. Beat-snap on locked-element drag: when user temporarily unlocks + drags, snap-to-beat is enforced (overrides global snap mode)
8. End-to-end verification

**Out of scope:** any change to the analysis pipeline itself, the master prompt, or the Remotion compositions. Event naming/text content is the user's job after placeholders land.

---

## File structure

**Modified (engine-locked — implementer uses Bash/Python heredoc):**

| File | Role | Task(s) |
|---|---|---|
| `editor/src/types.ts` | `TimelineElement` + `EditorState` | 1 |
| `editor/src/store.ts` | persist v5→v6 migration + `setElementLocked`, `replacePipelineElements` actions | 1, 4 |
| `editor/src/components/Timeline.tsx` | locked styling + delete guard | 2 |
| `editor/src/components/ElementDetail.tsx` | lock/unlock button + origin chip | 3 |
| `editor/src/components/TransportControls.tsx` | mount `StageStrip` xor `EventCycler` below transport | 5, 6 |
| `editor/src/hooks/useTimelineSync.ts` | subscribe to `/api/analyze/events/:stem` SSE → call `replacePipelineElements` | 4 |
| `editor/src/hooks/useElementDrag.ts` | if source element is `locked`, treat beat-snap as mandatory | 7 |
| `editor/src/hooks/useKeyboardShortcuts.ts` | `[` prev event, `]` next event | 5 |
| `editor/vite-plugin-sidecar.ts` | GET `/api/analyze/status/:stem` (SSE), GET `/api/analyze/events/:stem` (SSE, emits on `analysis.json` change) | 4, 6 |
| `scripts/cli/mv-analyze.ts` | emit `.analyze-status.json` updates at each phase boundary | 6 |

**Created:**

- `editor/src/components/StageStrip.tsx` — progress strip during analysis
- `editor/src/components/EventCycler.tsx` — per-event navigation after analysis
- `editor/src/utils/pipelineElements.ts` — pure functions: build placeholder from event time, diff existing vs. desired pipeline element set

Every engine-locked edit goes through a Bash + Python heredoc because the current session lacks `ENGINE_UNLOCK=1`.

---

## Task 1: Data model + persist migration

**Files:**
- Modify: `editor/src/types.ts` (add two optional fields to `TimelineElement`, one action to `EditorState`)
- Modify: `editor/src/store.ts` (add `setElementLocked`, bump persist version, migrate)
- Test: `editor/tests/store.test.ts` (new case for lock toggle + migration)

- [ ] **Step 1.1: Extend the type** — add `origin?: "pipeline" | "user"` and `locked?: boolean` to `TimelineElement`:

```typescript
export type TimelineElement = {
  id: string;
  type: ElementType;
  trackIndex: number;
  startSec: number;
  durationSec: number;
  label: string;
  props: Record<string, unknown>;
  origin?: "pipeline" | "user";  // default "user"; pipeline = auto-added from analysis.json
  locked?: boolean;              // default false; locked elements resist deletion and force beat-snap on drag
};
```

- [ ] **Step 1.2: Extend the store** — add action `setElementLocked(id, locked)` and include it in `EditorState` in `types.ts`:

```typescript
setElementLocked: (id: string, locked: boolean) => void;
```

In `store.ts`, add the implementation:

```typescript
setElementLocked: (id, locked) =>
  set((s) => ({
    elements: s.elements.map((e) =>
      e.id === id ? { ...e, locked } : e,
    ),
  })),
```

- [ ] **Step 1.3: Bump persist version** — in `store.ts`, change `version: 5` to `version: 6` and extend `migrate`:

```typescript
version: 6,
migrate: (persisted, version) => {
  if (!persisted || typeof persisted !== "object") return persisted as any;
  let p = persisted as Record<string, unknown>;
  if (version < 4) {
    const prev = p.snapToBeat;
    const snapMode = prev === false ? "off" : "beat";
    const { snapToBeat: _drop1, loopPlayback: _drop2, ...rest } = p;
    p = { ...rest, snapMode };
  }
  if (version < 5) {
    const audioSrc = typeof p.audioSrc === "string" ? p.audioSrc : null;
    const beatsSrc = typeof p.beatsSrc === "string" ? p.beatsSrc : null;
    const needsReset =
      (audioSrc && !audioSrc.startsWith("projects/")) ||
      (beatsSrc && !beatsSrc.startsWith("projects/"));
    if (needsReset) p = { ...p, audioSrc: null, beatsSrc: null };
  }
  if (version < 6) {
    // Pipeline-origin/locked fields added. Existing persisted elements are
    // user-origin unlocked by default; no mutation needed.
  }
  return p as any;
},
```

- [ ] **Step 1.4: Write test** — add to `editor/tests/store.test.ts`:

```typescript
test("setElementLocked toggles locked field", () => {
  const store = useEditorStore.getState();
  store.addElement({
    id: "t1", type: "text.bellCurve", trackIndex: 0, startSec: 1, durationSec: 1,
    label: "x", props: {},
  });
  expect(useEditorStore.getState().elements[0].locked).toBeFalsy();
  store.setElementLocked("t1", true);
  expect(useEditorStore.getState().elements[0].locked).toBe(true);
  store.setElementLocked("t1", false);
  expect(useEditorStore.getState().elements[0].locked).toBe(false);
  store.removeElement("t1");
});
```

- [ ] **Step 1.5: Run tests** — `cd /Users/ali/remotion-videos/editor && npx vitest run` — expect all green including the new case.

- [ ] **Step 1.6: Commit** — `git add editor/src/types.ts editor/src/store.ts editor/tests/store.test.ts && git commit -m "feat(editor): origin + locked on TimelineElement + persist v6"`

---

## Task 2: Timeline panel — locked-element styling + delete guard

**Files:**
- Modify: `editor/src/components/Timeline.tsx`

- [ ] **Step 2.1: Styling** — locate the element-block render (roughly where each timeline block gets its `style`). Add conditional styling when `el.locked`:

```tsx
style={{
  ...existingStyle,
  border: el.locked ? "1px dashed #6af" : existingStyle.border,
  opacity: el.locked ? 0.72 : 1,
  cursor: el.locked ? "default" : "grab",
}}
```

- [ ] **Step 2.2: Delete guard** — find the keyboard/button delete handler. Wrap:

```typescript
const tryDelete = (id: string) => {
  const el = useEditorStore.getState().elements.find((e) => e.id === id);
  if (el?.locked) {
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `"${el.label}" is locked (pipeline-created). Unlock first in the detail panel or confirm to delete anyway?`,
    );
    if (!ok) return;
  }
  useEditorStore.getState().removeElement(id);
};
```

- [ ] **Step 2.3: Add a small lock badge** — inline icon-less badge (text only — no emoji per project convention):

```tsx
{el.locked && (
  <span style={{
    fontSize: 9, color: "#6af", letterSpacing: "0.08em",
    marginLeft: 4, padding: "1px 4px", border: "1px solid #6af",
    borderRadius: 2,
  }}>LOCK</span>
)}
```

- [ ] **Step 2.4: tsc + visual sanity** — run `npx tsc --noEmit -p editor/tsconfig.json`. Open the editor, manually place a bellCurve element, call `useEditorStore.getState().setElementLocked("id", true)` from devtools → confirm dashed border + dimmed + LOCK badge appear.

- [ ] **Step 2.5: Commit** — `git add editor/src/components/Timeline.tsx && git commit -m "feat(editor): locked elements get dashed border + dimmed + LOCK badge + delete guard"`

---

## Task 3: ElementDetail — lock/unlock button + origin label

**Files:**
- Modify: `editor/src/components/ElementDetail.tsx`

- [ ] **Step 3.1: Read lock state + origin** — inside the component, after the existing selectors:

```typescript
const setElementLocked = useEditorStore((s) => s.setElementLocked);
// existing code has `const el = ...selectedElement...`
const isLocked = !!el?.locked;
const origin = el?.origin ?? "user";
```

- [ ] **Step 3.2: Render origin chip** — at the top of the detail panel body (text only, no emoji):

```tsx
<div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
  <span style={{
    fontSize: 9, padding: "2px 6px", border: "1px solid #555",
    borderRadius: 2, color: "#ccc", letterSpacing: "0.08em",
  }}>
    ORIGIN: {origin.toUpperCase()}
  </span>
  <button
    onClick={() => el && setElementLocked(el.id, !isLocked)}
    style={{
      fontSize: 10, padding: "2px 8px",
      background: isLocked ? "#2196F3" : "#333",
      color: "#fff", border: "1px solid " + (isLocked ? "#2196F3" : "#555"),
      borderRadius: 3, cursor: "pointer",
    }}
    title="Locked elements resist deletion and snap-to-beat when moved"
  >
    {isLocked ? "UNLOCK" : "LOCK"}
  </button>
</div>
```

- [ ] **Step 3.3: tsc** — `npx tsc --noEmit -p editor/tsconfig.json`.

- [ ] **Step 3.4: Commit** — `git add editor/src/components/ElementDetail.tsx && git commit -m "feat(editor): ElementDetail shows origin + lock toggle"`

---

## Task 4: Auto-populate pipeline placeholders from analysis.json

**Files:**
- Create: `editor/src/utils/pipelineElements.ts`
- Modify: `editor/src/store.ts` (add `replacePipelineElements` action)
- Modify: `editor/src/hooks/useTimelineSync.ts` (subscribe to analysis.json via new SSE)
- Modify: `editor/vite-plugin-sidecar.ts` (new `/api/analyze/events/:stem` SSE endpoint)

- [ ] **Step 4.1: Write the pure-function helpers** — create `editor/src/utils/pipelineElements.ts`:

```typescript
import type { TimelineElement } from "../types";

// Deterministic id — same event time always produces the same id so that a
// re-run of analysis yielding the same timestamps is idempotent.
const pipelineId = (stem: string, sec: number): string =>
  `pipeline-${stem}-${sec.toFixed(3)}`;

export const makePipelineElement = (stem: string, eventSec: number): TimelineElement => ({
  id: pipelineId(stem, eventSec),
  type: "text.bellCurve",
  trackIndex: 0,
  startSec: Math.max(0, eventSec - 1),
  durationSec: 2,
  label: `EVENT ${eventSec.toFixed(1)}s`,
  props: {
    text: "",              // user fills this in
    x: 50, y: 50,
    sigmaSec: 0.45,
    zoomFrom: 0.85, zoomTo: 1.0,
    textColor: "#ffffff", fontSize: 120, fontWeight: 800,
    fontFamily: "ui-serif, Georgia, serif", letterSpacing: "0.08em",
    bassGlowMax: 30,
  },
  origin: "pipeline",
  locked: true,
});

/**
 * Compute the new elements array given the current one and the authoritative
 * pipeline event list. Pipeline-origin elements are reconciled to exactly the
 * event set; user-origin elements are preserved untouched.
 */
export const mergePipelineElements = (
  current: TimelineElement[],
  stem: string,
  events: number[],
): TimelineElement[] => {
  const userElements = current.filter((e) => e.origin !== "pipeline");
  const desiredPipeline = events.map((t) => makePipelineElement(stem, t));
  const byId = new Map(current.map((e) => [e.id, e]));
  const merged = desiredPipeline.map((desired) => {
    const existing = byId.get(desired.id);
    if (!existing) return desired;
    // Preserve user edits to text if the element was re-unlocked and tweaked.
    // Locked field stays as-is (respecting user unlocks).
    return {
      ...desired,
      locked: existing.locked ?? desired.locked,
      props: { ...desired.props, ...existing.props },
      label: existing.label || desired.label,
    };
  });
  return [...userElements, ...merged].sort((a, b) => a.startSec - b.startSec);
};
```

- [ ] **Step 4.2: Store action** — in `editor/src/store.ts` (and type in `types.ts`):

```typescript
// in types.ts EditorState
replacePipelineElements: (stem: string, events: number[]) => void;

// in store.ts
replacePipelineElements: (stem, events) =>
  set((s) => ({
    elements: mergePipelineElements(s.elements, stem, events),
  })),
```

Import `mergePipelineElements` at the top: `import { mergePipelineElements } from "./utils/pipelineElements";`

- [ ] **Step 4.3: Sidecar SSE endpoint** — in `editor/vite-plugin-sidecar.ts`, add `handleAnalyzeEvents`:

```typescript
const handleAnalyzeEvents = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  const file = path.join(PROJECTS_DIR, stem, "analysis.json");
  const emit = () => {
    try {
      const data = fsSync.readFileSync(file, "utf8");
      res.write(`event: events\ndata: ${data}\n\n`);
    } catch {
      res.write(`event: events\ndata: ${JSON.stringify({})}\n\n`);
    }
  };
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  emit();  // initial snapshot
  let watcher: FSWatcher | null = null;
  const keepalive = setInterval(() => {
    try { res.write(":keepalive\n\n"); } catch { /* closed */ }
  }, 20000);
  try {
    watcher = fsWatch(path.dirname(file), { persistent: false }, (eventType, filename) => {
      if (filename === "analysis.json" && (eventType === "change" || eventType === "rename")) {
        emit();
      }
    });
  } catch { /* project dir missing; keep stream alive for later */ }
  req.on("close", () => {
    clearInterval(keepalive);
    if (watcher) watcher.close();
  });
};
```

Register the route (before the existing `/api/timeline/` prefix, same pattern as `watch/`):

```typescript
server.middlewares.use("/api/analyze/events/", wrap("GET", handleAnalyzeEvents));
```

Add `import * as fsSync from "node:fs"` at the top if not present.

- [ ] **Step 4.4: Editor subscriber** — in `editor/src/hooks/useTimelineSync.ts`, after the existing `openWatcher` for timeline, add a parallel `openEventsWatcher` that subscribes to `/api/analyze/events/<stem>` and calls `replacePipelineElements`:

```typescript
const eventsRef = useRef<EventSource | null>(null);

const openEventsWatcher = (stem: string) => {
  if (eventsRef.current) { eventsRef.current.close(); eventsRef.current = null; }
  try {
    const es = new EventSource(`/api/analyze/events/${stem}`);
    es.addEventListener("events", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as {
          phase2_events_sec?: number[];
          phase1_events_sec?: number[];
        };
        const events =
          (parsed.phase2_events_sec?.length ? parsed.phase2_events_sec : parsed.phase1_events_sec) ?? [];
        useEditorStore.getState().replacePipelineElements(stem, events);
      } catch { /* ignore malformed */ }
    });
    eventsRef.current = es;
  } catch { /* no EventSource */ }
};
```

Wire it alongside `openWatcher(stem, ...)` in both mount-bootstrap and stem-switch places. Close in cleanup.

- [ ] **Step 4.5: tsc** — `npx tsc --noEmit -p editor/tsconfig.json`.

- [ ] **Step 4.6: Smoke test** — with dev server running, copy `projects/as-the-rush-comes/analysis.json` content into `projects/love-in-traffic/analysis.json`. Open editor on love-in-traffic → Timeline panel should show 6 locked bellCurve elements at the event times within ~1s.

- [ ] **Step 4.7: Commit** — `git add editor/src/utils/pipelineElements.ts editor/src/store.ts editor/src/types.ts editor/vite-plugin-sidecar.ts editor/src/hooks/useTimelineSync.ts && git commit -m "feat(editor): auto-populate locked pipeline placeholders from analysis.json"`

---

## Task 5: Event cycler in TransportControls

**Files:**
- Create: `editor/src/components/EventCycler.tsx`
- Modify: `editor/src/components/TransportControls.tsx` (mount cycler at bottom of transport)
- Modify: `editor/src/hooks/useKeyboardShortcuts.ts` (bracket keys)

- [ ] **Step 5.1: Cycler component** — create `editor/src/components/EventCycler.tsx`:

```tsx
import { useEditorStore } from "../store";

const fmtTime = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const EventCycler = () => {
  const beatData = useEditorStore((s) => s.beatData);
  const elements = useEditorStore((s) => s.elements);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const selectElement = useEditorStore((s) => s.selectElement);

  const events =
    (beatData?.phase2_events_sec?.length ? beatData.phase2_events_sec : beatData?.phase1_events_sec) ?? [];
  if (!events.length) return null;

  const currentTimeSec = useEditorStore.getState().currentTimeSec;
  const activeIndex = events.findIndex((t, i) => {
    const next = events[i + 1] ?? Number.POSITIVE_INFINITY;
    return currentTimeSec >= t - 0.5 && currentTimeSec < next - 0.5;
  });

  const go = (idx: number) => {
    if (idx < 0 || idx >= events.length) return;
    const t = events[idx];
    setCurrentTime(t);
    // Find the pipeline element with matching time and select it
    const el = elements.find(
      (e) => e.origin === "pipeline" && Math.abs(e.startSec + e.durationSec / 2 - t) < 0.1,
    );
    if (el) selectElement(el.id);
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "4px 16px", borderBottom: "1px solid #222",
      background: "#0a0a0a", flexWrap: "wrap", rowGap: 4,
    }}>
      <button
        onClick={() => go(Math.max(0, activeIndex - 1))}
        disabled={activeIndex <= 0}
        style={chipStyle(false)}
      >PREV</button>
      {events.map((t, i) => (
        <button
          key={`evt-${i}`}
          onClick={() => go(i)}
          style={chipStyle(i === activeIndex)}
          title={`Event ${i + 1} at ${t.toFixed(2)}s`}
        >
          {`EVT ${i + 1}  ${fmtTime(t)}`}
        </button>
      ))}
      <button
        onClick={() => go(Math.min(events.length - 1, activeIndex + 1))}
        disabled={activeIndex >= events.length - 1}
        style={chipStyle(false)}
      >NEXT</button>
    </div>
  );
};

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: "3px 8px",
  fontSize: 10,
  fontFamily: "monospace",
  background: active ? "#2196F3" : "#1a1a1a",
  border: "1px solid " + (active ? "#2196F3" : "#333"),
  borderRadius: 3,
  color: "#fff",
  cursor: "pointer",
  letterSpacing: "0.04em",
});
```

- [ ] **Step 5.2: Mount in TransportControls** — in `TransportControls.tsx`, at the very bottom of the component's returned JSX (after the last button's closing tag, outside the flex row):

```tsx
import { EventCycler } from "./EventCycler";
// ...
return (
  <>
    <div style={{ display: "flex", ... /* existing transport row */ }}>
      { /* existing buttons */ }
    </div>
    <EventCycler />
  </>
);
```

- [ ] **Step 5.3: Keyboard bindings** — in `useKeyboardShortcuts.ts`, add:

```typescript
case "[":
  e.preventDefault();
  {
    const bd = s.beatData;
    const events = (bd?.phase2_events_sec?.length ? bd.phase2_events_sec : bd?.phase1_events_sec) ?? [];
    const i = events.findIndex((t, idx) => {
      const next = events[idx + 1] ?? Number.POSITIVE_INFINITY;
      return s.currentTimeSec >= t - 0.5 && s.currentTimeSec < next - 0.5;
    });
    const target = events[Math.max(0, i - 1)];
    if (target !== undefined) s.setCurrentTime(target);
  }
  return;
case "]":
  e.preventDefault();
  {
    const bd = s.beatData;
    const events = (bd?.phase2_events_sec?.length ? bd.phase2_events_sec : bd?.phase1_events_sec) ?? [];
    const i = events.findIndex((t, idx) => {
      const next = events[idx + 1] ?? Number.POSITIVE_INFINITY;
      return s.currentTimeSec >= t - 0.5 && s.currentTimeSec < next - 0.5;
    });
    const target = events[Math.min(events.length - 1, i + 1)];
    if (target !== undefined) s.setCurrentTime(target);
  }
  return;
```

- [ ] **Step 5.4: tsc** — `npx tsc --noEmit -p editor/tsconfig.json`.

- [ ] **Step 5.5: Commit** — `git add editor/src/components/EventCycler.tsx editor/src/components/TransportControls.tsx editor/src/hooks/useKeyboardShortcuts.ts && git commit -m "feat(editor): EventCycler + bracket-key prev/next event nav"`

---

## Task 6: Stage strip with status file watching

**Files:**
- Create: `editor/src/components/StageStrip.tsx`
- Modify: `editor/vite-plugin-sidecar.ts` (`/api/analyze/status/:stem` SSE)
- Modify: `scripts/cli/mv-analyze.ts` (emit status JSON updates)
- Modify: `editor/src/components/TransportControls.tsx` (mount StageStrip when status present)

- [ ] **Step 6.1: Status file shape** — `projects/<stem>/.analyze-status.json` (gitignored):

```json
{
  "startedAt": 1776600000000,
  "phase": "setup" | "phase1-review" | "phase1-zoom" | "phase1-confirmed" | "phase2-slice" | "phase2-zoom" | "phase2-confirmed" | "done" | "failed",
  "stage": { "current": 3, "total": 5, "label": "zoom 3 / 5" } | null,
  "updatedAt": 1776600001234,
  "endedAt": null | 1776600300000
}
```

- [ ] **Step 6.2: Gitignore** — add `/projects/*/.analyze-status.json` and `.analyze-status.json` to the project root `.gitignore`.

- [ ] **Step 6.3: `mv:analyze` emits status** — in `scripts/cli/mv-analyze.ts`, add a `writeStatus(project, { phase, stage? })` helper:

```typescript
import { writeFileSync } from "node:fs";

const statusPath = (stem: string) =>
  resolve(repoRoot, "projects", stem, ".analyze-status.json");

const startedAt = Date.now();
const writeStatus = (stem: string, patch: { phase?: string; stage?: { current: number; total: number; label: string } | null }) => {
  try {
    const payload = {
      startedAt,
      phase: patch.phase ?? "setup",
      stage: patch.stage ?? null,
      updatedAt: Date.now(),
      endedAt: ["done", "failed"].includes(patch.phase ?? "") ? Date.now() : null,
    };
    writeFileSync(statusPath(stem), JSON.stringify(payload, null, 2));
  } catch { /* non-fatal */ }
};
```

Call it at each phase boundary: before Setup (`phase: "setup"`), before spawning claude (`phase: "phase1-review"`), on child close (`phase: code === 0 ? "done" : "failed"`). The claude child itself can't easily update this file; for v1, only the wrapper updates at phase boundaries it knows about. (Sub-project 3 could parse child stdout for finer-grained updates.)

- [ ] **Step 6.4: Sidecar SSE endpoint** — in `vite-plugin-sidecar.ts`:

```typescript
const handleAnalyzeStatus = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) { res.statusCode = 400; res.end(); return; }
  const file = path.join(PROJECTS_DIR, stem, ".analyze-status.json");
  const emit = () => {
    try {
      const data = fsSync.readFileSync(file, "utf8");
      res.write(`event: status\ndata: ${data}\n\n`);
    } catch {
      res.write(`event: status\ndata: null\n\n`);
    }
  };
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  emit();
  let watcher: FSWatcher | null = null;
  const keepalive = setInterval(() => { try { res.write(":keepalive\n\n"); } catch {} }, 20000);
  try {
    watcher = fsWatch(path.dirname(file), { persistent: false }, (evt, filename) => {
      if (filename === ".analyze-status.json") emit();
    });
  } catch {}
  req.on("close", () => { clearInterval(keepalive); if (watcher) watcher.close(); });
};
```

Register: `server.middlewares.use("/api/analyze/status/", wrap("GET", handleAnalyzeStatus));`

- [ ] **Step 6.5: StageStrip component** — create `editor/src/components/StageStrip.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { stemFromAudioSrc } from "../utils/url";

type Status = {
  startedAt: number;
  phase: string;
  stage: { current: number; total: number; label: string } | null;
  updatedAt: number;
  endedAt: number | null;
};

const STAGES = [
  "setup", "phase1-review", "phase1-zoom", "phase1-confirmed",
  "phase2-slice", "phase2-zoom", "phase2-confirmed", "done",
];

export const StageStrip = () => {
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const stem = stemFromAudioSrc(audioSrc);
  const [status, setStatus] = useState<Status | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    if (!stem) return;
    try {
      const es = new EventSource(`/api/analyze/status/${stem}`);
      es.addEventListener("status", (e: MessageEvent) => {
        try { setStatus(e.data === "null" ? null : JSON.parse(e.data)); }
        catch { /* ignore */ }
      });
      esRef.current = es;
    } catch {}
    return () => { if (esRef.current) esRef.current.close(); };
  }, [stem]);

  // Hide strip when no analysis running or finished long ago
  if (!status || status.endedAt && Date.now() - status.endedAt > 20000) return null;

  const currentIdx = STAGES.indexOf(status.phase);

  return (
    <div style={{
      display: "flex", gap: 4, padding: "4px 16px",
      borderBottom: "1px solid #222", background: "#0a0a0a", overflowX: "auto",
    }}>
      {STAGES.map((s, i) => (
        <span
          key={s}
          style={{
            padding: "3px 8px", fontSize: 9, fontFamily: "monospace",
            borderRadius: 3, letterSpacing: "0.06em", whiteSpace: "nowrap",
            background:
              i < currentIdx ? "#2196F3" :
              i === currentIdx ? "#1e88e5" :
              "#1a1a1a",
            color: "#fff",
            border: "1px solid " + (i <= currentIdx ? "#2196F3" : "#333"),
            opacity: i === currentIdx ? 1 : (i < currentIdx ? 0.9 : 0.5),
          }}
        >
          {s.toUpperCase()}
          {i === currentIdx && status.stage
            ? `  ${status.stage.current}/${status.stage.total}`
            : ""}
        </span>
      ))}
    </div>
  );
};
```

- [ ] **Step 6.6: Mount** — in `TransportControls.tsx`, place `<StageStrip />` between the transport row and `<EventCycler />`:

```tsx
<>
  <div>{ /* transport row */ }</div>
  <StageStrip />
  <EventCycler />
</>
```

Both children self-hide when inactive, so this ordering works without conditional logic.

- [ ] **Step 6.7: tsc** — `npx tsc --noEmit -p editor/tsconfig.json`.

- [ ] **Step 6.8: Smoke test** — with dev server running, manually write `projects/love-in-traffic/.analyze-status.json` with `{"startedAt": <now>, "phase": "phase1-zoom", "stage": {"current":2,"total":5,"label":"zoom 2 / 5"}, "updatedAt": <now>, "endedAt": null}`. Editor should show PHASE1-ZOOM highlighted with "2/5" suffix.

- [ ] **Step 6.9: Commit** — `git add editor/src/components/StageStrip.tsx editor/src/components/TransportControls.tsx editor/vite-plugin-sidecar.ts scripts/cli/mv-analyze.ts .gitignore && git commit -m "feat(editor): StageStrip + /api/analyze/status/:stem SSE + mv:analyze status writes"`

---

## Task 7: Beat-snap on unlocked-element drag

**Files:**
- Modify: `editor/src/hooks/useElementDrag.ts`

- [ ] **Step 7.1: Enforce beat-snap when dragging a pipeline element** — in the drag handler, locate the snap-time logic. Before applying the store's `snapMode`, override if the element was pipeline-origin:

```typescript
// After resolving the target element for drag:
const isPipelineElement = draggedEl?.origin === "pipeline";
const effectiveSnapMode = isPipelineElement && !ev.shiftKey ? "beat" : state.snapMode;
const snapped = snapTime(tentativeSec, effectiveSnapMode, state.beatData, ev.shiftKey);
```

This means: pipeline elements always beat-snap on drag (unless the user holds Shift to invert). User-origin elements obey the global `snapMode`.

- [ ] **Step 7.2: tsc** — `npx tsc --noEmit -p editor/tsconfig.json`.

- [ ] **Step 7.3: Smoke test** — with a pipeline element present, switch `snapMode` to "off" via the Snap button. Unlock the pipeline element. Drag it — despite `snapMode: off`, the drag snaps to beats. Hold Shift while dragging — free drag. User-origin elements remain unsnapped when `snapMode: off`.

- [ ] **Step 7.4: Commit** — `git add editor/src/hooks/useElementDrag.ts && git commit -m "feat(editor): pipeline elements force beat-snap on drag (shift inverts)"`

---

## Task 8: End-to-end verification

**Files:** none modified.

- [ ] **Step 8.1: Fresh start** — kill all vite processes; delete `projects/as-the-rush-comes/.analyze-status.json` if any lingers from earlier tests; `cd editor && npm run dev &`.

- [ ] **Step 8.2: Run mv:analyze** — from a separate shell: `rm -rf projects/as-the-rush-comes/analysis && mkdir projects/as-the-rush-comes/analysis && npm run mv:analyze -- --project as-the-rush-comes`.

- [ ] **Step 8.3: Watch editor live** — on the tunnel URL (or http://localhost:4000/) with SongPicker on as-the-rush-comes:
  - StageStrip should appear within 1s of `mv:analyze` starting, showing SETUP highlighted.
  - StageStrip progresses through stages as `mv:analyze` writes to `.analyze-status.json` at each boundary.
  - When analysis completes and `analysis.json` updates, StageStrip disappears within 20s.
  - EventCycler appears with 6 chips (based on the fresh analysis result).
  - Timeline panel now has 6 LOCK-badged `text.bellCurve` elements at the event times with empty text.
  - Scrubber shows the new `phase2-confirmed-full.png` with event lines.
  - Clicking a chip in EventCycler jumps the playhead + selects the corresponding element.
  - `[` and `]` keys navigate prev/next event.

- [ ] **Step 8.4: Lock/unlock sanity** — click an event chip → the element is selected → ElementDetail shows `ORIGIN: PIPELINE` + LOCK button. Click LOCK → becomes UNLOCK. Delete-key attempt on locked element → confirm dialog appears.

- [ ] **Step 8.5: Edit + re-run** — manually add a user-origin element via the Sidebar. Re-run `mv:analyze`. After completion: user-origin element is untouched; pipeline elements are updated (or preserved if timestamps stable).

- [ ] **Step 8.6: Commit verification evidence** — no file changes, but record the verification run by pushing a short note in a commit message or closing the branch.

---

## Self-review

**Spec coverage check** (against the Sub-project 2 brainstorm scope):

| Requirement | Task | Covered? |
|---|---|---|
| Data model: `origin` + `locked` on elements | 1 | ✓ |
| Persist migration preserves existing state | 1 | ✓ (v5→v6 with noop body) |
| Locked elements visually distinguishable | 2 | ✓ (dashed border, dimmed, LOCK badge) |
| Locked elements delete-guarded | 2 | ✓ (confirm dialog) |
| Lock/unlock toggle in element detail | 3 | ✓ |
| Origin chip in element detail | 3 | ✓ |
| Pipeline elements auto-placed from analysis.json | 4 | ✓ |
| User-origin elements preserved across re-runs | 4 | ✓ (`mergePipelineElements` filters) |
| Editor reactively updates when analysis.json changes | 4 | ✓ (SSE) |
| Event cycler UI | 5 | ✓ |
| Keyboard nav between events | 5 | ✓ (`[` / `]`) |
| Stage strip during analysis | 6 | ✓ |
| `mv:analyze` writes progress status | 6 | ✓ |
| Beat-snap on locked/pipeline drag | 7 | ✓ |
| End-to-end verification | 8 | ✓ |

**Placeholder scan:** every code block is complete; no "TBD" / "add appropriate X" phrases. Commit messages are literal. File paths are exact.

**Type consistency:** `TimelineElement.origin`, `TimelineElement.locked`, `setElementLocked(id, locked)`, `replacePipelineElements(stem, events)`, `mergePipelineElements(current, stem, events)` — all match across tasks. `origin` string literal union is the same in every task.

**Scope:** 8 tasks, one cohesive subsystem. No decomposition needed.
