# Editor Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the functional gaps identified in the music video editor audit — wire editor state into composition preview, enable adding elements from a sidebar, expand the element detail panel with type-specific controls, add transport UI toggles, and persist projects to localStorage.

**Architecture:** The editor currently renders a static `PublicCut` preview using `defaultPublicCutProps`. This plan threads the timeline state through an expanded `propsBuilder` into `Preview.tsx` so timeline edits reflect in real-time. Adds a `Sidebar` for creating elements, enriches `ElementDetail` with type-specific forms, and introduces a `usePersistedState` layer backed by `localStorage`.

**Tech Stack:** React, TypeScript, Zustand, Remotion Player, Zod (validation for persisted state).

**Pre-flight check:** Before starting any task, run `git status` — if `editor/` has uncommitted changes from another terminal session, coordinate before proceeding to avoid conflicts.

---

## Task 1: Expand propsBuilder to Type-Aware Mapping

**Problem:** Current `buildProps()` only maps hardcoded labels ("AHURA", "DUBFIRE", "OMEGA"). Adding new elements via Sidebar needs a cleaner mapping that works by element.type + element.props payload.

**Files:**
- Modify: `editor/src/utils/propsBuilder.ts`

- [ ] **Step 1: Replace propsBuilder with type-aware implementation**

Replace the entire contents of `editor/src/utils/propsBuilder.ts`:

```typescript
// src/utils/propsBuilder.ts
import type { TimelineElement } from "../types";

/**
 * Map timeline elements onto a composition's props object.
 *
 * Strategy:
 *   - Elements carry a `type` and a `props` payload.
 *   - Certain well-known labels (AHURA, DUBFIRE, OMEGA) map to PublicCut fields
 *     for backward compatibility with existing timeline elements.
 *   - New elements with `props.mapTo` targeting a composition prop are merged in.
 */
export const buildProps = <T extends Record<string, unknown>>(
  elements: TimelineElement[],
  defaults: T,
): T => {
  const props: Record<string, unknown> = { ...defaults };

  for (const el of elements) {
    // Well-known label mappings (PublicCut backward compat)
    if (el.label === "AHURA") {
      props.ahuraPeak = el.startSec + el.durationSec / 2;
      props.ahuraSigma = el.durationSec / 4;
    }
    if (el.label === "DUBFIRE") {
      props.dubfireIn = el.startSec;
      if (typeof el.props.durationOverride === "number") {
        props.dubfireDur = el.props.durationOverride;
      }
    }
    if (el.label === "OMEGA") {
      props.omegaIn = el.startSec;
    }
    if (el.label === "T-MINUS-12:12") {
      props.tIn = el.startSec;
      props.minusIn = el.startSec + 0.3;
      props.twelveIn = el.startSec + 0.6;
    }

    // Generic mapping: if element declares { mapTo: "propName" } in props,
    // set the composition prop to the element's startSec.
    if (typeof el.props.mapTo === "string") {
      props[el.props.mapTo] = el.startSec;
    }
    if (typeof el.props.mapToDuration === "string") {
      props[el.props.mapToDuration] = el.durationSec;
    }
  }

  return props as T;
};
```

- [ ] **Step 2: Verify TypeScript compiles in editor**

Run: `cd editor && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add editor/src/utils/propsBuilder.ts
git commit -m "feat(editor): expand propsBuilder with type-aware mapping

- Add generic mapTo/mapToDuration props for forward-compat
- Add T-MINUS-12:12 label mapping for PublicCut title sequence
- Preserve backward compatibility with AHURA/DUBFIRE/OMEGA"
```

---

## Task 2: Wire propsBuilder Into Preview

**Problem:** `Preview.tsx` always passes `defaultPublicCutProps` — timeline edits do nothing. Fix by subscribing to elements and computing props live.

**Files:**
- Modify: `editor/src/components/Preview.tsx`

- [ ] **Step 1: Update Preview to call buildProps**

Replace the entire contents of `editor/src/components/Preview.tsx`:

