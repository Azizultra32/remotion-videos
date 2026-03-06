# Remotion Advanced Patterns Reference

> Comprehensive reference for advanced Remotion features, integrations, and patterns.
> Last updated: 2026-03-04

---

## Table of Contents

1. [Remotion + Three.js / React Three Fiber](#1-remotion--threejs--react-three-fiber)
2. [Remotion + Lottie](#2-remotion--lottie)
3. [Remotion + Captions/Subtitles](#3-remotion--captionssubtitles)
4. [Remotion + Charts/Data Visualization](#4-remotion--chartsdata-visualization)
5. [Remotion Studio Customization](#5-remotion-studio-customization)
6. [Remotion GitHub Actions CI](#6-remotion-github-actions-ci)
7. [Prompt Gallery Patterns](#7-prompt-gallery-patterns)
8. [Core Code Generation Rules](#8-core-code-generation-rules)

---

## 1. Remotion + Three.js / React Three Fiber

**Package:** `@remotion/three`
**Docs:** https://www.remotion.dev/docs/three

### Installation

```bash
npm i three @react-three/fiber @remotion/three @types/three
```

### Core Components

| Component/Hook | Purpose |
|---|---|
| `<ThreeCanvas>` | Drop-in replacement for R3F's `<Canvas>` that enables Remotion hooks inside the 3D scene |
| `useVideoTexture()` | Maps Remotion's `<Html5Video>` as a Three.js texture |
| `useOffthreadVideoTexture()` | Frame-accurate video textures during rendering (uses `<OffthreadVideo>` internally) |

### ThreeCanvas Props

| Prop | Type | Description |
|---|---|---|
| `orthographic` | `boolean` | Use orthographic camera projection |
| `width` | `number` | **Required.** Canvas width in pixels |
| `height` | `number` | **Required.** Canvas height in pixels |
| `style` | `CSSProperties` | Inline styles for the canvas container |
| `camera` | `object` | Camera config: `{ fov, position }` |
| `frameloop` | `string` | Overridden to `'never'` during rendering |

### Example: Animated 3D Cube

```tsx
import { ThreeCanvas } from "@remotion/three";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";

const My3DScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const rotationY = interpolate(frame, [0, 120], [0, Math.PI * 2]);
  const scale = interpolate(frame, [0, 30], [0.5, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <ThreeCanvas
      orthographic={false}
      width={width}
      height={height}
      style={{ backgroundColor: "#0a0a0a" }}
      camera={{ fov: 75, position: [0, 0, 5] }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <mesh rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
        <boxGeometry args={[2, 2, 2]} />
        <meshStandardMaterial color="#e74c3c" />
      </mesh>
    </ThreeCanvas>
  );
};
```

### Performance Considerations

- **Never use `useFrame()`** from React Three Fiber. Write all animations declaratively using `useCurrentFrame()` and `interpolate()`. This ensures scrubbing and seeking work correctly in the timeline.
- **`<Sequence>` inside ThreeCanvas:** Always pass `layout="none"` to `<Sequence>` components inside a `<ThreeCanvas>`. The default `<div>` wrapper is not valid inside a Three.js scene.
- **Server-side rendering:** Three.js requires explicit OpenGL config. Add this to your render call:
  ```json
  {
    "chromiumOptions": {
      "gl": "angle"
    }
  }
  ```
- **Async textures:** When updating textures asynchronously (e.g., from video callbacks), call `advance(performance.now())` instead of `invalidate()` for synchronous re-rendering before frame capture.
- **The `frameloop` prop** is automatically overridden to `'never'` during rendering -- the scene only re-renders on demand via `advance()`.

### Template

Use the official starter template: https://github.com/remotion-dev/template-three

Features a 3D phone with configurable color, size, thickness, and corner radius. Also see:
- GLB model example: https://github.com/remotion-dev/glb-example
- GLTF loader example: https://github.com/remotion-dev/remotion-three-gltf-example

---

## 2. Remotion + Lottie

**Package:** `@remotion/lottie`
**Docs:** https://www.remotion.dev/docs/lottie

### Installation

```bash
npm i @remotion/lottie lottie-web
```

### Lottie Component Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `animationData` | `LottieAnimationData` | *required* | Lottie JSON object. Memoize to prevent re-initialization. |
| `direction` | `"forward" \| "backward"` | `"forward"` | Playback direction |
| `loop` | `boolean` | `false` | Whether animation loops |
| `playbackRate` | `number` | `1` | Speed multiplier |
| `renderer` | `"svg" \| "canvas" \| "html"` | `"svg"` | Rendering engine (v4.0.105+) |
| `className` | `string` | - | CSS class for container div |
| `style` | `CSSProperties` | - | Inline styles for container div |
| `preserveAspectRatio` | `string` | - | SVG aspect ratio handling (v4.0.105+) |
| `assetsPath` | `string` | - | Folder path for external assets (v4.0.138+) |
| `onAnimationLoaded` | `(item: AnimationItem) => void` | - | Callback when animation initializes (v3.2.29+) |

### Example: Local Lottie File

```tsx
import { Lottie } from "@remotion/lottie";
import animationData from "./animation.json";

export const MyLottieAnimation: React.FC = () => {
  return (
    <Lottie
      animationData={animationData}
      style={{ width: 400, height: 400 }}
    />
  );
};
```

### Example: Remote Lottie File

```tsx
import { Lottie, LottieAnimationData } from "@remotion/lottie";
import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";

const RemoteLottie: React.FC = () => {
  const [handle] = useState(() => delayRender("Loading Lottie animation"));
  const [animationData, setAnimationData] =
    useState<LottieAnimationData | null>(null);

  useEffect(() => {
    fetch("https://assets4.lottiefiles.com/packages/lf20_zyquagfl.json")
      .then((res) => res.json())
      .then((json) => {
        setAnimationData(json);
        continueRender(handle);
      })
      .catch((err) => {
        cancelRender(err);
      });
  }, [handle]);

  if (!animationData) return null;

  return <Lottie animationData={animationData} />;
};
```

**Key pattern:** Always use `delayRender()` / `continueRender()` when loading data asynchronously. The remote resource must support CORS.

### Importing from After Effects

Export your After Effects composition as a Lottie JSON file using the Bodymovin plugin, then use it directly with `<Lottie animationData={...} />`.

**Docs:** https://www.remotion.dev/docs/after-effects

### Limitations

- Remotion uses `lottie-web`'s `.goToAndStop()` method for seeking. Some complex expressions may not render deterministically, causing flickering. This is a `lottie-web` upstream limitation.
- Find premade animations at [LottieFiles](https://lottiefiles.com/).

---

## 3. Remotion + Captions/Subtitles

**Package:** `@remotion/captions`
**Docs:** https://www.remotion.dev/docs/captions/

### Installation

```bash
npm i @remotion/captions
```

### Caption Type

The core data structure for representing timed text:

```ts
type Caption = {
  text: string;       // The word/phrase (include leading whitespace)
  startMs: number;    // Start time in milliseconds
  endMs: number;      // End time in milliseconds
  timestampMs: number | null;  // Optional precise timestamp
  confidence: number | null;   // Optional confidence score
};
```

### TikTok-Style Word-by-Word Captions

Use `createTikTokStyleCaptions()` to segment captions into pages:

```tsx
import { createTikTokStyleCaptions } from "@remotion/captions";

const { pages } = createTikTokStyleCaptions({
  captions: myCaptions,  // Caption[] array
  combineTokensWithinMilliseconds: 800,
});
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `captions` | `Caption[]` | Array of timed caption objects |
| `combineTokensWithinMilliseconds` | `number` | Grouping threshold. Low = word-by-word. High = multi-word pages. |

**Return value -- `pages` array:**

Each page contains:
- `text` -- combined caption text for the page
- `startMs` -- page start time in milliseconds
- `durationMs` -- page duration (v4.0.261+)
- `tokens[]` -- individual words with `text`, `fromMs`, `toMs`

### Example: Rendering TikTok-Style Captions

```tsx
import { useCurrentFrame, useVideoConfig, Sequence } from "remotion";
import { createTikTokStyleCaptions } from "@remotion/captions";

const CaptionPage: React.FC<{ page: Page }> = ({ page }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTimeMs = (frame / fps) * 1000;

  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "center",
      whiteSpace: "pre",
    }}>
      {page.tokens.map((token, i) => {
        const isHighlighted =
          currentTimeMs >= token.fromMs && currentTimeMs < token.toMs;
        return (
          <span
            key={i}
            style={{
              color: isHighlighted ? "#FFD700" : "#FFFFFF",
              fontWeight: isHighlighted ? "bold" : "normal",
              fontSize: 48,
              textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
              transition: "color 0.1s",
            }}
          >
            {token.text}
          </span>
        );
      })}
    </div>
  );
};

// In your composition:
const TikTokCaptions: React.FC<{ captions: Caption[] }> = ({ captions }) => {
  const { fps } = useVideoConfig();
  const { pages } = createTikTokStyleCaptions({
    captions,
    combineTokensWithinMilliseconds: 800,
  });

  return (
    <>
      {pages.map((page, i) => {
        const startFrame = Math.floor((page.startMs / 1000) * fps);
        const durationFrames = Math.ceil((page.durationMs / 1000) * fps);
        return (
          <Sequence key={i} from={startFrame} durationInFrames={durationFrames}>
            <CaptionPage page={page} />
          </Sequence>
        );
      })}
    </>
  );
};
```

**Styling tip:** Use `white-space: pre` to preserve the leading spaces in token text.

### Whisper.cpp Integration

The official TikTok template uses Whisper.cpp for automatic speech recognition:

- Template: https://github.com/remotion-dev/template-tiktok
- Downloads Whisper.cpp and uses speech recognition models
- Supports non-English languages via model configuration
- Outputs `Caption[]` arrays compatible with `createTikTokStyleCaptions()`

### SRT Import

Convert SRT files to the `Caption` type for rendering:

```ts
// Parse SRT content into Caption[]
function parseSRT(srtContent: string): Caption[] {
  const blocks = srtContent.trim().split(/\n\n+/);
  return blocks.map((block) => {
    const lines = block.split("\n");
    const [start, end] = lines[1].split(" --> ").map(timeToMs);
    const text = lines.slice(2).join(" ");
    return {
      text: " " + text,
      startMs: start,
      endMs: end,
      timestampMs: null,
      confidence: null,
    };
  });
}

function timeToMs(time: string): number {
  const [h, m, rest] = time.split(":");
  const [s, ms] = rest.split(",");
  return (+h * 3600 + +m * 60 + +s) * 1000 + +ms;
}
```

---

## 4. Remotion + Charts/Data Visualization

**Docs:** https://www.remotion.dev/docs/resources
**Skills:** https://github.com/remotion-dev/skills/blob/main/skills/remotion/rules/charts.md

### Core Principle

**Disable all animations from third-party charting libraries** -- they cause flickering because Remotion renders frame-by-frame. Instead, drive all animation through `useCurrentFrame()` and `spring()`.

### Approach 1: Animated Bar Charts

```tsx
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

const data = [
  { label: "React", value: 85 },
  { label: "Vue", value: 62 },
  { label: "Angular", value: 48 },
  { label: "Svelte", value: 35 },
];

const BarChart: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 20, height: 400 }}>
      {data.map((item, i) => {
        const progress = spring({
          fps,
          frame: frame - i * 8, // stagger delay
          config: { damping: 12, stiffness: 100 },
        });
        const height = interpolate(progress, [0, 1], [0, item.value * 4]);

        return (
          <div key={item.label} style={{ textAlign: "center" }}>
            <div
              style={{
                width: 80,
                height,
                backgroundColor: "#3498db",
                borderRadius: "4px 4px 0 0",
              }}
            />
            <div style={{ marginTop: 8, color: "#fff", fontSize: 14 }}>
              {item.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};
```

**Pattern:** Use `spring()` with a staggered `frame - i * delay` offset for sequential bar entrances.

### Approach 2: Animated Pie Charts

Use SVG `stroke-dashoffset` for segment reveal animations:

```tsx
const PieChart: React.FC<{ segments: { value: number; color: string }[] }> = ({
  segments,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const radius = 100;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  let accumulated = 0;

  return (
    <svg width={300} height={300} viewBox="-150 -150 300 300">
      {segments.map((seg, i) => {
        const segLength = (seg.value / total) * circumference;
        const progress = spring({
          fps,
          frame: frame - i * 10,
          config: { damping: 15 },
        });
        const offset = interpolate(progress, [0, 1], [segLength, 0]);
        const rotation = (accumulated / total) * 360 - 90;
        accumulated += seg.value;

        return (
          <circle
            key={i}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={40}
            strokeDasharray={`${segLength} ${circumference}`}
            strokeDashoffset={offset}
            transform={`rotate(${rotation})`}
          />
        );
      })}
    </svg>
  );
};
```

### Approach 3: Line Charts with @remotion/paths

```bash
npx remotion add @remotion/paths
```

```tsx
import { evolvePath, getLength, getPointAtLength } from "@remotion/paths";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";

const LineChart: React.FC<{ points: [number, number][] }> = ({ points }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Convert points to SVG path
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
    .join(" ");

  const progress = interpolate(frame, [0, 60], [0, 1], {
    extrapolateRight: "clamp",
  });

  const { strokeDasharray, strokeDashoffset } = evolvePath(progress, d);

  // Tracking dot at the drawing edge
  const length = getLength(d);
  const point = getPointAtLength(d, length * progress);

  return (
    <svg width={800} height={400}>
      <path
        d={d}
        fill="none"
        stroke="#2ecc71"
        strokeWidth={3}
        strokeDasharray={strokeDasharray}
        strokeDashoffset={strokeDashoffset}
      />
      <circle cx={point.x} cy={point.y} r={6} fill="#2ecc71" />
    </svg>
  );
};
```

### D3.js Integration

D3 works well with Remotion for scale calculations, axis generation, and data transformations. The key rule: **use D3 for math and DOM generation, but never for transitions.**

```tsx
import * as d3 from "d3";
import { useCurrentFrame, spring, useVideoConfig } from "remotion";

const D3BarChart: React.FC<{ data: { name: string; value: number }[] }> = ({
  data,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  // D3 scales (pure math, no DOM mutation)
  const xScale = d3
    .scaleBand()
    .domain(data.map((d) => d.name))
    .range([0, innerW])
    .padding(0.3);

  const yScale = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d) => d.value)!])
    .range([innerH, 0]);

  return (
    <svg width={width} height={height}>
      <g transform={`translate(${margin.left},${margin.top})`}>
        {data.map((d, i) => {
          const animProgress = spring({
            fps,
            frame: frame - i * 5,
            config: { damping: 12 },
          });
          const barHeight = (innerH - yScale(d.value)) * animProgress;

          return (
            <rect
              key={d.name}
              x={xScale(d.name)}
              y={innerH - barHeight}
              width={xScale.bandwidth()}
              height={barHeight}
              fill="#e74c3c"
            />
          );
        })}
      </g>
    </svg>
  );
};
```

### Data-Driven Video Generation

For generating videos from dynamic data:

1. Define a Zod schema for your data props
2. Pass data via `inputProps` at render time
3. Use `calculateMetadata()` to dynamically set duration based on data length

```tsx
const chartSchema = z.object({
  dataPoints: z.array(z.object({
    label: z.string(),
    value: z.number(),
  })),
  title: z.string(),
});

// In Root.tsx
<Composition
  id="DataChart"
  component={DataChartVideo}
  schema={chartSchema}
  calculateMetadata={({ props }) => ({
    durationInFrames: props.dataPoints.length * 30 + 60,
  })}
  defaultProps={{
    dataPoints: [{ label: "A", value: 100 }],
    title: "My Chart",
  }}
  width={1920}
  height={1080}
  fps={30}
/>
```

Render with custom data:

```bash
npx remotion render DataChart --props='{"dataPoints":[{"label":"Q1","value":42}],"title":"Revenue"}'
```

---

## 5. Remotion Studio Customization

**Docs:** https://www.remotion.dev/docs/visual-editing

### Zod Schema Props Panel

Define a Zod schema to get an auto-generated visual editor in Remotion Studio.

```tsx
import { z } from "zod";
import { zColor, zTextarea } from "@remotion/zod-types";

export const myVideoSchema = z.object({
  title: z.string().describe("Main heading"),
  subtitle: zTextarea().describe("Description text (multiline)"),
  backgroundColor: zColor().describe("Background color"),
  fontSize: z.number().min(12).max(120).step(2).describe("Font size"),
  showLogo: z.boolean().describe("Display logo overlay"),
  layout: z.enum(["centered", "left-aligned", "split"]).describe("Layout style"),
  items: z.array(z.object({
    name: z.string(),
    value: z.number(),
  })),
});
```

### @remotion/zod-types Special Types

| Type | Description |
|---|---|
| `zColor()` | Color picker UI in the props panel |
| `zTextarea()` | Multiline text input (instead of single-line string) |
| `zMatrix()` | Matrix input for transformations |

Install: `npx remotion add @remotion/zod-types`

Note: `@remotion/zod-types` uses Zod v4 since Remotion v4.0.426. For Zod v3 compatibility, use `@remotion/zod-types-v3`.

### Registering the Schema

```tsx
<Composition
  id="my-video"
  component={MyVideoComponent}
  schema={myVideoSchema}
  defaultProps={{
    title: "Hello World",
    subtitle: "Welcome to Remotion",
    backgroundColor: "#1a1a2e",
    fontSize: 48,
    showLogo: true,
    layout: "centered",
    items: [{ name: "Item 1", value: 42 }],
  }}
  durationInFrames={150}
  width={1920}
  height={1080}
  fps={30}
/>
```

### Using the Props Panel

- Open Studio and press **Cmd/Ctrl + J**, then select the **Props** tab
- All schema-defined props appear as editable controls
- Supported UI controls: text inputs, number sliders (with `.min()`, `.max()`, `.step()`), color pickers, booleans (checkboxes), enums (dropdowns), arrays (add/remove items), dates, and nested objects
- Changes update the preview in real-time
- Click **Save** to write changes back to source code (requires inlined `defaultProps`)
- Click **Render** to generate a video with the modified props without changing code
- Direct JSON editing is available via the JSON option in the panel

### Render Button

The Render button in Remotion Studio provides a full graphical interface:
- Discover and tweak all render options (codec, quality, output path, etc.)
- Queue multiple renders
- Follow render progress
- Reveal output in the file explorer

### Deployed Studio

You can deploy Remotion Studio as a long-running server (e.g., on Fly.io or Render.com). The Render Button remains active, allowing remote video rendering and downloads.

**Docs:** https://www.remotion.dev/blog/deployable-studio

---

## 6. Remotion GitHub Actions CI

### Basic Render on Push

```yaml
name: Render Video
on: push

jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npx remotion render MyComp out/video.mp4
      - uses: actions/upload-artifact@v4
        with:
          name: rendered-video
          path: out/video.mp4
```

### Parametric Renders via workflow_dispatch

```yaml
name: Render Parametric Video
on:
  workflow_dispatch:
    inputs:
      titleText:
        description: "Title text for the video"
        required: true
        default: "Hello World"
      titleColor:
        description: "Title color (hex)"
        required: false
        default: "#ffffff"
      backgroundColor:
        description: "Background color (hex)"
        required: false
        default: "#000000"

jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - name: Render video with custom props
        run: |
          npx remotion render MyComp out/video.mp4 \
            --props='{"titleText":"${{ github.event.inputs.titleText }}","titleColor":"${{ github.event.inputs.titleColor }}","backgroundColor":"${{ github.event.inputs.backgroundColor }}"}'
      - uses: actions/upload-artifact@v4
        with:
          name: parametric-video
          path: out/video.mp4
```

### Matrix Rendering for Speed (up to 6x faster)

**Project:** https://github.com/yuvraj108c/Remotion-Matrix-Renderer

Distributes frame rendering across multiple GitHub Actions runners, then merges outputs into the final video.

#### Integration

```yaml
name: Render Video (Matrix)
on: push

jobs:
  render:
    uses: yuvraj108c/Remotion-Matrix-Renderer/.github/workflows/render-video-matrix.yml@master
    with:
      num_of_workers: 10
      remotion_composition_id: Main
      remotion_entry_point: src/index.ts
```

#### Parameters

| Parameter | Description |
|---|---|
| `num_of_workers` | Number of parallel rendering jobs (recommended < 50) |
| `remotion_composition_id` | Composition ID to render |
| `remotion_entry_point` | Path to your Remotion entry file |

#### Performance Benchmarks (9,000 frames)

| Workers | Render Time |
|---|---|
| 1 | 31m 22s |
| 10 | 6m 17s |
| 20 | 5m 7s |
| 50 | 6m 42s |

Diminishing returns above ~20 workers due to runner allocation overhead.

#### Limitations

- Speed depends on GitHub runner availability
- Private repos consume Actions minutes quickly
- Exceeding ~100 workers risks HTTP failures
- Rendered video is uploaded as a workflow artifact

### Automated Video Generation Pipeline

Combine workflow_dispatch with scheduled triggers for fully automated pipelines:

```yaml
name: Daily Video Report
on:
  schedule:
    - cron: "0 9 * * *"  # Every day at 9 AM UTC
  workflow_dispatch:

jobs:
  fetch-data:
    runs-on: ubuntu-latest
    outputs:
      props: ${{ steps.data.outputs.props }}
    steps:
      - id: data
        run: |
          # Fetch data from your API
          DATA=$(curl -s https://api.example.com/daily-stats)
          echo "props=$DATA" >> $GITHUB_OUTPUT

  render:
    needs: fetch-data
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: |
          npx remotion render DailyReport out/report.mp4 \
            --props='${{ needs.fetch-data.outputs.props }}'
      - uses: actions/upload-artifact@v4
        with:
          name: daily-report
          path: out/report.mp4
```

---

## 7. Prompt Gallery Patterns

**Gallery:** https://www.remotion.dev/prompts
**System prompt:** https://www.remotion.dev/llms.txt

### What the Prompt Gallery Is

A curated showcase of prompts that generate Remotion videos when given to coding agents (Claude Code, Codex, OpenCode, etc.). You can submit your own prompts at https://www.remotion.dev/prompts/submit.

### Popular Prompt Categories

Based on the gallery (sorted by community likes):

| Category | Examples |
|---|---|
| **Geographic/Maps** | Travel route on map with 3D landmarks |
| **News/Editorial** | Headline highlight animations |
| **Product/Marketing** | Launch videos, product demos, promo videos |
| **Data Visualization** | Rankings, timelines, bar + line charts |
| **Motion Graphics** | Cinematic intros, shape-to-word transforms |
| **UI Overlays** | Transparent call-to-action overlays |

### What Makes Prompts Work Well

Based on the Remotion Skills system and LLM system prompt:

1. **Constants-first design** -- Prompts that specify all text, colors, and timing values up front produce better results because the generated code declares editable constants at the top of the file.

2. **Crossfade patterns** -- Describe smooth state transitions between scenes. The code generator favors opacity-based crossfades without layout jumps.

3. **Spring physics** -- Mention "natural" or "organic" motion. The generator uses `spring()` with tuned damping/stiffness for physically plausible animations.

4. **Aesthetic defaults** -- Prompts that describe a visual style (dark theme, neon colors, minimal) get applied as sensible defaults.

5. **Concrete structure** -- Describe specific scenes, durations, and transitions rather than vague goals. Example:
   - Weak: "Make a cool video about our product"
   - Strong: "3-scene product demo: Scene 1 (3s) -- logo zoom-in with particle background; Scene 2 (5s) -- three feature cards sliding in from left with staggered spring animation; Scene 3 (2s) -- CTA with gradient text and subtle pulse"

### Remotion Skills System

Skills are modular knowledge units loaded by coding agents:

- **Guidance Skills** -- Pattern libraries with best practices for specific domains (charts, typography, transitions)
- **Example Skills** -- Complete working code references demonstrating specific animation patterns
- Agents load skills via: `pipeline-map` + `write-improvements` + `capture-format` + `stage-specific`

### Prompt-to-Video SaaS Template

For building your own prompt-to-video product:
https://github.com/remotion-dev/template-prompt-to-motion-graphics-saas

---

## 8. Core Code Generation Rules

From the official Remotion LLM system prompt (https://www.remotion.dev/llms.txt):

### Architecture Requirements

- Every project needs: entry point (`src/index.ts`), Root component (`src/Root.tsx`), and React components
- A `<Composition>` requires: `id`, `component`, `durationInFrames`, `width`, `height`, `fps`, `defaultProps`
- Default settings: 1920x1080, 30 fps

### Determinism

- **`Math.random()` is forbidden.** Use Remotion's `random()` function with a static seed string instead.
- All rendering must be deterministic -- same frame number must always produce the same visual output.

### Animation Toolkit

| Tool | Usage |
|---|---|
| `useCurrentFrame()` | Get current frame number (starts at 0) |
| `useVideoConfig()` | Access `width`, `height`, `fps`, `durationInFrames` |
| `interpolate()` | Map frame ranges to output ranges. Always use `extrapolateRight: "clamp"`. |
| `spring()` | Natural motion with `fps` and `frame` params |
| `<AbsoluteFill>` | Stack layers; later children render on top |
| `<Sequence>` | Place content at specific frame with `from` prop; resets child frame counter |
| `<Series>` | Play sequences consecutively |
| `<TransitionSeries>` | Add transitions between sequences |

### Media Tags

| Element | Remotion Component |
|---|---|
| Video | `<Video>` or `<OffthreadVideo>` |
| Image | `<Img>` |
| GIF | `<Gif>` |
| Audio | `<Audio>` |

- Reference local assets via `staticFile("filename.ext")` from the `public/` folder
- Media supports `trimBefore`, `trimAfter` for trimming
- Audio/Video `volume` prop accepts 0-1 range

### Rendering Commands

```bash
# Render video
npx remotion render [compositionId] [outputPath]

# Render still frame
npx remotion still [compositionId] [outputPath]

# With custom props
npx remotion render MyComp out.mp4 --props='{"key":"value"}'
```

---

## Sources

- [@remotion/three docs](https://www.remotion.dev/docs/three)
- [ThreeCanvas docs](https://www.remotion.dev/docs/three-canvas)
- [Three.js template](https://github.com/remotion-dev/template-three)
- [@remotion/lottie docs](https://www.remotion.dev/docs/lottie)
- [Lottie component API](https://www.remotion.dev/docs/lottie/lottie)
- [Remote Lottie loading](https://www.remotion.dev/docs/lottie/remote)
- [After Effects import](https://www.remotion.dev/docs/after-effects)
- [@remotion/captions docs](https://www.remotion.dev/docs/captions/)
- [createTikTokStyleCaptions API](https://www.remotion.dev/docs/captions/create-tiktok-style-captions)
- [TikTok template](https://github.com/remotion-dev/template-tiktok)
- [Charts skill rules](https://github.com/remotion-dev/skills/blob/main/skills/remotion/rules/charts.md)
- [Zod schemas docs](https://www.remotion.dev/docs/schemas)
- [Visual editing docs](https://www.remotion.dev/docs/visual-editing)
- [@remotion/zod-types](https://www.remotion.dev/docs/zod-types/)
- [Remotion Matrix Renderer](https://github.com/yuvraj108c/Remotion-Matrix-Renderer)
- [Parametric rendering](https://v3.remotion.dev/docs/parametrized-rendering)
- [Prompt Gallery](https://www.remotion.dev/prompts)
- [Remotion LLM system prompt](https://www.remotion.dev/llms.txt)
- [Prompt-to-video SaaS template](https://github.com/remotion-dev/template-prompt-to-motion-graphics-saas)
- [Deployed Studio](https://www.remotion.dev/blog/deployable-studio)
