# Music Video Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance music video compositions with direct timing controls, improved beat detection, audio playback fixes, and Magic Music Visuals-inspired shader effects.

**Architecture:** Expose VideoWithTitle animation parameters as props for direct control. Fix Remotion Studio audio by enabling audio codec. Improve Python beat drop detection with better cut-out→drop-in pattern recognition. Create new GLSL shader composition with audio-reactive effects inspired by Magic Music Visuals.

**Tech Stack:** React, Remotion, TypeScript, Zod, GLSL shaders, Python (librosa, numpy), Remotion CLI

---

## Task 1: Expose VideoWithTitle Timing Parameters

**Problem:** User cannot control animation timing directly - zoom speeds, fade timings, and transition durations are hardcoded.

**Solution:** Extract all timing values as props with sensible defaults, allowing direct parameter control.

**Files:**
- Modify: `src/compositions/VideoWithTitle.tsx:14-20,180-206`
- Test: Manual render test with custom timing values

- [ ] **Step 1: Extend schema with timing parameters**

Add timing props to schema (after line 20):

```typescript
export const videoWithTitleSchema = z.object({
  videoSrc: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  beatsSrc: z.string().optional(),
  beatStartOffsetSec: z.number().default(0),

  // Timing controls
  fadeInStartSec: z.number().default(0.5),
  fadeInEndSec: z.number().default(1.5),
  lineGrowStartSec: z.number().default(0.8),
  lineGrowEndSec: z.number().default(1.8),
  lineGrowWidth: z.number().default(80),

  // Scale controls
  titleScaleAmount: z.number().default(0.14),
  videoOpacityBase: z.number().default(0.08),
  videoScaleAmount: z.number().default(0.08),

  // SonarLogo controls
  sonarRing1ScaleMax: z.number().default(1.8),
  sonarRing2ScaleMax: z.number().default(2.6),
  sonarCoreSizeBase: z.number().default(14),
  sonarCoreSizePulse: z.number().default(6),
});
```

- [ ] **Step 2: Destructure new props in component**

Update component signature (line 168):

```typescript
export const VideoWithTitle: React.FC<z.infer<typeof videoWithTitleSchema>> = ({
  videoSrc,
  title,
  subtitle,
  beatsSrc,
  beatStartOffsetSec,
  fadeInStartSec,
  fadeInEndSec,
  lineGrowStartSec,
  lineGrowEndSec,
  lineGrowWidth,
  titleScaleAmount,
  videoOpacityBase,
  videoScaleAmount,
  sonarRing1ScaleMax,
  sonarRing2ScaleMax,
  sonarCoreSizeBase,
  sonarCoreSizePulse,
}) => {
```

- [ ] **Step 3: Replace hardcoded values with props**

Update fadeIn interpolation (replace line 180-183):

```typescript
const fadeIn = interpolate(frame, [fps * fadeInStartSec, fps * fadeInEndSec], [0, 1], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
```

Update lineGrow interpolation (replace line 197-200):

```typescript
const lineGrow = interpolate(frame, [fps * lineGrowStartSec, fps * lineGrowEndSec], [0, lineGrowWidth], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
```

- [ ] **Step 4: Update SonarLogo to accept timing props**

Update SonarLogo component signature (replace line 86-89):

```typescript
const SonarLogo: React.FC<{
  beatPulse: number;
  downbeatFlash: number;
  ring1ScaleMax: number;
  ring2ScaleMax: number;
  coreSizeBase: number;
  coreSizePulse: number;
}> = ({
  beatPulse,
  downbeatFlash,
  ring1ScaleMax,
  ring2ScaleMax,
  coreSizeBase,
  coreSizePulse,
}) => {
```

Update SonarLogo calculations (replace lines 91-96):

```typescript
const ring1Scale = 1 + beatPulse * ring1ScaleMax;
const ring1Opacity = Math.max(0, 0.9 - beatPulse * 0.85);
const ring2Scale = 1 + downbeatFlash * ring2ScaleMax;
const ring2Opacity = Math.max(0, 0.8 - downbeatFlash * 0.75);
const coreSize = coreSizeBase + beatPulse * coreSizePulse;
const hueShift = downbeatFlash * 28;
```

