import type React from "react";
import { useMemo } from "react";
import { evolvePath, getLength } from "@remotion/paths";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

// Progressive SVG path stroke-on. Rewritten on @remotion/paths so the
// stroke math is:
//   - deterministic (no dependency on DOM getTotalLength, which was
//     hard-coded to 1000 during headless render so every stroke used
//     the wrong dash length)
//   - exact (evolvePath returns the precise dasharray+offset for any
//     progress value 0..1)
//   - SSR-friendly (no document access at all)
//
// Visible props unchanged — any project timeline using the old element
// continues to work byte-for-byte at the same (progress, path) tuple.
// The only behavioural change is that headless renders now actually draw
// the intended dash length instead of a 1000px approximation that chopped
// long paths off early and dragged short paths out.

const schema = z.object({
  svgPath: z.string(),
  viewBoxWidth: z.number().min(1).max(10000),
  viewBoxHeight: z.number().min(1).max(10000),
  stroke: z.string(),
  strokeWidth: z.number().min(0.5).max(50).step(0.5),
  fill: z.string(),
  x: z.number().min(-50).max(150),
  y: z.number().min(-50).max(150),
  widthPct: z.number().min(1).max(200),
  heightPct: z.number().min(1).max(200),
  triggerOnBeats: z.boolean(),
  drawDurationFrames: z.number().int().min(1).max(600),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  svgPath: "M10 100 Q 50 10, 100 100 T 190 100",
  viewBoxWidth: 200,
  viewBoxHeight: 200,
  stroke: "#ffffff",
  strokeWidth: 4,
  fill: "none",
  x: 50,
  y: 50,
  widthPct: 40,
  heightPct: 40,
  triggerOnBeats: false,
  drawDurationFrames: 24,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    svgPath,
    viewBoxWidth,
    viewBoxHeight,
    stroke,
    strokeWidth,
    fill,
    x,
    y,
    widthPct,
    heightPct,
    triggerOnBeats,
    drawDurationFrames,
  } = element.props;

  // Bail if the path string is empty or malformed so getLength doesn't
  // throw in the headless bundle. A missing `svgPath` shouldn't crash
  // the whole render — it just draws nothing for this element.
  const pathOk = typeof svgPath === "string" && svgPath.trim().length > 0;

  let progress: number;
  if (triggerOnBeats) {
    const lastBeat = ctx.beats.lastBeatBefore(ctx.absTimeSec);
    if (lastBeat == null || lastBeat < element.startSec) {
      progress = 0;
    } else {
      const framesSinceBeat = Math.max(0, (ctx.absTimeSec - lastBeat) * ctx.fps);
      progress = Math.max(0, Math.min(1, framesSinceBeat / drawDurationFrames));
    }
  } else {
    progress = ctx.elementProgress;
  }

  const { strokeDasharray, strokeDashoffset } = useMemo(() => {
    if (!pathOk) return { strokeDasharray: "0 1", strokeDashoffset: 0 };
    try {
      return evolvePath(progress, svgPath);
    } catch {
      // Invalid path string — fall back to "nothing drawn" rather than
      // crashing the whole composition.
      return { strokeDasharray: "0 1", strokeDashoffset: 0 };
    }
    // progress is stable per-frame; re-memoize only when it or the path
    // changes. getLength() internally parses the path so this block is
    // the hot loop for PathReveal.
  }, [progress, svgPath, pathOk]);

  const svgW = ctx.width * (widthPct / 100);
  const svgH = ctx.height * (heightPct / 100);

  if (!pathOk) return null;

  return (
    <svg
      role="img"
      aria-label="Path reveal shape"
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      width={svgW}
      height={svgH}
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
      }}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>Path reveal</title>
      <path
        d={svgPath}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
        strokeDasharray={strokeDasharray}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// Intentionally exported both as named + default so the registry import
// (named) and any future dynamic import (default) both work.
export const PathRevealModule: ElementModule<Props> = {
  id: "shape.pathReveal",
  category: "shape",
  label: "Path Reveal",
  description: "Progressive SVG path stroke-on, optional beat trigger.",
  defaultDurationSec: 2,
  defaultTrack: 4,
  schema,
  defaults,
  Renderer,
};

// Silence the unused-import warning for getLength — the symbol is kept
// explicit so the rewrite's dependency on @remotion/paths is visible to
// readers even though evolvePath is the only call site in the hot path.
void getLength;

export default PathRevealModule;
