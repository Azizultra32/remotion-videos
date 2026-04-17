---
name: remotion-render
description: Use when rendering Remotion compositions to video files — covers CLI, still frames, the @remotion/renderer Node API, Lambda, and project-specific batch scripts
metadata:
  tags: render, mp4, ffmpeg, lambda, codec, props, batch, cli, programmatic, still
---

# Remotion Render — All Four Paths

## Overview

Four ways to render in this project. Pick by use case, not habit. Every final-render commit must follow the Git Hygiene rule (commit before render → tag the render commit).

## The Four Paths

### 1. CLI (most common)
```bash
npx remotion render src/index.ts <CompositionId> out/<name>.mp4 --props='{"key":"value"}'
```
Defaults: h264, 30fps from the composition. Cancellable.

### 2. Still frame (fastest spot-check)
```bash
npx remotion still src/index.ts <CompositionId> out/<name>.png --frame=120
```
Or use the project helper: `bash scripts/preview-frame.sh <CompositionId> [frame]`. Always still-preview before launching a 100-second render.

### 3. Programmatic Node API (`@remotion/renderer`)
For batch renders, parameterized loops, or custom progress UI. Used by `scripts/render-programmatic.ts`.

```typescript
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";

const serveUrl = await bundle({ entryPoint: "src/index.ts" });
const inputProps = { audioPath: "public/audio/dubfire.mp3" };

const composition = await selectComposition({
  serveUrl,
  id: "PublicCut",
  inputProps,                // MUST match what's passed to renderMedia
});

await renderMedia({
  serveUrl,
  composition,
  codec: "h264",
  outputLocation: "out/publiccut.mp4",
  inputProps,                // same object — mismatch = rendered with defaults
  enforceAudioTrack: true,   // required if composition has <Audio>
  onProgress: ({ progress }) => console.log(`${(progress * 100).toFixed(1)}%`),
});
```

### 4. Lambda (cloud, long renders)
```typescript
import { renderMediaOnLambda } from "@remotion/lambda/client";

await renderMediaOnLambda({
  region: "us-east-1",
  functionName: "remotion-render-...",
  serveUrl: "https://....cloudfront.net/...",
  composition: "PublicCut",
  codec: "h264",
  inputProps,
});
```
Requires prior `deployFunction` + `deploySite`.

## Critical Flags

| Flag | Purpose | Gotcha |
|---|---|---|
| `--codec h264\|h265\|vp9\|prores` | Output codec | h265 = smaller files, slower decode |
| `--frames=START-END` | Partial render | Frame numbers, not seconds |
| `--scale=2` | Higher res | Doubles render time, file size |
| `--props='{...}'` | Override input props | Shell escape JSON quotes carefully |
| `--concurrency=N` | Parallel frames | Defaults to CPU count; lower if OOM |
| `--enforce-audio-track` | Force audio track | **Without it, compositions with `<Audio>` ship silent renders** |
| `--crf=18\|23\|28` | Quality (lower = better) | render-all.sh uses these tiers |
| `--quality=80` | JPEG concat quality | Affects intermediate frames only |

## Project Scripts

- `scripts/render-all.sh` — batch render every registered composition
- `scripts/render-brand.sh <brand>` — render branded variants from `brands/<name>/brand-config.json`
- `scripts/render-programmatic.ts` — TypeScript batch renderer (programmatic API)
- `scripts/preview-frame.sh <CompositionId> [frame]` — quick still preview

Output → `out/` (gitignored).

## After a Successful Render

Per the project's Git Hygiene rule:
```bash
git add <relevant source files>
git diff --cached --stat   # verify before committing
git commit -m "..."
git tag render-<project>-<version>   # e.g. render-dubfire-v3
```

The tag is the map from final-file → source code. No tag = can't reproduce the render later.

## Common Mistakes

| Mistake | Symptom |
|---|---|
| Forgot `--enforce-audio-track` | MP4 ships with no audio, looks fine in preview |
| Different `inputProps` to `selectComposition` vs `renderMedia` | Renders with default props, not yours |
| Rendering from a dirty tree | Can't bisect "when did X break" later |
| Shell-escaping `--props` JSON wrong on macOS zsh | Use single-quotes around the whole JSON, double-quotes inside |
| Re-bundling per composition in a loop | Bundle once, reuse `serveUrl` across all renders |

## Cross-References

- `motion-designer` — write the spec before rendering
- `music-video-creator` — beat-matched composition patterns
- See `/Users/ali/remotion-videos/CLAUDE.md` "Git Hygiene" section for the full discipline