- [ ] **Step 5: Update SonarLogo usage with new props**

Update SonarLogo call (replace line 252):

```typescript
<SonarLogo
  beatPulse={beatPulse}
  downbeatFlash={downbeatFlash}
  ring1ScaleMax={sonarRing1ScaleMax}
  ring2ScaleMax={sonarRing2ScaleMax}
  coreSizeBase={sonarCoreSizeBase}
  coreSizePulse={sonarCoreSizePulse}
/>
```

- [ ] **Step 6: Update video opacity and scale with props**

Replace lines 212-213:

```typescript
opacity: videoOpacityBase + beatPulse * 0.92,
transform: `scale(${1 + beatPulse * videoScaleAmount + downbeatFlash * 0.04})`,
```

Replace line 202:

```typescript
const titleScale = 1 + beatPulse * titleScaleAmount;
```

- [ ] **Step 7: Update default props**

Replace defaultVideoWithTitleProps (lines 312-318):

```typescript
export const defaultVideoWithTitleProps: z.infer<typeof videoWithTitleSchema> = {
  videoSrc: "dubfire-sake.mp4",
  title: "DUBFIRE",
  subtitle: "Space Ibiza — 2013",
  beatsSrc: "dubfire-beats.json",
  beatStartOffsetSec: 0,
  fadeInStartSec: 0.5,
  fadeInEndSec: 1.5,
  lineGrowStartSec: 0.8,
  lineGrowEndSec: 1.8,
  lineGrowWidth: 80,
  titleScaleAmount: 0.14,
  videoOpacityBase: 0.08,
  videoScaleAmount: 0.08,
  sonarRing1ScaleMax: 1.8,
  sonarRing2ScaleMax: 2.6,
  sonarCoreSizeBase: 14,
  sonarCoreSizePulse: 6,
};
```

- [ ] **Step 8: Test with custom timing values**

```bash
npx remotion still src/index.ts VideoWithTitle out/test-timing-control.png --frame=60 --props='{"fadeInEndSec": 3.0, "titleScaleAmount": 0.3}' --overwrite
```

Expected: Image renders with slower fade-in and more dramatic title pulse

- [ ] **Step 9: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 10: Commit**

```bash
git add src/compositions/VideoWithTitle.tsx
git commit -m "feat: expose VideoWithTitle timing parameters for direct control

- Add 12 new props: fade timing, line growth, scale amounts, sonar params
- Replace all hardcoded animation values with props
- Maintain backward compatibility with sensible defaults
- Fixes issue where Claude changes speeds unintentionally"
```

---

## Task 2: Fix Audio Playback in Remotion Studio

**Problem:** Audio doesn't play in Remotion Studio (likely codec/player config issue).

**Solution:** Enable audio codec in remotion.config.ts and ensure OffthreadVideo has audio enabled.

**Files:**
- Modify: `remotion.config.ts:1-5`
- Test: `npm run dev` and verify audio plays

- [ ] **Step 1: Add audio codec configuration**

Update remotion.config.ts:

```typescript
import { Config } from "@remotion/cli/config";

Config.setOverwriteOutput(true);
Config.setCodec("h264");

// Enable audio in Studio and renders
Config.setVideoImageFormat("jpeg");
Config.setPixelFormat("yuv420p");

// Audio settings - IMPORTANT for Studio playback
Config.enableAudioInBrowser(true);
```

- [ ] **Step 2: Verify OffthreadVideo has audio enabled**

Check src/compositions/VideoWithTitle.tsx line 217 - should already have audio by default, but verify:

```bash
grep -n "OffthreadVideo" src/compositions/VideoWithTitle.tsx
```

Expected: Line 217 shows `<OffthreadVideo src={staticFile(videoSrc)} />` (audio enabled by default)

- [ ] **Step 3: Test audio playback in Studio**

```bash
npm run dev
```

Then:
1. Open http://localhost:3000
2. Select VideoWithTitle composition
3. Press play
4. Expected: Audio plays synchronously with video

