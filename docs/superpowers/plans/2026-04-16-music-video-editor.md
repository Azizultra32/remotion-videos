# Music Video Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a custom React editor app with waveform display, beat/drop markers, draggable timeline elements, and live Remotion Player preview — purpose-built for beat-matched music video creation.

**Architecture:** Separate React app (Vite) that imports compositions from the Remotion project. Uses `@remotion/player` for live preview, `wavesurfer.js` for audio waveform, and custom timeline tracks for element positioning. Beat/drop data from `public/dubfire-beats.json` drives markers and auto-detection.

**Tech Stack:** React 19, Vite, @remotion/player, wavesurfer.js, Zustand (state), TypeScript

---

## File Structure

```
editor/
├── package.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx                    — App entry
│   ├── App.tsx                     — Main layout (sidebar + preview + timeline)
│   ├── store.ts                    — Zustand store (timeline state, element positions, playback)
│   ├── types.ts                    — TimelineElement, BeatData, EditorState types
│   ├── components/
│   │   ├── Preview.tsx             — @remotion/player wrapper, receives props from store
│   │   ├── Waveform.tsx            — wavesurfer.js waveform with beat/drop markers
│   │   ├── Timeline.tsx            — Horizontal tracks with draggable element blocks
│   │   ├── TimelineTrack.tsx       — Single track row (text, image, effect)
│   │   ├── TimelineElement.tsx     — Draggable block on a track
│   │   ├── ElementDetail.tsx       — Click-into panel: edit words, effects, timing curves
│   │   ├── BeatMarkers.tsx         — Vertical lines on timeline for beats, bold for drops
│   │   ├── SpectrumDisplay.tsx     — Real-time spectrum bars (from visualizeAudio data)
│   │   ├── TransportControls.tsx   — Play/pause/seek/frame counter
│   │   └── Sidebar.tsx             — Element library (add text, image, effect blocks)
│   ├── hooks/
│   │   ├── useBeatData.ts          — Load and parse beats.json
│   │   ├── usePlaybackSync.ts      — Sync wavesurfer position ↔ Remotion Player frame
│   │   └── useElementDrag.ts       — Drag handler for timeline elements
│   └── utils/
│       ├── time.ts                 — seconds↔frames conversion, snap-to-beat
│       └── propsBuilder.ts         — Convert editor state → Remotion composition props
```

---

### Task 1: Scaffold Vite + React App

**Files:**
- Create: `editor/package.json`
- Create: `editor/vite.config.ts`
- Create: `editor/index.html`
- Create: `editor/src/main.tsx`
- Create: `editor/src/App.tsx`

- [ ] **Step 1: Create editor directory and init**

```bash
mkdir -p editor/src
cd editor
npm init -y
npm install react@19 react-dom@19 @remotion/player@4.0.434 remotion@4.0.434 zustand wavesurfer.js typescript @types/react @types/react-dom
npm install -D vite @vitejs/plugin-react
```

- [ ] **Step 2: Create vite.config.ts**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@compositions": "../src/compositions" },
  },
  server: { port: 4000 },
});
```

- [ ] **Step 3: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Music Video Editor</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 4: Create main.tsx + App.tsx shell**

```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";
createRoot(document.getElementById("root")!).render(<App />);
```

```tsx
// src/App.tsx
export const App = () => (
  <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gridTemplateRows: "1fr 200px", height: "100vh", background: "#111", color: "#fff" }}>
    <div style={{ gridRow: "1/3", borderRight: "1px solid #333", padding: 16 }}>Sidebar</div>
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>Preview</div>
    <div style={{ borderTop: "1px solid #333" }}>Timeline</div>
  </div>
);
```

- [ ] **Step 5: Verify it runs**

```bash
cd editor && npx vite
# Opens localhost:4000 — should show 3-panel layout
```

- [ ] **Step 6: Commit**

```bash
git add editor/
git commit -m "feat: scaffold music video editor (Vite + React)"
```

---

### Task 2: Zustand Store + Types

**Files:**
- Create: `editor/src/types.ts`
- Create: `editor/src/store.ts`

- [ ] **Step 1: Define types**

```ts
// src/types.ts
export type ElementType = "text" | "image" | "effect" | "beat-flash";