```typescript
// src/components/Preview.tsx
import { Player, PlayerRef } from "@remotion/player";
import { useRef, useEffect, useCallback, useMemo } from "react";
import { useEditorStore } from "../store";
import { PublicCut, defaultPublicCutProps } from "@compositions/PublicCut";
import { buildProps } from "../utils/propsBuilder";

export const Preview = () => {
  const playerRef = useRef<PlayerRef>(null);
  const { currentTimeSec, fps, isPlaying, setCurrentTime, elements, compositionDuration } =
    useEditorStore();

  const inputProps = useMemo(
    () => buildProps(elements, defaultPublicCutProps),
    [elements],
  );

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const frame = Math.round(currentTimeSec * fps);
    player.seekTo(frame);
  }, [currentTimeSec, fps]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) player.play();
    else player.pause();
  }, [isPlaying]);

  const onFrameUpdate = useCallback(
    (e: { detail: { frame: number } }) => {
      setCurrentTime(e.detail.frame / fps);
    },
    [fps, setCurrentTime],
  );

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.addEventListener("frameupdate", onFrameUpdate as any);
    return () => player.removeEventListener("frameupdate", onFrameUpdate as any);
  }, [onFrameUpdate]);

  return (
    <Player
      ref={playerRef}
      component={PublicCut}
      inputProps={inputProps}
      compositionWidth={848}
      compositionHeight={480}
      fps={fps}
      durationInFrames={Math.round(compositionDuration * fps)}
      controls={false}
      style={{ width: "100%", maxHeight: "100%" }}
      clickToPlay={false}
    />
  );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd editor && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Manual verification in browser**

Run: `cd editor && npm run dev`
Open: `http://localhost:4000`

Then:
1. Note the initial preview render
2. Drag the AHURA element on the timeline ±3 seconds
3. Expected: The zoom animation center shifts in the preview

- [ ] **Step 4: Commit**

```bash
git add editor/src/components/Preview.tsx
git commit -m "fix(editor): wire propsBuilder into Preview for live editing

- Subscribe to elements from store and recompute inputProps via useMemo
- Use store's compositionDuration for Player durationInFrames
- Timeline edits now reflect in preview in real-time"
```

---

## Task 3: Add Snap-to-Beat Toggle to Store

**Problem:** Snap-to-beat is enforced by `useElementDrag` only via shift-key modifier — no UI toggle, state isn't persistent.

**Files:**
- Modify: `editor/src/types.ts`
- Modify: `editor/src/store.ts`
- Modify: `editor/src/hooks/useElementDrag.ts`

- [ ] **Step 1: Add snapToBeat + loopPlayback fields to EditorState**

In `editor/src/types.ts`, replace the `EditorState` type:

```typescript
export type EditorState = {
  elements: TimelineElement[];
  currentTimeSec: number;
  isPlaying: boolean;
  selectedElementId: string | null;
  beatData: BeatData | null;
  compositionDuration: number; // seconds
  fps: number;
  snapToBeat: boolean;
  loopPlayback: boolean;
  // Actions
  setCurrentTime: (t: number | ((prev: number) => number)) => void;
  setPlaying: (p: boolean) => void;
  addElement: (el: TimelineElement) => void;
  updateElement: (id: string, partial: Partial<TimelineElement>) => void;
  removeElement: (id: string) => void;
  selectElement: (id: string | null) => void;
  setBeatData: (d: BeatData) => void;
  setSnapToBeat: (s: boolean) => void;
  setLoopPlayback: (l: boolean) => void;
};
```

- [ ] **Step 2: Add actions + default state to store**

In `editor/src/store.ts`, replace the create call:

```typescript
export const useEditorStore = create<EditorState>((set) => ({
  elements: [],
  currentTimeSec: 0,
  isPlaying: false,
  selectedElementId: null,
  beatData: null,
  compositionDuration: 90,
  fps: 24,
  snapToBeat: true,
  loopPlayback: false,
  setCurrentTime: (t) => set((s) => ({ currentTimeSec: typeof t === "function" ? t(s.currentTimeSec) : t })),
  setPlaying: (p) => set({ isPlaying: p }),
  addElement: (el) => set((s) => ({ elements: [...s.elements, el] })),
  updateElement: (id, partial) =>
    set((s) => ({
      elements: s.elements.map((e) => (e.id === id ? { ...e, ...partial } : e)),
    })),
  removeElement: (id) =>
    set((s) => ({ elements: s.elements.filter((e) => e.id !== id) })),
  selectElement: (id) => set({ selectedElementId: id }),
  setBeatData: (d) => set({ beatData: d }),
  setSnapToBeat: (s) => set({ snapToBeat: s }),
  setLoopPlayback: (l) => set({ loopPlayback: l }),
}));
```

- [ ] **Step 3: Update useElementDrag to respect snapToBeat toggle**