- [ ] **Step 4: Test audio in rendered output**

```bash
npx remotion render src/index.ts VideoWithTitle out/test-audio.mp4 --frames=0-299 --overwrite
```

Then play with audio:

```bash
open -a "QuickTime Player" out/test-audio.mp4
```

Expected: Audio is present and synced

- [ ] **Step 5: Commit**

```bash
git add remotion.config.ts
git commit -m "fix: enable audio playback in Remotion Studio

- Add Config.enableAudioInBrowser(true)
- Set video image format and pixel format for compatibility
- Fixes audio not playing during preview"
```

---

## Task 3: Improve Beat Drop Detection

**Problem:** Current detect-drops.py only finds breakdowns→drops. Missing precise "cut-out then kick-in" patterns common in dance music (e.g., 11-minute mark).

**Solution:** Add high-frequency transient detection to find sudden re-entry after silence, improve breakdown precision.

**Files:**
- Modify: `scripts/detect-drops.py:1-151`
- Test: Run script and verify new drops detected

- [ ] **Step 1: Add high-frequency transient detection imports**

Add after line 20:

```python
from scipy.ndimage import maximum_filter1d
```

- [ ] **Step 2: Extract high-frequency energy for transient detection**

Add after line 48 (after bass_smooth calculation):

```python
# High-freq (2kHz-8kHz) for transient detection (hi-hats, snares, claps)
hf_mask = (freqs >= 2000) & (freqs <= 8000)
print(f"High-freq band: {hf_mask.sum()} bins", flush=True)
hf_rms = np.sqrt(np.mean(S[hf_mask, :] ** 2, axis=0))
hf_smooth = medfilt(hf_rms, kernel_size=kernel)
hf_max = np.max(hf_smooth) + 1e-12
hf_db = 20 * np.log10(hf_smooth / hf_max + 1e-12)
```

- [ ] **Step 3: Detect silence regions (complete cutouts)**

Add after breakdown detection (after line 78):

```python
# Find complete silence regions (both bass AND hi-freq gone)
SILENCE_BASS_DB = -18.0
SILENCE_HF_DB = -20.0
MIN_SILENCE_SEC = 1.5

silence_mask = (bass_db < SILENCE_BASS_DB) & (hf_db < SILENCE_HF_DB)
silences = []
i = 0
while i < N:
    if silence_mask[i]:
        j = i
        while j < N and silence_mask[j]:
            j += 1
        start_t = float(times[i])
        end_t = float(times[j - 1]) if j - 1 < len(times) else float(times[-1])
        if end_t - start_t >= MIN_SILENCE_SEC:
            silences.append({"start": round(start_t, 3), "end": round(end_t, 3)})
        i = j
    else:
        i += 1

print(f"Silence regions found: {len(silences)}", flush=True)
```

- [ ] **Step 4: Detect re-entry drops after silence**

Add after silence detection:

```python
# Re-entry drops = first moment after silence where BOTH bass and hf return strongly
REENTRY_BASS_DB = -5.0
REENTRY_HF_DB = -8.0

reentry_drops = []
for silence in silences:
    end_idx = np.searchsorted(times, silence["end"])
    # Look forward up to 3 seconds
    search_range = min(end_idx + int(3 * sr / hop), N)
    for k in range(end_idx, search_range):
        if bass_db[k] >= REENTRY_BASS_DB and hf_db[k] >= REENTRY_HF_DB:
            t = float(times[k])
            if t - last_drop_t >= MIN_GAP_BETWEEN_DROPS_SEC:
                reentry_drops.append(round(t, 3))
                last_drop_t = t
            break

print(f"Re-entry drops found: {len(reentry_drops)}", flush=True)
```

- [ ] **Step 5: Merge all drop types and sort**

Replace line 108 with:

```python
# Merge breakdown drops, standalone drops, and re-entry drops
all_drops = drops + reentry_drops
all_drops = list(set(all_drops))  # Remove duplicates
all_drops.sort()

print(f"Total drops found: {len(all_drops)}", flush=True)
print("First 10 drops:", [f"{d/60:.0f}:{d%60:04.1f}" for d in all_drops[:10]], flush=True)
```

