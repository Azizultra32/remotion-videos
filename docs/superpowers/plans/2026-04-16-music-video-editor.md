# Music Video Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a custom React editor app with waveform display, beat/drop markers, draggable timeline elements, and live Remotion Player preview — purpose-built for beat-matched music video creation.

**Architecture:** Separate React app (Vite) that imports compositions from the Remotion project. Uses `@remotion/player` for live preview, `wavesurfer.js` for audio waveform, and custom timeline tracks for element positioning. Beat/drop data from `public/dubfire-beats.json` drives markers and auto-detection.

**Tech Stack:** React 19, Vite, @remotion/player, wavesurfer.js, Zustand (state), TypeScript

> **Architecture note (Path B):** Considered Editor Starter ($600) / Timeline commercial products — chose greenfield + aggressive pattern lifting from official Remotion templates instead (see `template-music-visualization` citations throughout).

---

## Risks & Compatibility

- **rAF/GSAP libs break determinism.** Magic UI / React Bits components from the `animated-component-libraries` skill drive animation via `requestAnimationFrame` or GSAP tweens. That is fine inside the editor UI (timeline, sidebar, detail panel), but it **will break Remotion's frame-deterministic seek** if used inside a rendered composition. For any visual element that ends up in the final MP4, port the animation to `interpolate(frame, ...)` or `spring({ frame, fps })`. Keep a hard mental line: editor chrome = rAF OK, rendered composition = frame-driven only.

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

