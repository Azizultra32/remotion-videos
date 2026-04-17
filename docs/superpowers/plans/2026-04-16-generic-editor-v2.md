# Plan: Generic Music Video Editor v2 — Full Element Library + Upgrades

**Date:** 2026-04-16
**Scope:** 16-element reusable library + editor upgrades + audio fix + Timing Editor integration
**Research basis:** 6 parallel subagent reports (see session 2026-04-16).

---

## 0. Goal

A song-agnostic Remotion editor where every Dubfire technique we codified
is a reusable element type. User drops elements on the timeline, binds them
to beats, tunes curves, and renders any music video. Today the editor has
the UI but the composition dispatch is stubbed (PublicCut + 4 hardcoded labels).

## 1. Foundation (Phase 1)

**1.1 Fix audio plumbing.**
- Hardlink `source-media/dubfire-sake-audio.mp3` → `public/dubfire-sake-audio.mp3`
- Hardlink `source-media/dubfire-sake.wav` → `public/dubfire-sake.wav`
- Add to `.gitignore`: `public/*.mp3`, `public/*.wav`, `public/*.mp4`
- Why: remotion bundler serves files from `public/` but needs hardlinks (not symlinks).

**1.2 Shared hooks.**
- `src/hooks/useBeats.ts` — loads beats JSON via `delayRender`/`continueRender`.
  Returns `{beats, downbeats, drops, breakdowns}` + `lastBeatBefore(t)` + `beatsInRange(a,b)`.
- `src/hooks/useFFT.ts` — wraps `useWindowedAudioData({windowInSeconds: 30})` +
  `visualizeAudio({numberOfSamples: 64, smoothing: true, optimizeFor: "speed"})`.
  Returns `{bins, bass, mid, highs}` (dB-normalized).
- Use windowed, never `useAudioData` (OOM on 2hr mixes).

## 2. Generic composition (Phase 2)

**2.1 Create `src/compositions/MusicVideo.tsx`.**
- Props schema (zod):
  ```ts
  { audioSrc: string, beatsSrc: string|null, videoSrc: string|null,
    elements: TimelineElement[] }
  ```
- Renders `<AbsoluteFill>` background, then dispatches each element to its
  type-specific renderer component. Elements outside `[startSec, startSec+durationSec]`
  return null (gated by `useCurrentFrame() / fps`).
- Audio: `<Audio src={audioSrc}/>` if `audioSrc` truthy.
- Video layer: `<OffthreadVideo>` if `videoSrc` truthy.

**2.2 Register in `src/Root.tsx`.**
- id: `MusicVideo`, 848×480, 24fps, default 24*90 frames.
- defaultProps load from `project.json` via schema.

**2.3 Repoint editor preview.**
- `editor/src/components/Preview.tsx`: `component={MusicVideo}` with
  `inputProps={{audioSrc, beatsSrc, elements}}`.
- Remove `buildProps` — elements are first-class, no label→prop mapping.

## 3. Element library (Phase 3 — 16 types)

Directory: `src/compositions/elements/`

### 3.1 Text (7)
| Id | File | Source |
|---|---|---|
| `text.typing` | text/TypingText.tsx | Clippkit (MIT) |
| `text.glitch` | text/GlitchText.tsx | Clippkit (MIT) |
| `text.popping` | text/PoppingText.tsx | Clippkit (MIT) |
| `text.sliding` | text/SlidingText.tsx | Clippkit (MIT) |
| `text.bellCurve` | text/BellCurveReveal.tsx | Dubfire original |
| `text.beatDrop` | text/BeatDropWords.tsx | Dubfire original (word-per-beat zeta) |
| `text.fitboxSVG` | text/FitboxSVGWord.tsx | Dubfire original + Skia fitbox |

### 3.2 Audio reactive (3)
| Id | File | Source |
|---|---|---|
| `audio.spectrumBars` | audio/SpectrumBars.tsx | template-music-visualization |
| `audio.waveformPath` | audio/WaveformPath.tsx | template-music-visualization |
| `audio.bassGlow` | audio/BassGlowOverlay.tsx | template-music-visualization |

### 3.3 Shapes (3 — Skia)
| Id | File | Source |
|---|---|---|
| `shape.pathReveal` | shapes/PathReveal.tsx | template-skia (progressive stroke) |
| `shape.neonStack` | shapes/NeonStrokeStack.tsx | template-skia (4-layer blur) |
| `shape.sonarRings` | shapes/SonarRings.tsx | Dubfire original |

### 3.4 Overlays (3)
| Id | File | Source |
|---|---|---|
| `overlay.preDropFadeHold` | overlays/PreDropFadeHold.tsx | Dubfire original (N-fade → black → flash) |
| `overlay.watermarkMask` | overlays/WatermarkMask.tsx | Dubfire original |
| `overlay.videoClip` | overlays/VideoClip.tsx | `<OffthreadVideo>` with beat-synced brightness |

