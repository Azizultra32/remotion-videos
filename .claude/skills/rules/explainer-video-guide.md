---
name: explainer-video-guide
description: Use when producing an explainer/marketing/educational video end-to-end — covers script → voiceover → captions → scene planning → render → git tag
metadata:
  tags: explainer, marketing, voiceover, elevenlabs, whisper, captions, scene-planning, render, tag
---

# Explainer Video Guide

## Overview

End-to-end pipeline for narration-driven videos in this Remotion repo. Targets the registered `ExplainerVideo` composition (12s default, 30fps, multi-scene slide transitions) but the pipeline applies to any narration-driven piece. Narration pace assumed at ~140 words per minute.

**Cross-references:** `motion-designer` (spec/storyboard before render), `music-video-creator` (use instead when audio is music, not narration).

## Pipeline

### 1. Script
Write to a target duration. Save to `brands/<name>/scripts/<slug>.txt`. Read aloud to verify timing.

### 2. Voiceover (ElevenLabs)
```bash
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}" \
  -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"text": "...", "model_id": "eleven_multilingual_v2"}' \
  --output public/audio/<slug>.mp3
```
**Pin `voice_id` + `model_id` in `brand-config.json`** — re-renders without pinning produce a different voice and break continuity in a series.

### 3. Transcription → Captions (Whisper.cpp)
```bash
npx remotion install whisper-cpp
npx remotion caption public/audio/<slug>.mp3 > public/audio/<slug>.json
```
Output is `@remotion/captions` JSON. Use `--format srt` if you need SRT for external tools.

### 4. Scene Planning
Read real timestamps from the audio:
- `useAudioData(audioPath)` from `@remotion/media-utils` — returns sample data + durationInSeconds
- Or precompute with `mediabunny` `Input.computeDuration()` in a `calculateMetadata` callback

Align each scene's `durationInFrames` to a VO segment end. Don't guess scene timings — measure them from the actual audio.

### 5. Visual Planning
Pick the composition:
| Style | Composition |
|---|---|
| Slide-style explainer | `ExplainerVideo` |
| Product-led marketing | `BrandedDemo` |
| Novel layout | New file in `src/compositions/`, register in `src/Root.tsx` |

Map `brand-config.json` colors to scene props — never hardcode.

### 6. Render
Spot-check first:
```bash
npx remotion render src/index.ts ExplainerVideo out/<slug>.mp4 \
  --props='{"audioPath":"public/audio/<slug>.mp3"}' \
  --frames=0-150
```
Then full render without `--frames`. See `remotion-render` skill for full flag reference.

### 7. Tag the Render (MANDATORY)
Per the project's Git Hygiene rule:
```bash
git add src/ public/audio/<slug>.* brands/<name>/
git diff --cached --stat
git commit -m "explainer: <slug> v1"
git tag render-<slug>-v1
```

## Quick Reference — Duration → Word Count → Scenes

| Duration | Words (~140 wpm) | Scenes (≈) | Frames @30fps |
|---|---|---|---|
| 30s | ~70  | 3 | 900  |
| 60s | ~140 | 6 | 1800 |
| 90s | ~210 | 9 | 2700 |
| 120s | ~280 | 12 | 3600 |

## Common Mistakes

| Mistake | Consequence |
|---|---|
| Script written too long for target duration | TTS overruns, scene timings shift, cuts land mid-word |
| Planning scene frames before voiceover exists | Timings are guesses, must redo after VO arrives |
| Forgetting `git tag render-<slug>-v1` after export | Can't recover the source code that produced this MP4 |
| Mid-series `voice_id` swap | Episode 2 sounds like a different person — continuity break |
| Committing source media >10MB to git | Belongs in `~/media-raw/`, referenced by absolute path |
| Skipping captions | Accessibility regression; also captions inform scene boundary timing |

## Cross-References

- `motion-designer` — write the spec before this pipeline
- `remotion-render` — render flags and project scripts
- `music-video-creator` — sibling pipeline for music-driven content
