# Media Reactivity / Asset System Rethink

## Why this exists

The current editor can place media on the timeline and apply some beat-driven behavior, but the system is not coherent enough to support a truly flexible "Magic Music Visuals"-class workflow.

The immediate user complaints are valid:

- Media attachment feels inconsistent.
- GIF is not treated as a first-class asset in the editor.
- The asset library, schema editor, and media element modules do not share one canonical model.
- Audio-reactive behavior exists, but as scattered one-off primitives rather than a reusable modulation system.

This document reframes the problem from "add more media effects" to "design a proper media + modulation architecture".

## Current state: what exists already

### Render-time context

The render context is already strong enough to power advanced reactivity:

- `ctx.beats` exposes `beats`, `downbeats`, `drops`, `lastBeatBefore()`, `nextBeatAfter()`, and `beatsInRange()`.
  - See `src/hooks/useBeats.ts`
- `ctx.events` and `startEvent` allow semantic named-event anchoring.
  - See `src/utils/events.ts`
  - See `src/compositions/elements/types.ts`
- `useFFT()` exposes per-frame `bass`, `mid`, `highs`, plus raw bins.
  - See `src/hooks/useFFT.ts`

### Existing media-capable elements

- `overlay.videoClip`
  - Single video clip, start offset, opacity, scale, beat-brightness pulse.
  - `src/compositions/elements/overlays/VideoClip.tsx`
- `overlay.speedVideo`
  - Single video with fixed playback rate and offset.
  - `src/compositions/elements/overlays/SpeedVideo.tsx`
- `overlay.beatVideoCycle`
  - Switches between multiple videos on beats/downbeats/drops.
  - `src/compositions/elements/overlays/BeatVideoCycle.tsx`
- `overlay.staticImage`
  - Single image with fades and layout.
  - `src/compositions/elements/overlays/StaticImage.tsx`
- `overlay.beatImageCycle`
  - Switches between multiple images on beats/downbeats/drops.
  - `src/compositions/elements/overlays/BeatImageCycle.tsx`
- `overlay.gif`
  - GIF playback synced to composition time.
  - `src/compositions/elements/overlays/GifClip.tsx`

### Existing overlay/effect primitives that can sit above media

- `overlay.beatColorFlash`
- `overlay.glitchShock`
- `overlay.beatShock`
- `overlay.sceneTransition`
- `overlay.shaderPulse`

These already prove the engine can layer media and reactive effects.

## Current state: architectural failures

### 1. The asset model is split across incompatible concepts

The codebase currently uses at least three different media concepts:

- Raw file paths in element props:
  - `imageSrc`, `videoSrc`, `gifSrc`, `images`, `videos`
- Asset-library scan of:
  - `public/assets/{images,videos}`
  - `projects/<stem>/{images,videos}`
  - plus loose top-level project media files
  - `editor/vite-plugin-sidecar.ts`
- A separate manifest-level `media.root` / `sourceVideo` / `sourceAudio` model:
  - `src/lib/schemas/projectManifest.ts`

These are not unified into one canonical representation.

### 2. The editor only treats image/video as first-class asset kinds

The editor asset library and picker use:

- `kind: "image" | "video"`
  - `editor/src/components/AssetLibrary.tsx`
  - `editor/src/components/AssetPicker.tsx`
  - `editor/vite-plugin-sidecar.ts`

GIF files are discovered by the sidecar because `.gif` matches image extensions, but GIF is not a distinct editor asset kind. That creates a mismatch:

- The asset library click/drop path seeds `imageSrc` or `videoSrc`, never `gifSrc`.
- The timeline drop path also seeds only `imageSrc` or `videoSrc`.
- `SchemaEditor.detectAssetKind()` recognizes image/video-style field names, but not `gifSrc`.
  - `editor/src/components/SchemaEditor.tsx`

Result:

- GIF exists as a renderable element type.
- GIF does not exist as a proper first-class asset workflow.

This is one of the main reasons the media UX feels fake or partial.

### 3. Media attachment is path-based and prop-name-driven

The current editor infers media-ness by regex on prop names:

- `imageSrc`, `images`, `videoSrc`, `videos`, etc.
  - `editor/src/components/SchemaEditor.tsx`

This is brittle:

- It is not schema-semantic.
- It does not scale to `gifSrc`, image sequences, masks, mattes, depth maps, alpha videos, LUTs, shader textures, webcam/live inputs, etc.
- It makes media support depend on naming conventions instead of explicit field types.

### 4. Reactivity is implemented per element, not as a reusable system

Current reactive behavior is mostly hardcoded inside each element module:

- `VideoClip` has beat brightness logic.
- `BeatImageCycle` has its own trigger-counting logic.
- `BeatVideoCycle` has its own trigger-counting logic.
- `ShaderPulse` has its own FFT mapping.
- `GlitchShock` has its own beat-triggered envelope logic.

This does produce useful effects, but it does not produce flexibility.

Missing:

- A shared modulation engine.
- Reusable trigger/envelope primitives.
- A general way to bind "this parameter listens to bass/downbeats/event X/expression Y".

### 5. There is no canonical "media effect stack"