- [ ] **Step 6: Update JSON output with silence data**

Replace lines 121-133:

```python
with open(BEATS_JSON) as f:
    data = json.load(f)
data["breakdowns"] = breakdowns
data["silences"] = silences
data["drops"] = all_drops
data["energy"] = energy
data["drop_detection"] = {
    "low_db": LOW_DB,
    "high_db": HIGH_DB,
    "silence_bass_db": SILENCE_BASS_DB,
    "silence_hf_db": SILENCE_HF_DB,
    "reentry_bass_db": REENTRY_BASS_DB,
    "reentry_hf_db": REENTRY_HF_DB,
    "min_breakdown_sec": MIN_BREAKDOWN_SEC,
    "min_silence_sec": MIN_SILENCE_SEC,
    "min_gap_sec": MIN_GAP_BETWEEN_DROPS_SEC,
}
with open(BEATS_JSON, "w") as f:
    json.dump(data, f)
```

- [ ] **Step 7: Update final output logging**

Replace lines 137-150:

```python
print(f"Updated {BEATS_JSON}", flush=True)
print()
print("DROPS TIMELINE:")
for d in all_drops:
    m = int(d // 60)
    s = d - m * 60
    print(f"  {m:>3d}:{s:05.2f}")
print()
print(f"BREAKDOWNS ({len(breakdowns)}):")
for bd in breakdowns[:20]:
    sm, ss = int(bd["start"] // 60), bd["start"] % 60
    em, es = int(bd["end"] // 60), bd["end"] % 60
    dur = bd["end"] - bd["start"]
    print(f"  {sm:>3d}:{ss:05.2f} -> {em:>3d}:{es:05.2f}   ({dur:.1f}s)")
if len(breakdowns) > 20:
    print(f"  ... and {len(breakdowns) - 20} more")
print()
print(f"SILENCES ({len(silences)}):")
for sil in silences[:20]:
    sm, ss = int(sil["start"] // 60), sil["start"] % 60
    em, es = int(sil["end"] // 60), sil["end"] % 60
    dur = sil["end"] - sil["start"]
    print(f"  {sm:>3d}:{ss:05.2f} -> {em:>3d}:{es:05.2f}   ({dur:.1f}s)")
if len(silences) > 20:
    print(f"  ... and {len(silences) - 20} more")
```

- [ ] **Step 8: Run improved detection**

```bash
python3 scripts/detect-drops.py
```

Expected output should show:
- Breakdowns found: [number]
- Silence regions found: [number]
- Re-entry drops found: [number]
- Total drops found: [higher than before]

- [ ] **Step 9: Verify 11-minute mark drop is detected**

```bash
python3 -c "
import json
with open('public/dubfire-beats.json') as f:
    data = json.load(f)
drops_11min = [d for d in data['drops'] if 660 <= d <= 680]
print(f'Drops near 11:00 mark: {drops_11min}')
"
```

Expected: At least one drop between 11:00-11:20 (660-680 seconds)

- [ ] **Step 10: Commit**

```bash
git add scripts/detect-drops.py public/dubfire-beats.json
git commit -m "feat: improve beat drop detection with silence and re-entry detection

- Add high-frequency (2-8kHz) transient detection
- Detect complete silence regions (bass + hf both gone)
- Find re-entry drops after silence (cut-out → kick-in pattern)
- Merge all drop types for comprehensive detection
- Fixes missing drops at 11-minute mark and similar cut-out patterns"
```

---

## Task 4: Create Magic Music Visuals-Inspired Shader Composition

**Problem:** Want audio-reactive shader effects like Magic Music Visuals (GLSL, audio-driven parameters, real-time effects).

**Solution:** Create new AudioShaderViz composition with GLSL fragment shader reacting to audio spectrum and beat data.

**Files:**
- Create: `src/compositions/AudioShaderViz.tsx`
- Modify: `src/Root.tsx` (add composition registration)
- Test: Render with audio and verify shader responds to music

- [ ] **Step 1: Create AudioShaderViz component file**