export type TimelineElement = {
  id: string;
  type: ElementType;
  trackIndex: number;
  startSec: number;
  durationSec: number;
  label: string;
  props: Record<string, unknown>; // element-specific (words, font, color, spring config, etc.)
};

export type BeatData = {
  duration: number;
  bpm_global: number;
  beats: number[];
  downbeats: number[];
  drops: number[];
  breakdowns: { start: number; end: number }[];
  energy: { t: number; db: number }[];
};

export type EditorState = {
  elements: TimelineElement[];
  currentTimeSec: number;
  isPlaying: boolean;
  selectedElementId: string | null;
  beatData: BeatData | null;
  compositionDuration: number; // seconds
  fps: number;
  // Actions
  setCurrentTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  addElement: (el: TimelineElement) => void;
  updateElement: (id: string, partial: Partial<TimelineElement>) => void;
  removeElement: (id: string) => void;
  selectElement: (id: string | null) => void;
  setBeatData: (d: BeatData) => void;
};
```

- [ ] **Step 2: Create Zustand store**

```ts
// src/store.ts
import { create } from "zustand";
import type { EditorState, TimelineElement, BeatData } from "./types";

export const useEditorStore = create<EditorState>((set) => ({
  elements: [],
  currentTimeSec: 0,
  isPlaying: false,
  selectedElementId: null,
  beatData: null,
  compositionDuration: 90,
  fps: 24,
  setCurrentTime: (t) => set({ currentTimeSec: t }),
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
}));
```

- [ ] **Step 3: Commit**

```bash
git add editor/src/types.ts editor/src/store.ts
git commit -m "feat: editor state management (Zustand + types)"
```

---

### Task 3: Remotion Player Preview

**Files:**
- Create: `editor/src/components/Preview.tsx`
- Modify: `editor/src/App.tsx`

- [ ] **Step 1: Create Preview component**

```tsx
// src/components/Preview.tsx
import { Player, PlayerRef } from "@remotion/player";
import { useRef, useEffect, useCallback } from "react";
import { useEditorStore } from "../store";
import { PublicCut } from "@compositions/PublicCut";

export const Preview = () => {
  const playerRef = useRef<PlayerRef>(null);
  const { currentTimeSec, fps, isPlaying, setCurrentTime, setPlaying } = useEditorStore();

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
      inputProps={useEditorStore.getState().elements.length ? {} : undefined}
      compositionWidth={848}
      compositionHeight={480}
      fps={fps}
      durationInFrames={Math.round(90 * fps)}
      controls={false}
      style={{ width: "100%", maxHeight: "100%" }}
      clickToPlay={false}
    />
  );
};
```

- [ ] **Step 2: Wire into App.tsx**

- [ ] **Step 3: Verify Player renders in browser**

- [ ] **Step 4: Commit**

---

### Task 4: Waveform + Beat Markers

**Files:**
- Create: `editor/src/components/Waveform.tsx`
- Create: `editor/src/components/BeatMarkers.tsx`
- Create: `editor/src/hooks/useBeatData.ts`

- [ ] **Step 1: Create useBeatData hook**

```ts
// src/hooks/useBeatData.ts
import { useEffect } from "react";
import { useEditorStore } from "../store";
import type { BeatData } from "../types";

export const useBeatData = (url: string) => {
  const setBeatData = useEditorStore((s) => s.setBeatData);
  useEffect(() => {
    fetch(url)
      .then((r) => r.json())
      .then((d: BeatData) => setBeatData(d));
  }, [url, setBeatData]);
};
```

- [ ] **Step 2: Create Waveform component (wavesurfer.js)**

```tsx
// src/components/Waveform.tsx
import { useRef, useEffect } from "react";
import WaveSurfer from "wavesurfer.js";
import { useEditorStore } from "../store";

