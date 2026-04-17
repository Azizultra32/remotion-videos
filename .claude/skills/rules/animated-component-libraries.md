---
name: animated-component-libraries
description: Use when picking pre-built React components for the editor UI or for Remotion compositions — covers Clippkit/Magic UI/React Bits/shadcn/dnd-kit/wavesurfer compatibility and install commands
---

# Animated Component Libraries

## Overview

Catalog of pre-built React component libraries for this Remotion project, split by whether they are safe inside a `<Composition>` (render path) or only in editor UI (`editor/`). Picking the wrong one silently breaks frame-deterministic renders.

## Compatibility Rule (CRITICAL — Remotion determinism)

Remotion seeks to arbitrary frames and re-calls your component. Anything driven by wall-clock time produces different output per seek → non-deterministic renders.

- **SAFE in compositions**: driven by `useCurrentFrame()` + `interpolate()` / `spring()`.
- **UNSAFE in compositions (editor UI only)**: `requestAnimationFrame`, `setTimeout`, `setInterval`, GSAP, Framer Motion's internal clock, `useMotionValue` + `animate()`, Anime.js.
- **Fix**: port animated values to `interpolate(useCurrentFrame(), [startFrame, endFrame], [from, to])` before using in a composition.

Editor chrome doesn't render to video, so any library is fine there.

## Library Index

| Library | Status | License | Best for |
|---|---|---|---|
| Clippkit | Remotion-native (`useCurrentFrame`) | "free, credit appreciated" | Rendered video text FX, waveform |
| Magic UI | shadcn-style copy-paste, Framer Motion | MIT (verify per component) | Editor text; render path after porting |
| React Bits | shadcn/jsrepo CLI, GSAP/RAF | MIT + Commons Clause | Mostly editor; render needs frame-binding |
| shadcn/ui | React primitives, no clock | MIT | Editor chrome (sliders, dialogs) |
| dnd-kit | Drag-and-drop | MIT | Timeline draggable blocks |
| wavesurfer.js | Audio waveform | BSD-3 | Editor waveform display |

## Top Picks — Rendered Video (`<Composition>`)

1. **Clippkit** — `TypingText`, `GlitchText`, `PoppingText`, `SlidingText`, `AudioWaveform`. Drop-in.
2. **Magic UI** (port first) — Text Animate, Sparkles Text, Aurora Text, Retro Grid, Flickering Grid.
3. **React Bits** (high-effort port) — SplitText, DecryptedText.

## Top Picks — Editor UI (`editor/`)

1. **shadcn/ui** — Slider, Dialog, Tabs, ScrollArea, Tooltip.
2. **Magic UI Number Ticker** — BPM display.
3. **React Bits Dock**.
4. **dnd-kit** — timeline draggables.
5. **wavesurfer.js** — waveform canvas.

## Install Commands

```bash
npx shadcn@latest init
npx shadcn@latest add slider dialog tabs scroll-area tooltip
npm i @dnd-kit/core @dnd-kit/sortable wavesurfer.js
npx shadcn@latest add "https://magicui.design/r/text-animate"
npx shadcn@latest add "https://magicui.design/r/sparkles-text"
npx shadcn@latest add "https://magicui.design/r/aurora-text"
```

Clippkit and React Bits ship via their own CLI/copy-paste — check per-component docs.

## Frame-Binding Port Example (Magic UI Sparkles Text)

Sparkles Text animates opacity via `useMotionValue` + `animate()`. In Remotion, replace with frame-driven interpolation:

```tsx
import { useCurrentFrame, interpolate } from "remotion";

const SparkleRemotion = ({ startFrame, endFrame }) => {
  const frame = useCurrentFrame();
  // was: const opacity = useMotionValue(0); animate(opacity, 1, {duration: 0.5})
  const opacity = interpolate(
    frame,
    [startFrame, startFrame + 15, endFrame - 15, endFrame],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return <span style={{ opacity }}>✦</span>;
};
```

Rule: every Motion/GSAP value becomes one `interpolate(frame, ...)` call. No `useEffect`, no `animate()`, no timers.

## Common Mistakes

- **Dropping Magic UI directly into a `<Composition>`**: Motion's internal timer resets to `t=0` on every seek, so the animation never advances during render. Symptom: exported MP4 shows a static pose. Fix: port to `interpolate(useCurrentFrame(), ...)`.
- **React Bits SplitText in a render**: uses GSAP — same failure. Port, or use Clippkit.
- **Rendering wavesurfer.js**: draws via RAF → editor-only. For rendered waveforms use Clippkit's `AudioWaveform` or `@remotion/media-utils` `visualizeAudio()`.
- **Assuming uniform licenses**: verify each component. React Bits carries a Commons Clause.
- **Copy-paste without reading**: grep for `useEffect`, `requestAnimationFrame`, `setTimeout`, `useMotionValue`, `gsap.` — if present and target is a composition, port first.
