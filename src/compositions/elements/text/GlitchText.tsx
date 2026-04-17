import React from "react";
import { z } from "zod";
import { random } from "remotion";
import type { ElementModule, ElementRendererProps } from "../types";
import { FONT_STACK } from "../_helpers";

const schema = z.object({
  text: z.string(),
  textColor: z.string(),
  glitchColor1: z.string(),
  glitchColor2: z.string(),
  fontSize: z.number(),
  fontWeight: z.number(),
  fontFamily: z.string(),
  glitchStrength: z.number(),
  glitchSpeed: z.number(),
  sporadicChance: z.number(),
  x: z.number(),
  y: z.number(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  text: "GLITCH",
  textColor: "#ffffff",
  glitchColor1: "#00ffff",
  glitchColor2: "#ff00ff",
  fontSize: 120,
  fontWeight: 700,
  fontFamily: FONT_STACK,
  glitchStrength: 6,
  glitchSpeed: 0.4,
  sporadicChance: 0.1,
  x: 50,
  y: 50,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { text, textColor, glitchColor1, glitchColor2, fontSize, fontWeight,
    fontFamily, glitchStrength, glitchSpeed, sporadicChance, x, y } = element.props;
  const t = ctx.frame * glitchSpeed;
  const sporadic = random(`glitch-${element.id}-${ctx.frame}`) < sporadicChance
    ? glitchStrength * 2
    : 0;
  const dx1 = Math.sin(t) * glitchStrength + sporadic;
  const dx2 = Math.cos(t * 1.3) * glitchStrength - sporadic;
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    fontFamily,
    fontSize,
    fontWeight,
    letterSpacing: "0.04em",
    whiteSpace: "pre",
  };
  return (
    <div style={{ position: "absolute", left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}>
      <div style={{ position: "relative", display: "inline-block" }}>
        <span style={{ ...baseStyle, color: glitchColor1, opacity: 0.7, transform: `translate(${dx1}px, 0)`, mixBlendMode: "screen" }}>{text}</span>
        <span style={{ ...baseStyle, color: glitchColor2, opacity: 0.7, transform: `translate(${dx2}px, 0)`, mixBlendMode: "screen" }}>{text}</span>
        <span style={{ ...baseStyle, color: textColor, position: "relative" }}>{text}</span>
      </div>
    </div>
  );
};

export const GlitchTextModule: ElementModule<Props> = {
  id: "text.glitch",
  category: "text",
  label: "Glitch Text",
  description: "RGB-split glitch with sine offsets + sporadic hits",
  defaultDurationSec: 2,
  defaultTrack: 0,
  schema,
  defaults,
  Renderer,
};