export const Waveform = ({ audioUrl }: { audioUrl: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const { currentTimeSec, setCurrentTime, isPlaying } = useEditorStore();

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#444",
      progressColor: "#888",
      cursorColor: "#fff",
      height: 60,
      barWidth: 2,
      barGap: 1,
      normalize: true,
      interact: true,
    });
    ws.load(audioUrl);
    ws.on("click", (progress: number) => {
      const t = progress * ws.getDuration();
      setCurrentTime(t);
    });
    wsRef.current = ws;
    return () => ws.destroy();
  }, [audioUrl, setCurrentTime]);

  // Sync cursor position from editor state
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ws.getDuration()) return;
    const progress = currentTimeSec / ws.getDuration();
    ws.seekTo(Math.min(1, Math.max(0, progress)));
  }, [currentTimeSec]);

  return <div ref={containerRef} style={{ width: "100%", height: 60 }} />;
};
```

- [ ] **Step 3: Create BeatMarkers overlay**

```tsx
// src/components/BeatMarkers.tsx
import { useEditorStore } from "../store";

export const BeatMarkers = ({ widthPx, visibleRange }: {
  widthPx: number;
  visibleRange: [number, number]; // [startSec, endSec]
}) => {
  const beatData = useEditorStore((s) => s.beatData);
  if (!beatData) return null;
  const [start, end] = visibleRange;
  const duration = end - start;
  const toX = (t: number) => ((t - start) / duration) * widthPx;

  return (
    <svg style={{ position: "absolute", top: 0, left: 0, width: widthPx, height: "100%", pointerEvents: "none" }}>
      {/* Beat ticks (thin, subtle) */}
      {beatData.beats
        .filter((t) => t >= start && t <= end)
        .map((t, i) => (
          <line key={`b${i}`} x1={toX(t)} x2={toX(t)} y1={0} y2="100%" stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />
        ))}
      {/* Drop markers (bold red) */}
      {beatData.drops
        .filter((t) => t >= start && t <= end)
        .map((t, i) => (
          <line key={`d${i}`} x1={toX(t)} x2={toX(t)} y1={0} y2="100%" stroke="#ff4444" strokeWidth={2} />
        ))}
      {/* Breakdown regions (dark red shading) */}
      {beatData.breakdowns
        .filter((b) => b.end >= start && b.start <= end)
        .map((b, i) => (
          <rect key={`bd${i}`} x={toX(b.start)} width={toX(b.end) - toX(b.start)} y={0} height="100%" fill="rgba(255,50,50,0.1)" />
        ))}
    </svg>
  );
};
```

- [ ] **Step 4: Commit**

---

### Task 5: Timeline Tracks with Draggable Elements

**Files:**
- Create: `editor/src/components/Timeline.tsx`
- Create: `editor/src/components/TimelineTrack.tsx`
- Create: `editor/src/components/TimelineElement.tsx`
- Create: `editor/src/hooks/useElementDrag.ts`
- Create: `editor/src/utils/time.ts`

- [ ] **Step 1: Create time utilities (snap-to-beat)**

```ts
// src/utils/time.ts
export const secToFrame = (sec: number, fps: number) => Math.round(sec * fps);
export const frameToSec = (frame: number, fps: number) => frame / fps;

export const snapToBeat = (sec: number, beats: number[], threshold = 0.1): number => {
  let nearest = sec;
  let minDist = threshold;
  for (const b of beats) {
    const d = Math.abs(b - sec);
    if (d < minDist) { minDist = d; nearest = b; }
    if (b > sec + threshold) break; // beats are sorted
  }
  return nearest;
};
```

- [ ] **Step 2: Create drag handler hook**

```ts
// src/hooks/useElementDrag.ts
import { useCallback, useRef } from "react";
import { useEditorStore } from "../store";
import { snapToBeat } from "../utils/time";

