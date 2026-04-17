import React from "react";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";
import { FONT_STACK } from "../_helpers";

const schema = z.object({
  text: z.string(),
  textColor: z.string(),
  fontWeight: z.number(),
  fontFamily: z.string(),
  fillPct: z.number(),
  heightPct: z.number(),
  x: z.number(),
  y: z.number(),
  fadeInFrames: z.number(),
  fadeOutFrames: z.number(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  text: "DROP",
  textColor: "#ffffff",
  fontWeight: 200,
  fontFamily: FONT_STACK,
  fillPct: 90,
  heightPct: 40,
  x: 50,
  y: 50,
  fadeInFrames: 6,
  fadeOutFrames: 6,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { text, textColor, fontWeight, fontFamily, fillPct, heightPct, x, y, fadeInFrames, fadeOutFrames } = element.props;
  const localFrame = ctx.frame - Math.round(element.startSec * ctx.fps);
  const durationFrames = Math.max(1, Math.round(element.durationSec * ctx.fps));
  const fadeIn = Math.min(1, localFrame / Math.max(1, fadeInFrames));
  const fadeOut = Math.min(1, (durationFrames - localFrame) / Math.max(1, fadeOutFrames));
  const opacity = Math.max(0, Math.min(1, Math.min(fadeIn, fadeOut)));

  const svgW = ctx.width * (fillPct / 100);
  const svgH = ctx.height * (heightPct / 100);
  const probeFontSize = 400;

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      width={svgW}
      height={svgH}
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        opacity,
      }}
      preserveAspectRatio="xMidYMid meet"
    >
      <text
        x={svgW / 2}
        y={svgH / 2}
        textLength={svgW}
        lengthAdjust="spacingAndGlyphs"
        dominantBaseline="central"
        textAnchor="middle"
        fill={textColor}
        fontFamily={fontFamily}
        fontWeight={fontWeight}
        fontSize={probeFontSize}
        style={{ textTransform: "uppercase" }}
      >
        {text.toUpperCase()}
      </text>
    </svg>
  );
};

export const FitboxSVGWordModule: ElementModule<Props> = {
  id: "text.fitboxSVG",
  category: "text",
  label: "Fitbox SVG Word",
  description: "Full-frame SVG word auto-fit via textLength + spacingAndGlyphs",
  defaultDurationSec: 2,
  defaultTrack: 1,
  schema,
  defaults,
  Renderer,
};