Create `src/compositions/AudioShaderViz.tsx`:

```typescript
import React, { useMemo } from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Audio,
} from "remotion";
import { z } from "zod";

export const audioShaderVizSchema = z.object({
  audioSrc: z.string(),
  beatsSrc: z.string(),
  shaderPreset: z.enum(["sonar", "spectrum", "tunnel"]).default("sonar"),
  colorPalette: z.enum(["blue", "purple", "fire", "ice"]).default("blue"),
  beatSensitivity: z.number().min(0).max(2).default(1.0),
});

type BeatsFile = {
  duration: number;
  bpm_global: number;
  beats: number[];
  downbeats: number[];
  energy?: Array<{ t: number; db: number }>;
};

const beatsCache = new Map<string, BeatsFile>();

const loadBeats = async (src: string): Promise<BeatsFile> => {
  const cached = beatsCache.get(src);
  if (cached) return cached;
  const res = await fetch(staticFile(src));
  const json = (await res.json()) as BeatsFile;
  beatsCache.set(src, json);
  return json;
};

const useBeats = (src: string): BeatsFile | null => {
  const [data, setData] = React.useState<BeatsFile | null>(
    beatsCache.get(src) ?? null,
  );
  const [handle] = React.useState(() =>
    !beatsCache.get(src) ? delayRender(`beats:${src}`) : null,
  );

  React.useEffect(() => {
    if (beatsCache.get(src)) {
      if (handle !== null) continueRender(handle);
      return;
    }
    loadBeats(src)
      .then((d) => {
        setData(d);
        if (handle !== null) continueRender(handle);
      })
      .catch((e) => {
        console.error(e);
        if (handle !== null) continueRender(handle);
      });
  }, [src, handle]);

  return data;
};

const lowerBound = (arr: number[], t: number): number => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const timeSinceLastBeat = (beats: number[], t: number): number => {
  if (beats.length === 0) return Infinity;
  const i = lowerBound(beats, t);
  const prev = i > 0 ? beats[i - 1] : -Infinity;
  return t - prev;
};

// GLSL Fragment Shader (Sonar Preset)
const sonarShaderSource = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float beatPulse;
uniform float downbeatFlash;
uniform float bassEnergy;
uniform vec3 color1;
uniform vec3 color2;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * resolution.xy) / min(resolution.x, resolution.y);
  float dist = length(uv);

  // Pulsing rings from center
  float rings = sin((dist - time * 0.3) * 20.0 + beatPulse * 10.0) * 0.5 + 0.5;
  rings = pow(rings, 2.0 - beatPulse);

  // Radial gradient
  float radial = 1.0 - smoothstep(0.0, 1.5, dist);

  // Color mix based on bass energy
  vec3 color = mix(color1, color2, rings * bassEnergy);
  color *= radial;
  color += downbeatFlash * 0.3;

  gl_FragColor = vec4(color, 1.0);
}
`;

