import React from "react";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  svgPath: z.string(),
  viewBoxWidth: z.number(),
  viewBoxHeight: z.number(),
  stroke: z.string(),
  strokeWidth: z.number(),
  fill: z.string(),
  x: z.number(),
  y: z.number(),
  widthPct: z.number(),
  heightPct: z.number(),
  triggerOnBeats: z.boolean(),
  drawDurationFrames: z.number(),
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

const useApproxPathLength = (d: string): number => {
  return React.useMemo(() => {
    if (typeof document === "undefined") return 1000;
    try {
      const svgNS = "http://www.w3.org/2000/svg";
      const el = document.createElementNS(svgNS, "path");
      el.setAttribute("d", d);
      return (el as SVGPathElement).getTotalLength?.() ?? 1000;
    } catch {
      return 1000;
    }
  }, [d]);
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
  const pathLen = useApproxPathLength(svgPath);

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

  const dash = pathLen * progress;
  const svgW = ctx.width * (widthPct / 100);
  const svgH = ctx.height * (heightPct / 100);

  return (
    <svg
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
      <path
        d={svgPath}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
        strokeDasharray={`${dash} ${pathLen}`}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const PathRevealModule: ElementModule<Props> = {
  id: "shape.pathReveal",
  category: "shape",
  label: "Path Reveal",
  description: "Progressive SVG path stroke-on, optional beat trigger",
  defaultDurationSec: 2,
  defaultTrack: 4,
  schema,
  defaults,
  Renderer,
};
