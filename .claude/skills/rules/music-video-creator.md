---
name: music-video-creator
description: Beat-matched music video creation framework — audio analysis, zeta points, beat-mapped animations, storyboard-to-render pipeline
metadata:
  tags: music, video, beat, drop, zeta, audio, visualization, dj, mix, bpm, waveform
---

# Music Video Creator — Beat-Matched Video Framework

## When to use

Use this skill when creating music videos, DJ set visualizations, beat-reactive content, or any video where animation must lock to audio events. Triggers: music video, beat sync, beat match, drop, breakdown, zeta point, audio reactive, waveform, spectrum, DJ mix, BPM.

## Core Vocabulary

| Term | Definition |
|---|---|
| **Zeta point** | The exact frame where a bass drop hits — detected from audio, snapped to nearest beat timestamp |
| **Bell curve** | Gaussian opacity envelope `exp(-(t-peak)²/2σ²)` for cinematic text reveals |
| **Beat-mapped** | Animation timing driven by actual detected audio events, not fixed BPM |
| **Breakdown** | Region where bass energy falls >14dB below peak for ≥4 seconds |
| **Pre-drop fade** | Image dims over N beats before zeta, holds black for M beats, then content flashes at zeta |
| **Contact point** | The last visible beat before black hold — gets distinct visual treatment |

## Pipeline

```
1. AUDIO ANALYSIS (Python/librosa)
   ├── Beat detection → beats[] timestamps
   ├── Onset detection → onsets[] timestamps  
   ├── Drop detection → drops[] (zeta points)
   ├── Breakdown detection → breakdowns[] {start, end}
   └── Energy curve → bass_db[] sampled per second

2. STORYBOARD (motion-designer skill)
   ├── Scene breakdown with timing
   ├── Audio-anchored events (which beat/bar)
   └── Transition design (pre-drop fades, crossfades)

3. REAL-TIME AUDIO (Remotion native)
   ├── useWindowedAudioData() — streams .wav chunks
   ├── visualizeAudio() — per-frame frequency spectrum
   ├── Bass extraction → frequencies.slice(0, 16) averaged
   └── Mid/high extraction for spectrum bars

4. COMPOSITION (React/Remotion)
   ├── Elements with Zod schema props (adjustable in Studio)
   ├── Beat-driven opacity/scale/glow from visualizeAudio()
   ├── Pre-computed beat data for precise drop timing
   └── All timing as props with .min()/.max()/.step()

5. EDITOR (custom React app)
   ├── Waveform + spectrum on timeline
   ├── Beat/drop markers
   ├── Draggable element blocks
   ├── Click-into for nested detail
   └── Live Remotion Player preview
```

## Audio Analysis Scripts

### Beat Detection
```bash
python3 scripts/detect-beats.py
# Input: out/audio.wav
# Output: public/beats.json {beats[], downbeats[], bpm_global, tempo_curve[]}
```

### Drop Detection
```bash
python3 scripts/detect-drops.py
# Augments beats.json with: drops[], breakdowns[], energy[]
# Uses bass-band RMS (40-180 Hz), median-filtered, dB-scaled
```

### Per-Frame Energy (optional, for pre-computed flickering)
```bash
python3 scripts/hires-energy.py
# Output: public/energy-24fps.json — one float per video frame
# Uses onset detection at 11.6ms resolution
```

## Remotion Audio Integration

### ALWAYS use native Remotion APIs for real-time effects:

```tsx
import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";
import { Audio } from "@remotion/media";

// Stream audio efficiently (handles 2-hour files)
const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
  src: staticFile("audio.wav"),
  frame,
  fps,
  windowInSeconds: 10, // loads 30s total (prev + current + next)
});

// Per-frame frequency analysis
const frequencies = visualizeAudio({
  fps, frame, audioData,
  numberOfSamples: 128,
  optimizeFor: "speed",
  dataOffsetInSeconds,
});

// Bass intensity (left side = low frequencies)
const bass = frequencies.slice(0, 16);
const bassIntensity = bass.reduce((s, v) => s + v, 0) / bass.length;
```

### IMPORTANT: useWindowedAudioData requires .wav format

Extract with: `ffmpeg -i input.mp4 -ac 1 -ar 22050 -vn output.wav`

### Audio playback: use lightweight mp3, not the full video

```tsx
<Audio src={staticFile("audio.mp3")} />
// Extract: ffmpeg -i input.mp4 -vn -c:a libmp3lame -q:a 4 audio.mp3
```

## Beat-Mapped Animation Patterns

### Bell Curve Reveal (text appears and disappears cinematically)
```tsx
const t = frame / fps;
const opacity = Math.exp(-Math.pow(t - peak, 2) / (2 * sigma * sigma));
```

### Pre-Drop Fade (4-beat fade → 4-beat black → zeta flash)
```tsx
// Use pre-computed beat timestamps for frame-accurate sync
const dropBeatIdx = lowerBound(beats, dropSec);
const fadeStart = beats[dropBeatIdx - 8]; // 8 beats before
const holdStart = beats[dropBeatIdx - 4]; // 4 beats before
// fadeStart→holdStart: linear fade to black
// holdStart→drop: pure black
// drop: content flashes
```

### Bass-Reactive Glow
```tsx
const glow = bassIntensity * multiplier;
style={{ textShadow: `0 0 ${glow}px rgba(255,255,255,0.8)` }}
```

### Word-Per-Beat (drop section)
```tsx
const beatsSinceDrop = countBeatsInRange(beats, dropSec, absTime);
const wordIndex = Math.max(0, beatsSinceDrop - 1) % words.length;
```

## Zod Schema Best Practices

All timing values as adjustable Studio props:
```tsx
z.number().min(0).max(120).step(0.5).describe("DUBFIRE fade-in start (sec)")
```

## Watermark Removal

Use ffmpeg delogo filter instead of CSS overlays:
```bash
ffmpeg -i input.mp4 -vf "delogo=x=748:y=445:w=98:h=32" -c:v libx264 -preset veryfast -crf 20 -c:a copy output.mp4
```

## Anti-Patterns

- **Pre-computing per-frame energy in Python** when `visualizeAudio()` does it natively in Remotion
- **Using fixed BPM math** instead of actual detected beat timestamps
- **Symlinks in public/** — Remotion's bundler doesn't follow them. Use copies or hardlinks.
- **1-second resolution energy curves** — too coarse for beat-reactive effects
- **CSS opacity without local normalization** for flickering — quiet sections disappear entirely
- **The `<Audio>` component from `remotion`** — import from `@remotion/media` instead

## Composition Structure

Separate concerns:
- **BeatDrop** composition — the zeta-point showcase (beat-mapped drops, word-per-beat)
- **PublicCut** composition — the public-facing intro (AHURA reveal, title assembly, image)
- **VideoWithTitle** composition — simple video + overlay title with beat pulse

## File Organization

```
public/
  audio.mp3          — lightweight audio for playback
  audio.wav          — full wav for visualizeAudio() analysis
  beats.json         — beats, drops, breakdowns, energy curve
  still.png          — delogo'd high-res still frame
  video-clean.mp4    — delogo'd video source
scripts/
  detect-beats.py    — librosa beat detection
  detect-drops.py    — bass-band drop/breakdown detection
  hires-energy.py    — per-frame onset energy (optional)
```