Right now the composition model is mainly:

- put media on the timeline
- stack overlays above it

That can work, but it is not enough for a serious media-reactive system.

Missing:

- Effect chains per media item
- Reusable texture-based shaders
- Source-to-effect routing
- Multi-input compositing primitives
- Collections/playlists/slot replacement behavior

### 6. Project persistence exists, but the UX does not make the model clear

Element mutations do autosave:

- `editor/src/hooks/useTimelineSync.ts`

So the issue is not just "saving is broken". The deeper issue is:

- users are editing raw path props
- asset selection is modal and element-local
- the library is a scanner, not a project media manager
- there is no clear concept of "this project owns these media assets and these elements reference them"

That makes persistence feel unreliable even when the underlying JSON save path is working.

## Product direction: what this should become

This should become a **media graph with reusable modulation**, not a bag of special-case media elements.

The target should combine:

- the media-centric flexibility of Magic Music Visuals
- the deterministic render model of Remotion
- the explicit animation/data model discipline already present in this repo

## Reference patterns from external tools

### Magic Music Visuals

Official docs point to several capabilities worth emulating:

- Layers modules accept multiple independent inputs, rather than only stacked timeline overlays.
- Global parameters can be linked to multiple module parameters at once.
- Global parameters can themselves be driven by sources/modifiers/expressions.
- GLSL/ISF shader support is treated as an extensibility surface, not a one-off special effect.

Source:

- https://magicmusicvisuals.com/downloads/Magic_UsersGuide.html

### Motion Canvas

Motion Canvas treats media as explicit scene components with explicit control:

- image/video are imported as assets
- video playback is intentionally controlled (`play`, `pause`)
- media behaves like a first-class animation object rather than a stringly-typed prop accident

Source:

- https://motioncanvas.io/docs/media/

## Proposed architecture

## 1. Canonical asset system

Introduce a first-class asset record instead of raw file-path props as the primary model.

```ts
type AssetKind =
  | "image"
  | "gif"
  | "video"
  | "image-sequence"
  | "audio"
  | "lottie"
  | "shader"
  | "mask"
  | "lut";

type AssetRecord = {
  id: string;
  kind: AssetKind;
  scope: "library" | "project";
  path: string;
  stem: string | null;
  label: string;
  metadata: {
    width?: number;
    height?: number;
    durationSec?: number;
    fps?: number;
    alpha?: boolean;
    poster?: string;
  };
  tags?: string[];
};
```

Then media props reference `assetId`, not just a string path.

Raw paths can still be supported as a legacy fallback, but the editor should move to:

- stable asset ids
- known asset kinds
- known metadata
- reusable previews/posters/durations

## 2. One media field type in schemas

Replace regex-based asset-field detection with explicit schema metadata.

Example direction:

```ts
mediaField({
  kind: ["image", "gif", "video"],
  multiple: false,
  role: "primary-source",
})
```

or an equivalent typed wrapper around Zod metadata.

This lets the editor know:

- what picker to show
- what asset kinds are allowed
- whether selection is single or multi
- whether the field is a source, mask, displacement map, LUT, etc.

## 3. Media source abstraction

Unify image/gif/video under one source abstraction with capability flags.

```ts
type MediaSource =
  | { type: "still"; assetId: string }
  | { type: "gif"; assetId: string; playbackRate: number; loopMode: ... }
  | { type: "video"; assetId: string; startOffsetSec: number; playbackRate: number; loopMode: ... }
  | { type: "sequence"; assetId: string; fps: number; playbackRate: number };
```

Then build modules around behaviors, not file extensions:

- `MediaClip`
- `MediaCycle`
- `MediaStack`
- `MediaPlaylist`
- `MediaGrid`
- `MediaMaskComposite`

Instead of having unrelated `StaticImage`, `GifClip`, `SpeedVideo`, etc. that all reinvent parts of the same model.

## 4. Separate "source", "effects", and "modulation"

Every visual media element should be decomposed into:

- source:
  - what media is being drawn
- effects:
  - what transforms / compositing / shaders / color operations are applied
- modulation:
  - what signals drive those parameters

This means one media element can express:

- base source = clip A or playlist B
- effect stack = blur, chroma, displacement, bloom, posterize, shader pass
- modulation = bass -> scale, downbeat -> flash, drop -> playbackRate ramp, event "hook" -> swap source

## 5. Build a reusable modulation engine

This is the key missing piece.

Introduce reusable signal sources:

- beat trigger
- downbeat trigger
- drop trigger
- named event trigger
- time since last beat
- FFT band
- smoothed envelope follower
- BPM phase
- LFO
- noise/random seeded function
- expression
- global control

And reusable shaping functions:

- attack/decay envelope
- ADSR-like curve
- spring response
- threshold/gate
- smoothstep
- clamp/remap
- quantize
- hold/sample-and-hold

Then parameter bindings:

```ts
type ParameterBinding = {
  target: "opacity" | "scale" | "playbackRate" | "brightness" | "shader.uniform.uGlow";
  source: SignalSource;
  transform?: ValueTransform[];
  mix?: "replace" | "add" | "multiply" | "max";
};
```