**Player ref API reference** (https://www.remotion.dev/docs/player/api):
- Imperative methods on `PlayerRef`: `seekTo(frame)`, `getCurrentFrame()`, `play()`, `pause()`, `toggle()`, `isPlaying()`, `mute()`, `unmute()`.
- Subscribable events via `addEventListener` / `removeEventListener`:
  - `frameupdate` — fires every frame during playback, payload `{ detail: { frame: number } }`. Use this to drive the timeline playhead from inside the Player.
  - `timeupdate` — fires at a throttled rate (~250ms) with playback time in seconds. Cheaper than `frameupdate` for non-critical UI (e.g. transport time readout).
  - `seeked` — fires once after a `seekTo()` completes. Use this to confirm the Player has arrived before re-enabling a scrubbing UI.
  - Also: `play`, `pause`, `ended`, `ratechange`, `volumechange`, `fullscreenchange`, `mutechange`.
- Policy for this editor: `store.currentTimeSec` is the single source of truth. Player emits `frameupdate` → store updates → Waveform/Timeline re-read store. Waveform clicks / timeline drags write to store → `useEffect` calls `player.seekTo()`. Listen for `seeked` to clear any "scrubbing" UI flag.

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

> **Editor UI vs. rendered output — two different waveform stacks.** `template-music-visualization` proves you do **not** need wavesurfer.js for the *rendered* composition: `useWindowedAudioData` + `visualizeAudioWaveform` + `createSmoothSvgPath` from `@remotion/media-utils` produce a deterministic per-frame waveform that renders inside Remotion compositions. Keep wavesurfer.js strictly for the editor UI here — it gives us interactive scrubbing, click-to-seek, and zoom that the media-utils stack does not. When we later need a waveform *baked into the MP4*, use the media-utils approach instead. Reference: https://github.com/remotion-dev/template-music-visualization/blob/main/src/Visualizer/Waveform.tsx.

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

- [ ] **Step 4: Steal `processFrequencyData` verbatim into `editor/src/utils/audio.ts`**

The music-visualization template ships a well-tuned log-scale + power-curve frequency normalizer. Do **not** reinvent it — paste verbatim, then re-export.

Source: https://github.com/remotion-dev/template-music-visualization/blob/main/src/helpers/process-frequency-data.ts

```ts
// editor/src/utils/audio.ts
// Verbatim from template-music-visualization (see citation above).
// Takes raw FFT magnitudes, remaps to log-frequency bins, applies a power curve
// for perceptual weighting, and returns a fixed-length bar array.
export { processFrequencyData } from "./process-frequency-data.ts";
```

Create `editor/src/utils/process-frequency-data.ts` with the exact file contents from the template. This feeds both the drop-marker energy cue (Step 5 below) and the SpectrumDisplay (Task 9).

- [ ] **Step 5: Adapt `BassOverlay` pattern as the drop-marker visual cue**

The template's `BassOverlay` maps low-band amplitude → full-screen opacity flash ("kick punch"). In the editor we reuse the **same signal-to-opacity mapping** but paint it into the timeline lane above each drop marker so the eye can see the drop intensity, not just its position.

Source: https://github.com/remotion-dev/template-music-visualization/blob/main/src/Visualizer/BassOverlay.tsx

Port the low-band extraction + opacity curve from `BassOverlay` into a new `DropPulse` component inside `BeatMarkers.tsx`:

```tsx
// Inside BeatMarkers.tsx, alongside the drop <line> renderer:
// For each drop timestamp, compute bass amplitude at that moment from beatData.energy,
// use the same normalization curve as BassOverlay (clamp + power), and render an
// amplitude-scaled halo behind the red drop line so bigger drops glow harder.
```

This is visual-only (editor UI), so rAF-style work is fine here — but keep the actual math pure (amplitude → opacity) so it's portable to a rendered composition later.

- [ ] **Step 6: Commit**

```bash
git add editor/src/components/Waveform.tsx editor/src/components/BeatMarkers.tsx \
        editor/src/hooks/useBeatData.ts editor/src/utils/audio.ts \
        editor/src/utils/process-frequency-data.ts
git commit -m "feat(editor): waveform + beat/drop markers (lifted processFrequencyData + BassOverlay pattern from music-viz template)"
```

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

---

### Task 11: Pulse-Pattern Library (Additive + Subtractive Springs)

**Files:**
- Create: `editor/src/utils/pulses.ts`
- Create: `editor/tests/pulses.test.ts`
- Modify: `editor/src/types.ts` (add `PulseName` type)
- Modify: `editor/src/components/Sidebar.tsx` (expose pulse presets)
- Modify: `editor/src/hooks/useElementDrag.ts` (auto-snap-to-nearest-beat on drop of a pulse)

**Background.** Decoded from the user's Remotion Timing Editor config: the "pop and release" envelope is produced by **stacking two springs**:
- Spring A — additive, delay 0 frames (the attack)
- Spring B — subtractive, delay ~77 frames (the release)
The sum is a curve that rises fast, overshoots, then pulls back to zero. That is the canonical kick/drop envelope. Build a named library so users drag a pulse onto the timeline instead of hand-tuning damping sliders.

- [ ] **Step 1: Write the failing test**

```ts
// editor/tests/pulses.test.ts
import { describe, it, expect } from "vitest";
import { kickPulse, snarePulse, dropSwell } from "../src/utils/pulses";

describe("pulse curves", () => {
  it("kickPulse peaks shortly after frame 0 and returns near 0 by frame 60", () => {
    const fps = 30;
    const v0 = kickPulse({ frame: 0, fps });
    const vPeak = kickPulse({ frame: 8, fps });
    const vEnd = kickPulse({ frame: 60, fps });
    expect(v0).toBeCloseTo(0, 2);
    expect(vPeak).toBeGreaterThan(0.5);
    expect(Math.abs(vEnd)).toBeLessThan(0.1);
  });

  it("snarePulse is sharper than kickPulse (earlier peak)", () => {
    const fps = 30;
    const kickAt5 = kickPulse({ frame: 5, fps });
    const snareAt5 = snarePulse({ frame: 5, fps });
    expect(snareAt5).toBeGreaterThan(kickAt5);
  });

  it("dropSwell is wider (still elevated at frame 90)", () => {
    const fps = 30;
    expect(dropSwell({ frame: 90, fps })).toBeGreaterThan(0.2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run tests/pulses.test.ts`
Expected: FAIL with "Cannot find module '../src/utils/pulses'".

- [ ] **Step 3: Implement `pulses.ts` with the additive + subtractive spring stack**

```ts
// editor/src/utils/pulses.ts
import { spring } from "remotion";

type PulseArgs = { frame: number; fps: number };
type PulseConfig = {
  // Attack spring (additive, delay 0).
  attack: { damping: number; stiffness: number; mass: number };
  // Release spring (subtractive, delay in frames).
  releaseDelayFrames: number;
  release: { damping: number; stiffness: number; mass: number };
};

const evaluate = (cfg: PulseConfig, { frame, fps }: PulseArgs): number => {
  const a = spring({
    frame,
    fps,
    config: cfg.attack,
    durationInFrames: 240,
  });
  const b = spring({
    frame: Math.max(0, frame - cfg.releaseDelayFrames),
    fps,
    config: cfg.release,
    durationInFrames: 240,
  });
  // Additive attack minus subtractive release = pop-and-release envelope.
  return a - b;
};

export const kickPulse = (args: PulseArgs) =>
  evaluate(
    {
      attack: { damping: 10, stiffness: 200, mass: 0.5 },
      releaseDelayFrames: 8,
      release: { damping: 14, stiffness: 120, mass: 0.8 },
    },
    args,
  );

export const snarePulse = (args: PulseArgs) =>
  evaluate(
    {
      attack: { damping: 8, stiffness: 300, mass: 0.35 },
      releaseDelayFrames: 5,
      release: { damping: 12, stiffness: 180, mass: 0.6 },
    },
    args,
  );

export const dropSwell = (args: PulseArgs) =>
  // The user's decoded config: delay-0 additive + delay-77 subtractive.
  evaluate(
    {
      attack: { damping: 30, stiffness: 60, mass: 1.2 },
      releaseDelayFrames: 77,
      release: { damping: 30, stiffness: 60, mass: 1.2 },
    },
    args,
  );

export const PULSES = { kickPulse, snarePulse, dropSwell } as const;
export type PulseName = keyof typeof PULSES;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd editor && npx vitest run tests/pulses.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Extend `types.ts` with `PulseName` on elements**

```ts
// editor/src/types.ts — add to TimelineElement.props shape via a new typed variant
export type PulseElementProps = {
  pulseName: import("./utils/pulses").PulseName;
  targetField: string; // which composition prop to drive (e.g. "kickOpacity")
};
```

- [ ] **Step 6: Add pulse presets to Sidebar**

In `editor/src/components/Sidebar.tsx`, add a "Pulses" section listing the three presets. On drop, the preset creates a `TimelineElement` of `type: "effect"` with `props: { pulseName, targetField }`.

- [ ] **Step 7: Auto-bind to nearest beat in `useElementDrag.ts`**

When a newly-dropped element has `el.props.pulseName` set, snap `startSec` to the **nearest drop timestamp** if within 0.5s, else nearest beat. This is the "drag a pulse, it locks to the music" UX.

```ts
// Inside useElementDrag onMouseUp, if creating a new pulse element:
const beats = beatData?.beats ?? [];
const drops = beatData?.drops ?? [];
const nearestDrop = drops.reduce(
  (best, t) => (Math.abs(t - startSec) < Math.abs(best - startSec) ? t : best),
  drops[0] ?? Infinity,
);
const snapped =
  Math.abs(nearestDrop - startSec) < 0.5
    ? nearestDrop
    : snapToBeat(startSec, beats);
updateElement(id, { startSec: snapped });
```

- [ ] **Step 8: Wire into propsBuilder**

In `editor/src/utils/propsBuilder.ts`, for every element with `props.pulseName`, emit a per-frame function binding so the composition evaluates `PULSES[pulseName]({ frame: frame - startFrame, fps })` when rendering. (Composition-side: a generic `<PulseDriver>` component reads the binding and writes the scalar into the target field each frame.)

- [ ] **Step 9: Commit**

```bash
git add editor/src/utils/pulses.ts editor/tests/pulses.test.ts \
        editor/src/types.ts editor/src/components/Sidebar.tsx \
        editor/src/hooks/useElementDrag.ts editor/src/utils/propsBuilder.ts
git commit -m "feat(editor): pulse-pattern library (additive+subtractive spring stack) with auto-beat-snap"
```

---

### Task 12: Calculate Composition Metadata From Audio

**Files:**
- Create: `editor/src/utils/calcMetadata.ts`
- Create: `editor/tests/calcMetadata.test.ts`
- Modify: `editor/src/components/Preview.tsx` (consume computed `durationInFrames`)
- Modify: `editor/package.json` (add `mediabunny` dep)

**Background.** In `template-music-visualization`, the composition's `durationInFrames` is not hardcoded — it's derived from the audio file via the `calculateMetadata` pattern, which uses `mediabunny`'s `Input` + `computeDuration()` to read the container without decoding. This means the editor never has to ask "how long is the video?" — it reads the audio and the answer falls out.

Reference: https://github.com/remotion-dev/template-music-visualization/blob/main/src/Root.tsx (see the `calculateMetadata` prop on `<Composition>`).

- [ ] **Step 1: Install mediabunny**

```bash
cd editor && npm install mediabunny
```

- [ ] **Step 2: Write the failing test**

```ts
// editor/tests/calcMetadata.test.ts
import { describe, it, expect } from "vitest";
import { calcDurationInFramesFromAudio } from "../src/utils/calcMetadata";

describe("calcDurationInFramesFromAudio", () => {
  it("returns a positive frame count for a real audio file", async () => {
    // Use an existing fixture (public/dubfire.wav or similar).
    const url = "/dubfire.wav";
    const frames = await calcDurationInFramesFromAudio(url, 24);
    expect(frames).toBeGreaterThan(0);
    expect(Number.isInteger(frames)).toBe(true);
  });

  it("scales with fps", async () => {
    const url = "/dubfire.wav";
    const f24 = await calcDurationInFramesFromAudio(url, 24);
    const f48 = await calcDurationInFramesFromAudio(url, 48);
    expect(f48).toBeCloseTo(f24 * 2, -1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd editor && npx vitest run tests/calcMetadata.test.ts`
Expected: FAIL with "Cannot find module '../src/utils/calcMetadata'".

- [ ] **Step 4: Implement `calcMetadata.ts` using mediabunny**

```ts
// editor/src/utils/calcMetadata.ts
import { Input, UrlSource, ALL_FORMATS } from "mediabunny";

/**
 * Read an audio file's container and return its duration in seconds.
 * No decoding — uses mediabunny's lazy Input.computeDuration().
 * Pattern from: https://github.com/remotion-dev/template-music-visualization/blob/main/src/Root.tsx
 */
export const computeAudioDurationSec = async (url: string): Promise<number> => {
  const input = new Input({
    source: new UrlSource(url),
    formats: ALL_FORMATS,
  });
  const durationSec = await input.computeDuration();
  return durationSec;
};

export const calcDurationInFramesFromAudio = async (
  url: string,
  fps: number,
): Promise<number> => {
  const sec = await computeAudioDurationSec(url);
  return Math.round(sec * fps);
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd editor && npx vitest run tests/calcMetadata.test.ts`
Expected: PASS (2 tests). If the fixture path doesn't resolve in jsdom, mark the test `it.skipIf(!process.env.EDITOR_AUDIO_FIXTURE)` and provide the path via env.

- [ ] **Step 6: Consume in Preview.tsx**

Replace the hardcoded `durationInFrames={Math.round(90 * fps)}` with a value computed from the loaded audio file:

```tsx
// Inside Preview.tsx
import { useEffect, useState } from "react";
import { calcDurationInFramesFromAudio } from "../utils/calcMetadata";

// ...inside component:
const [durationInFrames, setDurationInFrames] = useState<number | null>(null);
const audioUrl = useEditorStore((s) => s.audioUrl); // add this to store

useEffect(() => {
  if (!audioUrl) return;
  let cancelled = false;
  calcDurationInFramesFromAudio(audioUrl, fps).then((f) => {
    if (!cancelled) setDurationInFrames(f);
  });
  return () => { cancelled = true; };
}, [audioUrl, fps]);

if (durationInFrames === null) return <div>Loading audio…</div>;

return (
  <Player
    ref={playerRef}
    component={PublicCut}
    // ...
    durationInFrames={durationInFrames}
    // ...
  />
);
```

Also update `compositionDuration` in the store to `durationInFrames / fps` when it resolves, so the Timeline's `visibleRange` stretches to the real audio length.

- [ ] **Step 7: Verify — load editor, confirm timeline auto-scales to the audio length**

Run: `cd editor && npx vite` → open localhost:4000 → verify timeline right-edge matches waveform right-edge, and `durationInFrames` in the Player equals `audio duration × fps`.

- [ ] **Step 8: Commit**

```bash
git add editor/src/utils/calcMetadata.ts editor/tests/calcMetadata.test.ts \
        editor/src/components/Preview.tsx editor/package.json
git commit -m "feat(editor): derive composition duration from audio via mediabunny (calculateMetadata pattern)"
```
