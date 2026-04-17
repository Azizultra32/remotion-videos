---
name: awwwards-animations
description: Use when adding award-show-tier visual effects (glitch text, kinetic typography, liquid morphs, number tickers, marquees) to Remotion compositions — includes the frame-binding port for each pattern
metadata:
  tags: glitch, kinetic-typography, morph, ticker, marquee, spring, awwwards, magicui, reactbits
---

# Awwwards-Tier Animations (Remotion Port)

## Overview
Award-winning web animations (Awwwards, magicui.design, reactbits.dev) are built on GSAP, Framer Motion, `requestAnimationFrame`, `setTimeout`, CSS `@keyframes`, and `IntersectionObserver`. **None of those survive a Remotion render.** Remotion renders by seeking to arbitrary frames out of order — anything that depends on wall-clock time or browser scroll produces flicker, drift, or blank output.

This skill is the translation layer: take a pattern, port it to a pure function of `frame`.

## The Frame-Binding Rule (core constraint)
**Every animated value MUST be derivable from `useCurrentFrame()` alone.** No exceptions.

- NEVER: `Math.random()`, `Date.now()`, `performance.now()`, `requestAnimationFrame`, `setTimeout`/`setInterval`, Framer Motion's `motion.*` with transitions, GSAP timelines, CSS `@keyframes` on rendered elements, `IntersectionObserver`, scroll listeners.
- ALWAYS: `interpolate(frame, ...)`, `spring({ frame, fps, config })`, `random('seed' + frame)` from `remotion`, `<Sequence from={N}>` for gating.

Refs: https://www.remotion.dev/docs/random · https://www.remotion.dev/docs/spring · https://www.remotion.dev/timing-editor

## Pattern Index

### 1. Glitch text (RGB channel split)
Offset R/G/B channels by a random-per-frame amount. Use Remotion's deterministic `random()` seeded with the frame.
```tsx
import {random, useCurrentFrame} from 'remotion';
const frame = useCurrentFrame();
const dx = (random(`glitch-${frame}`) - 0.5) * 8;
// render 3 copies: (+dx,0) red, (-dx,0) cyan, (0,0) white; mixBlendMode: 'screen'
```
Fully-worked component below.

### 2. Kinetic typography (cascade reveal)
Each letter has its own entry window based on its index.
```tsx
const letterOpacity = (i: number) =>
  interpolate(frame, [i * stagger, i * stagger + 10], [0, 1], {extrapolateRight: 'clamp'});
```

### 3. Liquid morph / blob
Port SVG path morphing from scroll-driven GSAP to frame-driven interpolation. Use `flubber.interpolate(pathA, pathB)` to build the `d` function once, then drive `t = interpolate(frame, [0, N], [0, 1])`. For >2 keyframes, chain flubber interpolators per segment.

### 4. Magnetic cursor / parallax mouse follow
**Not portable.** There is no cursor at render time. Use only in editor UI (`editor/`), never in a rendered composition.

### 5. Number ticker / counter animation
```tsx
const value = interpolate(frame, [0, 60], [0, 10_000], {extrapolateRight: 'clamp'});
return <span>{Math.round(value).toLocaleString()}</span>;
```

### 6. Marquee / infinite scroll
CSS `@keyframes` renders fine in the Player but produces a static frame during `remotion render` (no frame binding). Drive `translateX` off the frame.
```tsx
const x = interpolate(frame, [0, durationInFrames], [0, -contentWidth]);
<div style={{transform: `translateX(${x}px)`}}>{items}{items}</div>
```

### 7. Reveal-on-scroll → reveal-on-frame
Replace `IntersectionObserver` with either `<Sequence from={N} durationInFrames={D}>` or a frame-gated interpolate. No scroll events exist during render.

### 8. Spring physics curves
Use Remotion's `spring`, not Framer Motion's (which uses an internal wall-clock).
```tsx
import {spring, useVideoConfig} from 'remotion';
const {fps} = useVideoConfig();
const s = spring({frame, fps, config: {damping: 12, stiffness: 120}});
```
Tune curves visually at https://www.remotion.dev/timing-editor.

## Fully-Worked Example: GlitchText (frame-deterministic)
```tsx
import {AbsoluteFill, random, useCurrentFrame} from 'remotion';

export const GlitchText: React.FC<{text: string; seed?: string}> = ({text, seed = 'glitch'}) => {
  const frame = useCurrentFrame();
  // Deterministic per-frame jitter — identical across re-renders, safe for seeking.
  const dx = (random(`${seed}-x-${frame}`) - 0.5) * 10;
  const dy = (random(`${seed}-y-${frame}`) - 0.5) * 4;
  const skip = random(`${seed}-skip-${frame}`) > 0.92; // occasional hard break

  const base: React.CSSProperties = {
    position: 'absolute', inset: 0, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontFamily: 'monospace', fontWeight: 900, fontSize: 180,
    mixBlendMode: 'screen',
  };

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <div style={{...base, color: '#ff0040', transform: `translate(${dx}px, ${dy}px)`}}>{text}</div>
      <div style={{...base, color: '#00ffe1', transform: `translate(${-dx}px, ${-dy}px)`}}>{text}</div>
      <div style={{...base, color: '#ffffff', opacity: skip ? 0.3 : 1}}>{text}</div>
    </AbsoluteFill>
  );
};
```
Seek to frame 137 a hundred times — byte-identical output every time. That's the whole point.

## Common Mistakes
| Mistake | Why it breaks | Fix |
|---|---|---|
| `Math.random()` inside the component | Different value per re-render → flicker, non-deterministic renders | `random('seed-' + frame)` from `remotion` |
| Leaving Framer Motion `<motion.div animate=...>` in place | Framer uses an internal clock; Remotion seeks don't advance it | Replace with `interpolate` / `spring({frame, fps})` |
| CSS `@keyframes` for rendered output | Preview looks fine, render is frozen | Compute `transform` from `frame` explicitly |
| `setTimeout` / `setInterval` for sequencing | Never fires during frame-by-frame render | `<Sequence from={N}>` or frame-range gates |
| Copy-pasting magicui / reactbits straight in | GSAP + rAF everywhere | Port each animated value to `interpolate`/`spring` before shipping |
| Using Framer Motion's `spring` | Wall-clock driven | Remotion's `spring({frame, fps, config})` |

## References
- Spring: https://www.remotion.dev/docs/spring
- Random (deterministic): https://www.remotion.dev/docs/random
- Timing editor (tune curves): https://www.remotion.dev/timing-editor
- Pattern sources requiring port: https://magicui.design · https://www.reactbits.dev