This turns "audio-reactive behavior" into a platform feature instead of a per-element custom hack.

## 6. Add first-class collections/playlists

For advanced media work, the editor needs more than "one source file per element".

Need first-class support for:

- single asset
- asset list
- weighted/randomized list
- beat-step sequence
- event-routed variants
- alternate A/B sources
- source banks

Examples:

- "cycle through these 8 clips on each downbeat"
- "use this image bank, but jump to a new one only on drop"
- "play this same clip, but restart it on every event marker"

## 7. Add real multi-input effects

The current model is mostly timeline compositing. For a Magic-style system we need multi-input media effects:

- blend two media sources
- mask media A with media B
- displace media A with shader/media B
- feed media through effect chains
- route multiple media sources into a shader

This can begin with a small set of compositing modules before attempting a full node graph.

## 8. Editor UX direction

The editor should clearly separate:

- Library
  - shared across projects
- Project Media
  - media attached to the current project
- Asset details
  - preview, metadata, tags, durations, dimensions, proxies
- Element attachment
  - choose source slots from known assets
- Modulation
  - bind behaviors to beat/FFT/events/globals

Important UX principle:

**dragging an asset onto the timeline should create a stable asset-backed clip, not just write a path string into whichever prop happened to exist.**

## Immediate implementation priorities

### Priority 1: fix the broken foundation

- Introduce first-class asset kinds:
  - `image`, `gif`, `video` at minimum
- Make GIF a proper asset kind end-to-end
- Replace path-guessing with explicit media field metadata
- Make the asset picker and asset library read from the same canonical asset model
- Decide the authoritative storage model:
  - either manifest-backed project media
  - or editor/sidecar asset-index files
  - but not three overlapping systems

### Priority 2: unify media elements

Build a shared `MediaClip` foundation and migrate:

- `StaticImage`
- `GifClip`
- `VideoClip`
- `SpeedVideo`

onto a common runtime abstraction.

### Priority 3: reusable modulation system

Implement signal sources and parameter bindings before adding more special-case media modules.

Without this, every new "reactive media effect" will just increase duplication.

### Priority 4: compositing/effect stack

Introduce a structured effect stack for media:

- color
- transform
- blur/glow
- blend/mask
- shader pass

### Priority 5: advanced shader/media modules

After the foundation is fixed:

- media-texture shaders
- displacement shaders
- frame feedback/trails
- clip bank routing
- event-driven source swaps
- modulated playback envelopes

## Concrete code issues to fix first

These are not the full redesign, but they are immediate correctness issues:

- `gifSrc` is not recognized by the schema asset-field picker.
  - `editor/src/components/SchemaEditor.tsx`
- Asset library kinds are only `"image" | "video"`.
  - `editor/src/components/AssetLibrary.tsx`
  - `editor/src/components/AssetPicker.tsx`
  - `editor/vite-plugin-sidecar.ts`
- Timeline asset drop only seeds `imageSrc` or `videoSrc`.
  - `editor/src/components/Timeline.tsx`
- Asset-library click-to-add defaults are hardcoded to `overlay.staticImage` and `overlay.speedVideo`, which is too narrow for a serious media workflow.
  - `editor/src/components/AssetLibrary.tsx`
- The project manifest media model is not integrated into the live editor media browser flow.
  - `src/lib/schemas/projectManifest.ts`

### Known issue: BeatVideoCycle choppy playback

Confirmed root cause:

- `src/compositions/elements/overlays/BeatVideoCycle.tsx` drives `OffthreadVideo` with a `startFrom` value that advances every frame while the active clip is playing.
- That means the renderer is being asked to keep re-seeking the source instead of letting one stable video instance play through the current clip.
- The playback stutter is coming from that per-frame decode/seek churn in the video element, not from the recent Phase 1 asset-identity work. The asset-record migration changed how media is identified and selected; it did not change `BeatVideoCycle` playback behavior.

Quick mitigation, not a full fix:

- Memoize the active clip and remount only when `currentIdx` changes.
- Keep the rendered `OffthreadVideo` instance stable within a clip so it does not churn on every frame.

Long-term fix:

- Move beat-driven clip playback into the modulation/render optimization roadmap.
- The real fix is to separate source switching from per-frame playback state so modulation can schedule clip changes and playback envelopes without forcing seek-heavy rerenders.
- This belongs with the reusable modulation engine and render-path caching work already outlined above.

## Recommended implementation sequence

1. Canonical asset index and asset kinds
2. GIF/image/video first-class attachment UX
3. Asset-backed media clip abstraction
4. Modulation/binding engine
5. Media collections/playlists
6. Multi-input compositing/effect stack
7. Advanced media-reactive shader/media modules

## Short conclusion

The repo is not far away from advanced media reactivity in render-time capability.

The real blocker is not FFT or beat detection.

The real blocker is that:

- assets are not modeled cleanly
- media attachment is stringly-typed
- media types are incomplete
- reactivity is encoded as element-specific logic instead of a shared modulation system

Fixing those four things is the path to turning this into a genuinely powerful media-reactive editor.