In `editor/src/hooks/useElementDrag.ts`, find the block that handles the shift key and replace the snap logic. Locate the existing line like `const snapped = ev.shiftKey ? boundedStart : snapToBeat(boundedStart, beats);` and replace with:

```typescript
      const state2 = useEditorStore.getState();
      // shift-key inverts the current snap setting
      const shouldSnap = ev.shiftKey ? !state2.snapToBeat : state2.snapToBeat;
      const snapped = shouldSnap ? snapToBeat(boundedStart, beats) : boundedStart;
```

Note: the name `snapToBeat` is the utility function here. Avoid collision by renaming the store selector if needed — if the file imports `snapToBeat` as a utility, keep using that name and read the boolean via `state2.snapToBeat`.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd editor && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add editor/src/types.ts editor/src/store.ts editor/src/hooks/useElementDrag.ts
git commit -m "feat(editor): add snapToBeat and loopPlayback state

- Add snapToBeat (default true) and loopPlayback (default false) to store
- useElementDrag now respects snapToBeat toggle; shift inverts temporarily
- Prepares state for TransportControls toggles in next task"
```

---

## Task 4: Add Loop + Snap Toggles to TransportControls

**Problem:** No UI for snap-to-beat or playback looping. Users must use shift-drag or manually reset.

**Files:**
- Modify: `editor/src/components/TransportControls.tsx`
- Modify: `editor/src/components/Preview.tsx` (loop wiring)

- [ ] **Step 1: Add toggle buttons to TransportControls**

Replace the entire contents of `editor/src/components/TransportControls.tsx`:

```typescript
// src/components/TransportControls.tsx
import { useEditorStore } from "../store";

const toggleButtonStyle = (active: boolean) => ({
  padding: "4px 12px",
  background: active ? "#2196F3" : "#222",
  border: `1px solid ${active ? "#2196F3" : "#444"}`,
  borderRadius: 4,
  color: "#fff",
  fontSize: 11,
  cursor: "pointer" as const,
  fontWeight: 500,
});