### 3.5 Element registry
- `src/compositions/elements/registry.ts` — exports `elementRenderers: Record<string, FC<{element, beats, audioSrc}>>`.
- Each element file exports: `renderer` (FC), `schema` (zod), `defaults`, `category`, `label`, `editorControls` (FC for right panel).

## 4. Editor upgrades (Phase 4)

**4.1 Sidebar rebuild.**
- 16 presets grouped by category (Text / Audio / Shapes / Overlays).
- Each preset carries type id, default props, default duration, recommended track.

**4.2 Per-element-type tracks.**
- Timeline rows: one per category (Text, Audio, Shapes, Overlays, Video).
- Drag-between-tracks (inspired by Remotion's $300 Timeline product demo).

**4.3 ElementDetail dynamic controls.**
- Right panel loads `editorControls` from registry based on `element.type`.
- Removes hardcoded TextControls/ImageControls/EffectControls/BeatFlashControls.

**4.4 Timing Editor deep-link.**
- "Tune curve in Timing Editor ↗" button in every spring-using control.
- Builds `#config=` hash: `btoa(JSON.stringify({components:[{id,mixingMode:"additive",config:{type:"spring",springConfig:{damping,mass:1,stiffness,overshootClamping:false},durationInFrames:null,delay:0,reverse:false}}], selectedAnimation:"Scale"}))`.
- Opens `https://www.remotion.dev/timing-editor#config=<hash>` in new tab.

**4.5 PlayerRef sync (correctness).**
- Move `useCurrentPlayerFrame` into a sibling component of `<Player>`, not the same tree.
- Use `useSyncExternalStore` pattern with `addEventListener('frameupdate')`.

**4.6 Snap-to-beat everywhere.**
- Timeline drag: snap `startSec` to nearest beat when beatsSrc present.
- ElementDetail `startSec` input: "snap to nearest beat" button.

## 5. Skia setup (Phase 5)

**5.1 Install.**
- `npm install @remotion/skia @shopify/react-native-skia`
- Match Remotion version 4.0.434.

**5.2 Webpack override.**
- `remotion.config.ts`: `Config.overrideWebpackConfig(enableSkia)`.

**5.3 AssetManager context.**
- Copy `template-skia/src/AssetManager.tsx` → `src/compositions/skia-assets/AssetManager.tsx`.
- Gates Skia elements until fonts/images loaded.

## 6. Ordering (what to build in what order)

1. **Foundation** (audio hardlinks, hooks) — unblocks everything. (Day 1 AM)
2. **MusicVideo shell + registry skeleton** — empty element types, editor points at it. (Day 1 PM)
3. **Text elements** (7) — lowest risk, no Skia. Clippkit copy-paste + Dubfire ports. (Day 2)
4. **Audio-reactive elements** (3) — uses new hooks. (Day 3)
5. **Editor upgrades** (Sidebar/tracks/ElementDetail/Timing link/sync) — flushes the UI gap. (Day 4)
6. **Skia setup + shape elements** (3) — webpack override, higher risk. (Day 5)
7. **Overlays** (3) — straightforward. (Day 6)
8. **Snap-to-beat polish + project.json round-trip test.** (Day 7)

## 7. Verification

- `npm run dev` in `editor/`: drop each of the 16 element types, scrub, confirm preview updates.
- `npm run test` in `editor/` (if vitest wired) — snapshot `buildProps` → new `buildElementProps` migration.
- Render a 30s test track via `npx remotion render src/index.ts MusicVideo out/test.mp4 --props='./project.json'` after dropping ~8 elements (one per category).
- Audio: press play in editor, hear Dubfire track, see waveform cursor move in lockstep.

## 8. Out of scope for this plan

- Storyboard generator (separate plan).
- Lambda render / Whisper captions (Editor Starter features we skipped).
- Keyframe editor, onion-skin (no store product or template provides).
- Three.js 3D elements (not requested, no research).

## 9. Risk register

- **Skia adds ~2MB to bundle** — Phase 5 gated; if webpack override breaks existing
  compositions, ship v2 without shape elements and add later.
- **Timing Editor hash schema is undocumented** — deep-link could break on upstream
  change. Mitigation: encode defensively (unknown fields default), no parse-back.
- **`useWindowedAudioData` cache invalidation** — when user swaps audio, force
  `?v=${Date.now()}` query param on `audioSrc`.
- **OffthreadVideo + Audio sync drift** on seek — documented Remotion quirk; mitigation
  is to always seek via `playerRef.seekTo` not direct `<Video currentTime>`.