export const useElementDrag = (elementId: string, pxPerSec: number) => {
  const dragStart = useRef<{ x: number; origStart: number } | null>(null);
  const { updateElement, beatData } = useEditorStore();
  const beats = beatData?.beats ?? [];

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = useEditorStore.getState().elements.find((e) => e.id === elementId);
    if (!el) return;
    dragStart.current = { x: e.clientX, origStart: el.startSec };
    const onMove = (ev: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = ev.clientX - dragStart.current.x;
      const newStart = Math.max(0, dragStart.current.origStart + dx / pxPerSec);
      const snapped = ev.shiftKey ? newStart : snapToBeat(newStart, beats);
      updateElement(elementId, { startSec: snapped });
    };
    const onUp = () => {
      dragStart.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [elementId, pxPerSec, updateElement, beats]);

  return { onMouseDown };
};
```

- [ ] **Step 3: Create Timeline, TimelineTrack, TimelineElement components**

(Full component code with draggable blocks, color-coded by element type, click-to-select)

- [ ] **Step 4: Commit**

---

### Task 6: Element Detail Panel (Nested Controls)

**Files:**
- Create: `editor/src/components/ElementDetail.tsx`

- [ ] **Step 1: Create detail panel with type-specific controls**

Click into any timeline block → shows:
- For text: word input, font size, color, spring config sliders
- For beat-flash: word list, decay rate, flash style
- For image: source selector, opacity range, zoom range
- For effect: type selector (glow, spectrum, zoom), intensity sliders

- [ ] **Step 2: Wire spring curve preview (using Remotion's timing editor as reference)**

Show a mini spring curve graph that updates as user adjusts damping/stiffness.

- [ ] **Step 3: Commit**

---

### Task 7: Transport Controls + Playback Sync

**Files:**
- Create: `editor/src/components/TransportControls.tsx`
- Create: `editor/src/hooks/usePlaybackSync.ts`

- [ ] **Step 1: Create transport bar**

Play/pause, current time display, frame counter, loop toggle, BPM display, snap-to-beat toggle.

- [ ] **Step 2: Sync wavesurfer ↔ Player bidirectionally**

When user scrubs waveform → Player seeks. When Player plays → waveform cursor follows. Single source of truth: `store.currentTimeSec`.

- [ ] **Step 3: Commit**

---

### Task 8: Props Builder (Editor State → Composition)

**Files:**
- Create: `editor/src/utils/propsBuilder.ts`

- [ ] **Step 1: Convert editor elements → PublicCut props**

```ts
// src/utils/propsBuilder.ts
import type { TimelineElement } from "../types";
import type { z } from "zod";
import { publicCutSchema } from "@compositions/PublicCut";

export const buildProps = (
  elements: TimelineElement[],
  defaults: z.infer<typeof publicCutSchema>,
): z.infer<typeof publicCutSchema> => {
  const props = { ...defaults };
  for (const el of elements) {
    if (el.label === "AHURA") {
      props.ahuraPeak = el.startSec + el.durationSec / 2;
      props.ahuraSigma = el.durationSec / 4;
    }
    if (el.label === "DUBFIRE") props.dubfireIn = el.startSec;
    if (el.label === "OMEGA") props.omegaIn = el.startSec;
    // ... map all elements to props
  }
  return props;
};
```

- [ ] **Step 2: Wire into Preview component (rebuilds props on every store change)**

- [ ] **Step 3: Verify: drag element on timeline → preview updates in real-time**

- [ ] **Step 4: Commit**

---

### Task 9: Spectrum Display

**Files:**
- Create: `editor/src/components/SpectrumDisplay.tsx`

- [ ] **Step 1: Real-time spectrum from beat data energy curve**

Show bass energy as a colored strip under the waveform — green=quiet, yellow=building, red=peak. Drops marked with vertical flash lines.

- [ ] **Step 2: Commit**

---

### Task 10: Integration Test

- [ ] **Step 1: Load editor at localhost:4000**
- [ ] **Step 2: Verify waveform loads with audio**
- [ ] **Step 3: Verify beat markers align with audio**
- [ ] **Step 4: Verify drops are marked red**
- [ ] **Step 5: Add AHURA element, drag it on timeline**
- [ ] **Step 6: Verify Player preview updates as element moves**
- [ ] **Step 7: Click into element, adjust timing**
- [ ] **Step 8: Play — verify waveform cursor + Player stay in sync**
- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "feat: music video editor v1 — waveform, beats, draggable timeline, live preview"
```