export const TransportControls = () => {
  const {
    isPlaying,
    setPlaying,
    currentTimeSec,
    setCurrentTime,
    compositionDuration,
    fps,
    beatData,
    snapToBeat,
    setSnapToBeat,
    loopPlayback,
    setLoopPlayback,
  } = useEditorStore();

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "8px 16px",
        borderBottom: "1px solid #333",
        background: "#0a0a0a",
      }}
    >
      <button
        onClick={() => setPlaying(!isPlaying)}
        style={{
          padding: "6px 16px",
          background: isPlaying ? "#f44336" : "#4CAF50",
          border: "none",
          borderRadius: 4,
          color: "#fff",
          fontSize: 12,
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        {isPlaying ? "Pause" : "Play"}
      </button>

      <div style={{ fontSize: 12, color: "#aaa", fontFamily: "monospace" }}>
        {formatTime(currentTimeSec)} / {formatTime(compositionDuration)}
      </div>

      <div style={{ fontSize: 11, color: "#666" }}>
        Frame: {Math.round(currentTimeSec * fps)}
      </div>

      {beatData && (
        <div style={{ fontSize: 11, color: "#666" }}>
          BPM: {beatData.bpm_global.toFixed(1)}
        </div>
      )}

      <div style={{ flex: 1 }} />

      <button
        onClick={() => setSnapToBeat(!snapToBeat)}
        style={toggleButtonStyle(snapToBeat)}
        title="Snap dragged elements to beats (shift inverts)"
      >
        Snap: {snapToBeat ? "ON" : "OFF"}
      </button>

      <button
        onClick={() => setLoopPlayback(!loopPlayback)}
        style={toggleButtonStyle(loopPlayback)}
        title="Loop playback at end of composition"
      >
        Loop: {loopPlayback ? "ON" : "OFF"}
      </button>

      <button
        onClick={() => setCurrentTime(0)}
        style={{
          padding: "4px 12px",
          background: "#333",
          border: "none",
          borderRadius: 4,
          color: "#fff",
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        Reset
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Wire loopPlayback into Preview**

In `editor/src/components/Preview.tsx`, update the destructure line to include `loopPlayback`:

```typescript
  const { currentTimeSec, fps, isPlaying, setCurrentTime, elements, compositionDuration, loopPlayback } =
    useEditorStore();
```

Then replace the `<Player ...>` element with:

```typescript
    <Player
      ref={playerRef}
      component={PublicCut}
      inputProps={inputProps}
      compositionWidth={848}
      compositionHeight={480}
      fps={fps}
      durationInFrames={Math.round(compositionDuration * fps)}
      controls={false}
      style={{ width: "100%", maxHeight: "100%" }}
      clickToPlay={false}
      loop={loopPlayback}
    />
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd editor && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add editor/src/components/TransportControls.tsx editor/src/components/Preview.tsx
git commit -m "feat(editor): add snap-to-beat and loop toggles to transport

- Snap toggle controls useElementDrag snap-to-beat behavior
- Loop toggle wires into Player loop prop
- Shift-drag still temporarily inverts snap"
```

---

## Task 5: Create Sidebar with Element Library

**Problem:** No UI to add elements — users can only view existing timeline elements.

**Files:**
- Create: `editor/src/components/Sidebar.tsx`
- Modify: `editor/src/App.tsx` (mount Sidebar)

- [ ] **Step 1: Create the Sidebar component**

Create `editor/src/components/Sidebar.tsx`:

```typescript
// src/components/Sidebar.tsx
import { useEditorStore } from "../store";
import type { ElementType, TimelineElement } from "../types";

const newId = () => `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Preset = {
  label: string;
  type: ElementType;
  durationSec: number;
  trackIndex: number;
  props: Record<string, unknown>;
  description: string;
};

const presets: Preset[] = [
  {
    label: "Text Block",
    type: "text",
    durationSec: 2,
    trackIndex: 0,
    props: { word: "HELLO", fontSize: 72, color: "#ffffff" },
    description: "Animated title word",
  },
  {
    label: "Image",
    type: "image",
    durationSec: 3,
    trackIndex: 1,
    props: { src: "public-cut.jpeg", opacity: 1, scale: 1 },
    description: "Static image reveal",
  },
  {
    label: "Effect",
    type: "effect",
    durationSec: 1,
    trackIndex: 2,
    props: { effect: "zoom", intensity: 1 },
    description: "Generic visual effect",
  },
  {
    label: "Beat Flash",
    type: "beat-flash",
    durationSec: 0.2,
    trackIndex: 2,
    props: { color: "#ffffff", intensity: 0.8 },
    description: "Brief flash on a beat",
  },
];

export const Sidebar = () => {
  const { addElement, currentTimeSec, selectElement } = useEditorStore();

  const handleAdd = (preset: Preset) => {
    const el: TimelineElement = {
      id: newId(),
      label: preset.label.toUpperCase(),
      type: preset.type,
      trackIndex: preset.trackIndex,
      startSec: Math.max(0, currentTimeSec),
      durationSec: preset.durationSec,
      props: { ...preset.props },
    };
    addElement(el);
    selectElement(el.id);
  };

  return (
    <div
      style={{
        width: 200,
        borderRight: "1px solid #333",
        background: "#0a0a0a",
        padding: 12,
        overflowY: "auto",
      }}
    >
      <h3 style={{ margin: "0 0 12px 0", fontSize: 12, fontWeight: 600, color: "#aaa" }}>
        ELEMENTS
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => handleAdd(p)}
            style={{
              padding: "8px 10px",
              background: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 4,
              color: "#fff",
              fontSize: 11,
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontWeight: 600 }}>+ {p.label}</span>
            <span style={{ fontSize: 10, color: "#888" }}>{p.description}</span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16, fontSize: 10, color: "#666", lineHeight: 1.4 }}>
        Click to add at current playhead time. Drag on timeline to move. Configure in right panel.
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Mount Sidebar in App.tsx**

Read `editor/src/App.tsx` first, then add the import at top near other component imports:

```typescript
import { Sidebar } from "./components/Sidebar";
```

Locate the layout container in the JSX — the main flex row that holds Preview, Timeline, ElementDetail. Add `<Sidebar />` as the first child of that row (leftmost column), wrapped in an `ErrorBoundary`:

```typescript
<ErrorBoundary name="Sidebar">
  <Sidebar />
</ErrorBoundary>
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd editor && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Manual verification**

Run: `cd editor && npm run dev`

1. Open `http://localhost:4000`
2. Click "+ Text Block" in the left sidebar
3. Expected: New "TEXT BLOCK" element appears on Timeline at current playhead time
4. Expected: New element is selected (visible in ElementDetail panel)

- [ ] **Step 5: Commit**

```bash
git add editor/src/components/Sidebar.tsx editor/src/App.tsx
git commit -m "feat(editor): add Sidebar with element library

- Four element presets: Text, Image, Effect, Beat Flash
- Click to add at current playhead time
- Newly added element auto-selects for immediate editing"
```

---

## Task 6: Type-Specific Controls in ElementDetail

**Problem:** ElementDetail has only 3 generic fields (label, startSec, durationSec). Plan called for per-type forms.

**Files:**
- Modify: `editor/src/components/ElementDetail.tsx`

- [ ] **Step 1: Replace ElementDetail with type-aware forms**

Replace the entire contents of `editor/src/components/ElementDetail.tsx`:

```typescript
// src/components/ElementDetail.tsx
import { useEditorStore } from "../store";
import type { TimelineElement } from "../types";

const fieldStyle: React.CSSProperties = {
  padding: "6px 8px",
  background: "#222",
  border: "1px solid #444",
  borderRadius: 4,
  color: "#fff",
  fontSize: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#aaa",
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span style={labelStyle}>{label}</span>
    {children}
  </label>
);

const TextControls = ({ element }: { element: TimelineElement }) => {
  const { updateElement } = useEditorStore();
  const word = typeof element.props.word === "string" ? element.props.word : "";
  const fontSize = typeof element.props.fontSize === "number" ? element.props.fontSize : 72;
  const color = typeof element.props.color === "string" ? element.props.color : "#ffffff";

  const setProp = (k: string, v: unknown) =>
    updateElement(element.id, { props: { ...element.props, [k]: v } });

  return (
    <>
      <Field label="Word / Text">
        <input
          type="text"
          value={word}
          onChange={(e) => setProp("word", e.target.value)}
          style={fieldStyle}
        />
      </Field>
      <Field label={`Font Size (${fontSize}px)`}>
        <input
          type="range"
          min={12}
          max={200}
          step={1}
          value={fontSize}
          onChange={(e) => setProp("fontSize", parseInt(e.target.value, 10))}
        />
      </Field>
      <Field label="Color">
        <input
          type="color"
          value={color}
          onChange={(e) => setProp("color", e.target.value)}
          style={{ ...fieldStyle, padding: 2, height: 28 }}
        />
      </Field>
    </>
  );
};

const ImageControls = ({ element }: { element: TimelineElement }) => {
  const { updateElement } = useEditorStore();
  const src = typeof element.props.src === "string" ? element.props.src : "";
  const opacity = typeof element.props.opacity === "number" ? element.props.opacity : 1;
  const scale = typeof element.props.scale === "number" ? element.props.scale : 1;

  const setProp = (k: string, v: unknown) =>
    updateElement(element.id, { props: { ...element.props, [k]: v } });

  return (
    <>
      <Field label="Source (path in public/)">
        <input
          type="text"
          value={src}
          onChange={(e) => setProp("src", e.target.value)}
          placeholder="public-cut.jpeg"
          style={fieldStyle}
        />
      </Field>
      <Field label={`Opacity (${opacity.toFixed(2)})`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setProp("opacity", parseFloat(e.target.value))}
        />
      </Field>
      <Field label={`Scale (${scale.toFixed(2)}x)`}>
        <input
          type="range"
          min={0.1}
          max={3}
          step={0.05}
          value={scale}
          onChange={(e) => setProp("scale", parseFloat(e.target.value))}
        />
      </Field>
    </>
  );
};

const EffectControls = ({ element }: { element: TimelineElement }) => {
  const { updateElement } = useEditorStore();
  const effect = typeof element.props.effect === "string" ? element.props.effect : "zoom";
  const intensity = typeof element.props.intensity === "number" ? element.props.intensity : 1;

  const setProp = (k: string, v: unknown) =>
    updateElement(element.id, { props: { ...element.props, [k]: v } });

  return (
    <>
      <Field label="Effect Type">
        <select
          value={effect}
          onChange={(e) => setProp("effect", e.target.value)}
          style={fieldStyle}
        >
          <option value="zoom">Zoom</option>
          <option value="fade">Fade</option>
          <option value="shake">Shake</option>
          <option value="glow">Glow</option>
          <option value="blur">Blur</option>
        </select>
      </Field>
      <Field label={`Intensity (${intensity.toFixed(2)})`}>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={intensity}
          onChange={(e) => setProp("intensity", parseFloat(e.target.value))}
        />
      </Field>
    </>
  );
};

const BeatFlashControls = ({ element }: { element: TimelineElement }) => {
  const { updateElement } = useEditorStore();
  const color = typeof element.props.color === "string" ? element.props.color : "#ffffff";
  const intensity = typeof element.props.intensity === "number" ? element.props.intensity : 0.8;

  const setProp = (k: string, v: unknown) =>
    updateElement(element.id, { props: { ...element.props, [k]: v } });

  return (
    <>
      <Field label="Flash Color">
        <input
          type="color"
          value={color}
          onChange={(e) => setProp("color", e.target.value)}
          style={{ ...fieldStyle, padding: 2, height: 28 }}
        />
      </Field>
      <Field label={`Intensity (${intensity.toFixed(2)})`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={intensity}
          onChange={(e) => setProp("intensity", parseFloat(e.target.value))}
        />
      </Field>
    </>
  );
};

export const ElementDetail = () => {
  const { selectedElementId, elements, updateElement, removeElement } = useEditorStore();
  const element = elements.find((e) => e.id === selectedElementId);

  if (!element) {
    return (
      <div style={{ padding: 16, color: "#888", fontSize: 12 }}>
        No element selected. Click an element on the timeline to edit.
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          {element.label}{" "}
          <span style={{ color: "#666", fontWeight: 400 }}>({element.type})</span>
        </h3>
        <button
          onClick={() => removeElement(element.id)}
          style={{
            padding: "4px 10px",
            background: "#4a1a1a",
            border: "1px solid #833",
            borderRadius: 4,
            color: "#f88",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Delete
        </button>
      </div>

      <Field label="Label">
        <input
          type="text"
          value={element.label}
          onChange={(e) => updateElement(element.id, { label: e.target.value })}
          style={fieldStyle}
        />
      </Field>

      <Field label="Start Time (sec)">
        <input
          type="number"
          step="0.1"
          min={0}
          value={element.startSec}
          onChange={(e) =>
            updateElement(element.id, { startSec: parseFloat(e.target.value) || 0 })
          }
          style={fieldStyle}
        />
      </Field>

      <Field label="Duration (sec)">
        <input
          type="number"
          step="0.1"
          min={0.05}
          value={element.durationSec}
          onChange={(e) =>
            updateElement(element.id, { durationSec: parseFloat(e.target.value) || 0.05 })
          }
          style={fieldStyle}
        />
      </Field>

      <div style={{ height: 1, background: "#333", margin: "4px 0" }} />

      {element.type === "text" && <TextControls element={element} />}
      {element.type === "image" && <ImageControls element={element} />}
      {element.type === "effect" && <EffectControls element={element} />}
      {element.type === "beat-flash" && <BeatFlashControls element={element} />}
    </div>
  );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd editor && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Manual verification**

Run: `cd editor && npm run dev`

1. Click `+ Text Block` in Sidebar
2. Select the new element on timeline
3. Expected: ElementDetail shows word/fontSize/color controls in addition to label/start/duration
4. Change the color — no error, element.props.color updates
5. Click Delete — element removed from timeline

- [ ] **Step 4: Commit**

```bash
git add editor/src/components/ElementDetail.tsx
git commit -m "feat(editor): add type-specific controls to ElementDetail

- Text: word input, font size slider, color picker
- Image: source path, opacity slider, scale slider
- Effect: effect type dropdown, intensity slider
- Beat Flash: color picker, intensity slider
- Delete button for all element types"
```

---

## Task 7: Persist Editor Project to localStorage

**Problem:** Closing the browser loses all work. No save/load.

**Files:**
- Modify: `editor/src/store.ts` (add persist middleware)

- [ ] **Step 1: Add zustand/middleware persist**

Check if `zustand` is a direct dep (not just transitive): `cd editor && npm ls zustand`. If needed install: `cd editor && npm install zustand`.

The `persist` middleware ships with zustand — no new dep required.

- [ ] **Step 2: Wrap the store with persist**

Replace the entire contents of `editor/src/store.ts`:

```typescript
// src/store.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { EditorState } from "./types";

export const useEditorStore = create<EditorState>()(
  persist(
    (set) => ({
      elements: [],
      currentTimeSec: 0,
      isPlaying: false,
      selectedElementId: null,
      beatData: null,
      compositionDuration: 90,
      fps: 24,
      snapToBeat: true,
      loopPlayback: false,
      setCurrentTime: (t) =>
        set((s) => ({
          currentTimeSec: typeof t === "function" ? t(s.currentTimeSec) : t,
        })),
      setPlaying: (p) => set({ isPlaying: p }),
      addElement: (el) => set((s) => ({ elements: [...s.elements, el] })),
      updateElement: (id, partial) =>
        set((s) => ({
          elements: s.elements.map((e) => (e.id === id ? { ...e, ...partial } : e)),
        })),
      removeElement: (id) =>
        set((s) => ({ elements: s.elements.filter((e) => e.id !== id) })),
      selectElement: (id) => set({ selectedElementId: id }),
      setBeatData: (d) => set({ beatData: d }),
      setSnapToBeat: (s) => set({ snapToBeat: s }),
      setLoopPlayback: (l) => set({ loopPlayback: l }),
    }),
    {
      name: "music-video-editor",
      storage: createJSONStorage(() => localStorage),
      // Persist only user-editable fields — exclude transient playback state
      partialize: (s) => ({
        elements: s.elements,
        compositionDuration: s.compositionDuration,
        fps: s.fps,
        snapToBeat: s.snapToBeat,
        loopPlayback: s.loopPlayback,
      }),
      version: 1,
    },
  ),
);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd editor && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Manual verification**

Run: `cd editor && npm run dev`

1. Add 2 elements via Sidebar at different times
2. Toggle Loop ON
3. Refresh the browser
4. Expected: Both elements still present, Loop toggle still ON
5. Open DevTools → Application → localStorage → `music-video-editor` key shows JSON

- [ ] **Step 5: Commit**

```bash
git add editor/src/store.ts
git commit -m "feat(editor): persist editor state to localStorage

- Zustand persist middleware saves elements, toggles, and composition settings
- Excludes transient playback state (currentTime, isPlaying, selection)
- Survives browser refresh and restart
- Version 1 for future schema migrations"
```

---

## Task 8: Final Integration Verification

**Problem:** After closing all gaps, confirm the editor actually works end-to-end.

**Files:**
- None (verification only)

- [ ] **Step 1: Full manual E2E walkthrough**

Run: `cd editor && npm run dev`

Go through this checklist:
1. ☐ Sidebar renders on left with 4 element presets
2. ☐ Timeline renders with tracks and playhead
3. ☐ Preview renders PublicCut composition
4. ☐ TransportControls show Play, time, BPM, Snap toggle, Loop toggle, Reset
5. ☐ Click "+ Text Block" → element appears on timeline at playhead, is selected
6. ☐ ElementDetail shows text-specific controls (word, fontSize, color)
7. ☐ Drag element on timeline → Preview input props update (scrub Preview and note change)
8. ☐ Toggle Snap OFF → drag becomes pixel-precise
9. ☐ Toggle Loop ON → play to end → playback resumes from 0
10. ☐ Refresh browser → elements + toggles restored from localStorage
11. ☐ Click Delete on an element → removed from timeline

- [ ] **Step 2: Run TypeScript across both apps**

```bash
cd /Users/ali/remotion-videos && npx tsc --noEmit
cd /Users/ali/remotion-videos/editor && npx tsc --noEmit
```

Expected: No errors in either.

- [ ] **Step 3: Final commit with verification summary**

If any follow-ups surfaced during E2E, capture them as a final commit. Otherwise:

```bash
git commit --allow-empty -m "chore: editor gap closure verified end-to-end

All 8 closure tasks complete. Editor is functional:
- Timeline edits reflect live in composition preview
- Sidebar adds elements
- ElementDetail has type-specific controls
- Snap/Loop toggles work
- State persists across browser restarts"
```

- [ ] **Step 4: Push to remote**

```bash
git push origin main
```

---

## Execution Complete

All gaps identified in the audit are closed:

1. ✅ Editor ↔ Composition wired via propsBuilder
2. ✅ Sidebar with element library
3. ✅ Type-specific ElementDetail controls (text, image, effect, beat-flash)
4. ✅ Snap-to-beat + Loop toggles in TransportControls
5. ✅ Project persistence in localStorage
6. ✅ Shader preset enum already honestly scoped to ["sonar"] (no action needed)

**Deferred (not in scope):**
- Implementing spectrum/tunnel shader presets (separate feature)
- Beat detection script backup-before-overwrite (separate ops concern)
- Editor file selector UI for beat files (can use URL query param for now)
