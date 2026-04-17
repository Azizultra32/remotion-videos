import React from "react";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";
import { expDecay } from "../_helpers";

const schema = z.object({
  svgPath: z.string(),
  viewBoxWidth: z.number(),
  viewBoxHeight: z.number(),
  outerColor: z.string(),
  outerBlur: z.number(),
  outerWidth: z.number(),
  midColor: z.string(),
  midBlur: z.number(),
  midWidth: z.number(),
  innerColor: z.string(),
  innerWidth: z.number(),
  coreColor: z.string(),
  coreWidth: z.number(),
  flickerOnBeats: z.boolean(),
  flickerDecay: z.number(),
  x: z.number(),
  y: z.number(),
  widthPct: z.number(),
  heightPct: z.number(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  svgPath: "M20 80 L 180 80",
  viewBoxWidth: 200,
  viewBoxHeight: 160,
  outerColor: "#ff00aa",
  outerBlur: 8,
  outerWidth: 14,
  midColor: "#ff55cc",
  midBlur: 2,
  midWidth: 8,
  innerColor: "#ff99dd",
  innerWidth: 4,
  coreColor: "#ffffff",
  coreWidth: 1.5,
  flickerOnBeats: true,
  flickerDecay: 6,
  x: 50,
  y: 50,
  widthPct: 60,
  heightPct: 30,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { svgPath, viewBoxWidth, viewBoxHeight, outerColor, outerBlur, outerWidth,
    midColor, midBlur, midWidth, innerColor, innerWidth, coreColor, coreWidth,
    flickerOnBeats, flickerDecay, x, y, widthPct, heightPct } = element.props;

  const svgW = ctx.width * (widthPct / 100);
  const svgH = ctx.height * (heightPct / 100);

  let intensity = 1;
  if (flickerOnBeats) {
    const lastBeat = ctx.beats.lastBeatBefore(ctx.absTimeSec);
    intensity = lastBeat == null ? 0.3 : 0.3 + 0.7 * expDecay(ctx.absTimeSec - lastBeat, flickerDecay);
  }

  const filterId = `neon-blur-${element.id}`;
  const filterId2 = `neon-blur-mid-${element.id}`;

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
        opacity: intensity,
      }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <filter id={filterId}><feGaussianBlur stdDeviation={outerBlur} /></filter>
        <filter id={filterId2}><feGaussianBlur stdDeviation={midBlur} /></filter>
      </defs>
      <path d={svgPath} stroke={outerColor} strokeWidth={outerWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${filterId})`} />
      <path d={svgPath} stroke={midColor} strokeWidth={midWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${filterId2})`} />
      <path d={svgPath} stroke={innerColor} strokeWidth={innerWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d={svgPath} stroke={coreColor} strokeWidth={coreWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export const NeonStrokeStackModule: ElementModule<Props> = {
  id: "shape.neonStack",
  category: "shape",
  label: "Neon Stroke Stack",
  description: "4-layer stacked blur strokes for neon/glow, beat-flicker optional",
  defaultDurationSec: 4,
  defaultTrack: 4,
  schema,
  defaults,
  Renderer,
};