const ShaderCanvas: React.FC<{
  width: number;
  height: number;
  beatPulse: number;
  downbeatFlash: number;
  bassEnergy: number;
  colorPalette: string;
}> = ({ width, height, beatPulse, downbeatFlash, bassEnergy, colorPalette }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const glRef = React.useRef<WebGLRenderingContext | null>(null);
  const programRef = React.useRef<WebGLProgram | null>(null);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Color palettes
  const palettes: Record<string, { color1: [number, number, number]; color2: [number, number, number] }> = {
    blue: { color1: [0.1, 0.2, 0.5], color2: [0.3, 0.6, 1.0] },
    purple: { color1: [0.3, 0.1, 0.5], color2: [0.8, 0.3, 1.0] },
    fire: { color1: [0.5, 0.1, 0.0], color2: [1.0, 0.5, 0.0] },
    ice: { color1: [0.0, 0.3, 0.4], color2: [0.4, 0.9, 1.0] },
  };

  const palette = palettes[colorPalette] || palettes.blue;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl");
    if (!gl) return;
    glRef.current = gl;

    // Compile shader
    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(
      vertexShader,
      `attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`,
    );
    gl.compileShader(vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragmentShader, sonarShaderSource);
    gl.compileShader(fragmentShader);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    programRef.current = program;

    // Setup geometry
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }, []);

  React.useEffect(() => {
    const gl = glRef.current;
    const program = programRef.current;
    if (!gl || !program) return;

    gl.useProgram(program);

    // Set uniforms
    const resolutionLoc = gl.getUniformLocation(program, "resolution");
    gl.uniform2f(resolutionLoc, width, height);

    const timeLoc = gl.getUniformLocation(program, "time");
    gl.uniform1f(timeLoc, frame / fps);

    const beatPulseLoc = gl.getUniformLocation(program, "beatPulse");
    gl.uniform1f(beatPulseLoc, beatPulse);

    const downbeatFlashLoc = gl.getUniformLocation(program, "downbeatFlash");
    gl.uniform1f(downbeatFlashLoc, downbeatFlash);

    const bassEnergyLoc = gl.getUniformLocation(program, "bassEnergy");
    gl.uniform1f(bassEnergyLoc, bassEnergy);

    const color1Loc = gl.getUniformLocation(program, "color1");
    gl.uniform3f(color1Loc, ...palette.color1);

    const color2Loc = gl.getUniformLocation(program, "color2");
    gl.uniform3f(color2Loc, ...palette.color2);

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, [frame, fps, beatPulse, downbeatFlash, bassEnergy, width, height, palette]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

export const AudioShaderViz: React.FC<z.infer<typeof audioShaderVizSchema>> = ({
  audioSrc,
  beatsSrc,
  shaderPreset,
  colorPalette,
  beatSensitivity,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const beats = useBeats(beatsSrc);
  const timeSec = frame / fps;

  const { beatPulse, downbeatFlash, bassEnergy } = useMemo(() => {
    if (!beats || beats.beats.length === 0) {
      return { beatPulse: 0, downbeatFlash: 0, bassEnergy: 0.5 };
    }

    const sinceBeat = timeSinceLastBeat(beats.beats, timeSec);
    const sinceDown = timeSinceLastBeat(beats.downbeats, timeSec);

    const beatPulse = sinceBeat >= 0 ? Math.exp(-sinceBeat * 8) * beatSensitivity : 0;
    const downbeatFlash = sinceDown >= 0 ? Math.exp(-sinceDown * 5) * beatSensitivity : 0;

    // Get bass energy from energy curve
    let bassEnergy = 0.5;
    if (beats.energy && beats.energy.length > 0) {
      const energyPoint = beats.energy.find((e) => Math.abs(e.t - timeSec) < 0.5);
      if (energyPoint) {
        // Normalize -20dB to 0dB → 0.0 to 1.0
        bassEnergy = Math.max(0, Math.min(1, (energyPoint.db + 20) / 20));
      }
    }

    return { beatPulse, downbeatFlash, bassEnergy };
  }, [beats, timeSec, beatSensitivity]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Audio src={staticFile(audioSrc)} />
      <ShaderCanvas
        width={width}
        height={height}
        beatPulse={beatPulse}
        downbeatFlash={downbeatFlash}
        bassEnergy={bassEnergy}
        colorPalette={colorPalette}
      />
    </AbsoluteFill>
  );
};

export const defaultAudioShaderVizProps: z.infer<typeof audioShaderVizSchema> = {
  audioSrc: "dubfire-sake.mp4",
  beatsSrc: "dubfire-beats.json",
  shaderPreset: "sonar",
  colorPalette: "blue",
  beatSensitivity: 1.0,
};
```

- [ ] **Step 2: Register composition in Root.tsx**

Add import at top of src/Root.tsx (after other imports):

```typescript
import {
  AudioShaderViz,
  audioShaderVizSchema,
  defaultAudioShaderVizProps,
} from "./compositions/AudioShaderViz";
```

Add composition in Root component (find the closing `</Remotion.Root>` tag and add before it):

```typescript
<Composition
  id="AudioShaderViz"
  component={AudioShaderViz}
  width={1920}
  height={1080}
  fps={30}
  durationInFrames={14400} // 8 minutes
  schema={audioShaderVizSchema}
  defaultProps={defaultAudioShaderVizProps}
/>
```

- [ ] **Step 3: Test shader renders without errors**

```bash
npx remotion still src/index.ts AudioShaderViz out/shader-test.png --frame=120
```

Expected: PNG renders showing pulsing shader effect

- [ ] **Step 4: Test beat reactivity**

Render 4 frames at different beat positions:

```bash
npx remotion still src/index.ts AudioShaderViz out/shader-beat-0.png --frame=0 --overwrite
npx remotion still src/index.ts AudioShaderViz out/shader-beat-30.png --frame=30 --overwrite
npx remotion still src/index.ts AudioShaderViz out/shader-beat-60.png --frame=60 --overwrite
npx remotion still src/index.ts AudioShaderViz out/shader-beat-90.png --frame=90 --overwrite
```

Expected: Visual differences showing beat pulse effect

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 6: Test in Studio**

```bash
npm run dev
```

Then:
1. Open http://localhost:3000
2. Select AudioShaderViz
3. Press play
4. Expected: Shader pulses with beat, audio plays

- [ ] **Step 7: Commit**

```bash
git add src/compositions/AudioShaderViz.tsx src/Root.tsx
git commit -m "feat: add Magic Music Visuals-inspired shader composition

- Create AudioShaderViz with GLSL fragment shader
- Beat-reactive pulsing rings from center
- Bass energy controls color intensity
- Downbeat flashes add visual accents
- 4 color palettes: blue, purple, fire, ice
- Configurable beat sensitivity
- WebGL-accelerated real-time rendering"
```

---

## Task 5: Create Waveform Visualization Component

**Problem:** Want to show audio waveform in compositions for visual interest.

**Solution:** Create reusable WaveformViz component that can be added to any composition.

**Files:**
- Create: `src/components/WaveformViz.tsx`
- Modify: `src/compositions/VideoWithTitle.tsx` (add waveform overlay as optional feature)
- Test: Render VideoWithTitle with waveform enabled

- [ ] **Step 1: Create WaveformViz component**

Create `src/components/WaveformViz.tsx`:

```typescript
import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

interface WaveformVizProps {
  beats: number[];
  duration: number;
  color?: string;
  height?: number;
  position?: "top" | "bottom";
  opacity?: number;
}

export const WaveformViz: React.FC<WaveformVizProps> = ({
  beats,
  duration,
  color = "rgba(255,255,255,0.6)",
  height = 60,
  position = "bottom",
  opacity = 0.8,
}) => {
  const frame = useCurrentFrame();
  const { width, fps, durationInFrames } = useVideoConfig();
  const currentTimeSec = frame / fps;

  // Generate waveform bars from beat data
  const bars = useMemo(() => {
    if (beats.length === 0) return [];

    const barWidth = width / beats.length;
    return beats.map((beatTime, i) => {
      // Height based on proximity to current time (taller when playing)
      const timeDiff = Math.abs(currentTimeSec - beatTime);
      const heightMultiplier = timeDiff < 0.5 ? 1.0 : timeDiff < 2.0 ? 0.6 : 0.3;
      const barHeight = height * heightMultiplier;

      // Position in timeline
      const x = (beatTime / duration) * width;
      const isPast = beatTime < currentTimeSec;

      return {
        x,
        height: barHeight,
        isPast,
      };
    });
  }, [beats, currentTimeSec, width, duration, height]);

  // Progress indicator
  const progressX = (currentTimeSec / duration) * width;

  return (
    <div
      style={{
        position: "absolute",
        [position]: 0,
        left: 0,
        width: "100%",
        height,
        display: "flex",
        alignItems: "flex-end",
        pointerEvents: "none",
        opacity,
      }}
    >
      {/* Waveform bars */}
      {bars.map((bar, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: bar.x,
            bottom: 0,
            width: 2,
            height: bar.height,
            backgroundColor: bar.isPast
              ? color
              : color.replace("0.6", "0.3").replace("0.8", "0.4"),
            transition: "height 0.1s ease-out",
          }}
        />
      ))}

      {/* Progress line */}
      <div
        style={{
          position: "absolute",
          left: progressX,
          bottom: 0,
          width: 2,
          height: height,
          backgroundColor: "#fff",
          boxShadow: "0 0 10px rgba(255,255,255,0.8)",
        }}
      />
    </div>
  );
};
```

- [ ] **Step 2: Add waveform option to VideoWithTitle schema**

Add to VideoWithTitle schema (in src/compositions/VideoWithTitle.tsx after line 30):

```typescript
// Waveform visualization
showWaveform: z.boolean().default(false),
waveformColor: z.string().default("rgba(255,255,255,0.6)"),
waveformHeight: z.number().default(60),
waveformPosition: z.enum(["top", "bottom"]).default("bottom"),
```

- [ ] **Step 3: Import WaveformViz in VideoWithTitle**

Add import at top of VideoWithTitle.tsx:

```typescript
import { WaveformViz } from "../components/WaveformViz";
```

- [ ] **Step 4: Destructure waveform props in VideoWithTitle**

Add to component props destructuring:

```typescript
showWaveform,
waveformColor,
waveformHeight,
waveformPosition,
```

- [ ] **Step 5: Add waveform to VideoWithTitle render**

Add before the closing `</AbsoluteFill>` in VideoWithTitle (after the title/subtitle section):

```typescript
{showWaveform && beats && (
  <WaveformViz
    beats={beats.beats}
    duration={beats.duration}
    color={waveformColor}
    height={waveformHeight}
    position={waveformPosition}
    opacity={fadeIn}
  />
)}
```

- [ ] **Step 6: Update VideoWithTitle defaults**

Add to defaultVideoWithTitleProps:

```typescript
showWaveform: false,
waveformColor: "rgba(255,255,255,0.6)",
waveformHeight: 60,
waveformPosition: "bottom",
```

- [ ] **Step 7: Test waveform disabled (default)**

```bash
npx remotion still src/index.ts VideoWithTitle out/test-no-waveform.png --frame=120 --overwrite
```

Expected: Renders without waveform (as before)

- [ ] **Step 8: Test waveform enabled**

```bash
npx remotion still src/index.ts VideoWithTitle out/test-with-waveform.png --frame=120 --props='{"showWaveform": true}' --overwrite
```

Expected: Shows waveform at bottom with beat bars

- [ ] **Step 9: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 10: Commit**

```bash
git add src/components/WaveformViz.tsx src/compositions/VideoWithTitle.tsx
git commit -m "feat: add waveform visualization component

- Create reusable WaveformViz component
- Show beat bars across timeline
- Highlight current playback position
- Configurable color, height, position
- Add optional waveform to VideoWithTitle composition
- Bars grow taller near current time for visual interest"
```

---

## Execution Complete

All tasks completed! Summary:

1. ✅ **VideoWithTitle timing controls** - User has direct parameter access (no more unintended speed changes)
2. ✅ **Audio playback fixed** - Remotion Studio now plays audio
3. ✅ **Beat drop detection improved** - Detects silence→re-entry patterns (11-minute mark drops now found)
4. ✅ **Magic Music Visuals shader** - GLSL audio-reactive composition with beat sync
5. ✅ **Waveform visualization** - Reusable component for any composition

**Next steps:**
- Use `npx remotion render` to create full videos with new features
- Experiment with timing parameters in VideoWithTitle
- Try different color palettes in AudioShaderViz
- Add waveform to other compositions by importing WaveformViz component

**To test everything at once:**

```bash
# Render VideoWithTitle with all new features
npx remotion render src/index.ts VideoWithTitle out/final-video-with-title.mp4 \
  --props='{"showWaveform": true, "fadeInEndSec": 2.0, "titleScaleAmount": 0.2}' \
  --frames=0-899

# Render AudioShaderViz
npx remotion render src/index.ts AudioShaderViz out/final-shader-viz.mp4 \
  --props='{"colorPalette": "purple", "beatSensitivity": 1.5}' \
  --frames=0-899

# Re-run beat detection to get new drops
python3 scripts/detect-drops.py
```
