# Dirty Tree Buckets After `867b19e`

Baseline commit:

- `867b19e` — `fix(preview): stabilize transport and lock beat-video retriggers`

Purpose:

- prevent future sessions from treating the remaining dirty tree as one blob
- give each follow-on change set a stable name and boundary

## Bucket 1 — Editor Asset UX And Sidecar Plumbing

Status:

- ready-to-commit

Files:

- `editor/src/components/AssetLibrary.tsx`
- `editor/src/components/AssetPicker.tsx`
- `editor/src/components/SchemaEditor.tsx`
- `editor/src/components/Timeline.tsx`
- `editor/src/components/CanvasWaveform.tsx`
- `editor/src/utils/assets.ts`
- `editor/tests/assetRecordStore.test.ts`
- `editor/tests/sidecar-integration.test.ts`
- `editor/tests/store.test.ts`
- `editor/vite-plugin-sidecar.ts`

Theme:

- editor-facing asset browsing, applying, and timeline insertion
- sidecar registry/reconcile HTTP surface
- store/editor tests that cover the above

Depends on `867b19e`:

- yes

Notes:

- This is the cleanest next commit candidate on the editor side.

## Bucket 2 — Shared Media / Render Runtime Primitives

Status:

- ready-to-commit

Files:

- `src/compositions/elements/MediaClip.tsx`
- `src/compositions/elements/audioReactiveRuntime.ts`
- `src/compositions/elements/effectStackRuntime.ts`
- `src/compositions/elements/fullscreenShaderRuntime.ts`
- `src/compositions/elements/mediaRuntime.ts`
- `src/compositions/elements/mediaSelectionRuntime.ts`
- `src/compositions/elements/modulationRuntime.ts`
- `src/compositions/elements/triggerRuntime.ts`
- `src/compositions/elements/overlays/MediaBlendComposite.tsx`
- `src/compositions/elements/MediaClip.test.tsx`
- `src/compositions/elements/audioReactiveRuntime.test.ts`
- `src/compositions/elements/effectStackRuntime.test.ts`
- `src/compositions/elements/fullscreenShaderRuntime.test.ts`
- `src/compositions/elements/mediaRuntime.test.ts`
- `src/compositions/elements/mediaSelectionRuntime.test.ts`
- `src/compositions/elements/modulationRuntime.test.ts`
- `src/compositions/elements/triggerRuntime.test.ts`
- `src/compositions/elements/overlays/MediaBlendComposite.test.tsx`
- `src/compositions/elements/overlays/MediaRuntimePrimitives.test.tsx`
- `src/compositions/elements/overlays/ShaderPulse.webglRuntime.test.tsx`
- `src/compositions/elements/text/BeatDropWords.test.tsx`

Theme:

- shared trigger/media/audio-reactive/runtime helpers
- reusable render/layout/effect-stack primitives
- focused primitive-level tests

Depends on `867b19e`:

- yes

Notes:

- This is the cleanest next commit candidate on the runtime side.

## Bucket 3 — Beat / Audio-Reactive Overlay Migration

Status:

- likely ready-to-commit, but should be committed separately from Bucket 2 if possible

Files:

- `src/compositions/elements/audio/BassGlowOverlay.tsx`
- `src/compositions/elements/overlays/BeatColorFlash.tsx`
- `src/compositions/elements/overlays/BeatImageCycle.tsx`
- `src/compositions/elements/overlays/BeatShock.tsx`
- `src/compositions/elements/overlays/BloomGlow.tsx`
- `src/compositions/elements/overlays/GlitchShock.tsx`
- `src/compositions/elements/overlays/PlasmaBackdrop.tsx`
- `src/compositions/elements/overlays/ShaderPulse.tsx`
- `src/compositions/elements/text/BeatDropWords.tsx`
- `src/compositions/elements/overlays/Three3D.tsx`

Theme:

- migrate beat/drop/FFT/shader consumers onto the shared runtime helpers

Depends on `867b19e`:

- yes

Notes:

- Treat as a consumer-migration commit, not a primitives commit.

## Bucket 4 — Composition / Module Rewires

Status:

- partial

Files:

- `src/compositions/MusicVideo.tsx`
- `src/compositions/elements/_helpers.ts`
- `src/compositions/elements/overlays/BeatVideoCycle.tsx`
- `src/compositions/elements/overlays/GifClip.tsx`
- `src/compositions/elements/overlays/LottieClip.tsx`
- `src/compositions/elements/overlays/SpeedVideo.tsx`
- `src/compositions/elements/overlays/StaticImage.tsx`
- `src/compositions/elements/overlays/VideoClip.tsx`
- `src/compositions/elements/registry.ts`
- `src/compositions/elements/types.ts`
- `src/hooks/useFFT.ts`

Theme:

- consumer-side rewiring onto the new shared runtime
- asset alias support
- media-field role support

Depends on `867b19e`:

- yes

Notes:

- This bucket overlaps conceptually with Buckets 2 and 3, but is not as cleanly isolated.
- Do not mix it into unrelated editor or CLI commits.

## Bucket 5 — Asset Identity V2 Tooling / Migration / Reconcile

Status:

- risky

Files:

- `docs/plans/asset-identity-v2-design.md`
- `scripts/cli/asset-registry.ts`
- `scripts/cli/migrate-timeline-assets.ts`
- `scripts/cli/mv-render.ts`
- `scripts/cli/mv-scaffold.ts`
- `scripts/cli/mv-reconcile-assets.ts`
- `scripts/cli/probe-media.ts`
- `scripts/cli/reconcile-assets-core.ts`
- `scripts/verify-asset-migration.ts`
- `package.json`
- `package-lock.json`

Theme:

- opaque-ID / alias migration
- registry normalization and reconcile
- timeline migration and verification CLI support

Depends on `867b19e`:

- yes

Notes:

- Keep this isolated from unrelated runtime/editor cleanup.
- This is the easiest bucket to send an agent in circles because it touches migration design, storage format, sidecar behavior, and CLI verification together.

## Bucket 6 — Lottie Async Lifecycle

Status:

- risky

Files:

- `src/compositions/elements/overlays/LottieClip.tsx`
- `src/compositions/elements/overlays/LottieClip.test.tsx`

Theme:

- `delayRender` / async JSON load / abort lifecycle for Lottie playback

Depends on `867b19e`:

- yes

Notes:

- Keep isolated until visually verified.

## Non-Commit / Ignore By Default

- `.playwright-cli/`
- `.claude/skills/repo-evaluation/`
- `opencode-yolo.json`

## Local / Environment-Specific

- `opencode.json`

Notes:

- do not include by default unless there is an explicit reason to commit permission-policy changes

## Recommended Commit Order

1. Bucket 1 — Editor Asset UX And Sidecar Plumbing
2. Bucket 2 — Shared Media / Render Runtime Primitives
3. Bucket 3 — Beat / Audio-Reactive Overlay Migration
4. Bucket 4 — Composition / Module Rewires
5. Bucket 6 — Lottie Async Lifecycle
6. Bucket 5 — Asset Identity V2 Tooling / Migration / Reconcile

## Session Rule

Future sessions should start by choosing exactly one bucket from this file.

If a requested change crosses buckets, say so explicitly before editing.
