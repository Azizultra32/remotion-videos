import type React from "react";
import { z } from "zod";
import { FONT_STACK, gaussian } from "../_helpers";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  text: z.string(),
  textColor: z.string(),
  fontSize: z.number(),
  fontWeight: z.number(),
  fontFamily: z.string(),
  letterSpacing: z.string(),
  sigmaSec: z.number(),
  zoomFrom: z.number(),
  zoomTo: z.number(),
  bassReactive: z.boolean(),
  bassGlowMax: z.number(),
  x: z.number(),
  y: z.number(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  text: "AHURA",
  textColor: "#ffffff",
  fontSize: 380,
  fontWeight: 200,
  fontFamily: FONT_STACK,
  letterSpacing: "0.08em",
  sigmaSec: 2.5,
  zoomFrom: 1.3,
  zoomTo: 0.95,
  bassReactive: false,
  bassGlowMax: 40,
  x: 50,
  y: 50,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    text,
    textColor,
    fontSize,
    fontWeight,
    fontFamily,
    letterSpacing,
    sigmaSec,
    zoomFrom,
    zoomTo,
    bassGlowMax,
    x,
    y,
  } = element.props;
  const peakSec = element.startSec + element.durationSec / 2;
  const opacity = gaussian(ctx.absTimeSec, peakSec, sigmaSec);
  const p = ctx.elementProgress;
  const scale = zoomFrom + (zoomTo - zoomFrom) * p;
  const glow = opacity * bassGlowMax;
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity,
        fontFamily,
        fontSize,
        fontWeight,
        letterSpacing,
        color: textColor,
        textTransform: "uppercase",
        textShadow:
          glow > 1
            ? `0 0 ${glow}px rgba(255,255,255,0.8), 0 0 ${glow * 2.5}px rgba(180,180,255,0.25)`
            : "none",
        whiteSpace: "pre",
      }}
    >
      {text}
    </div>
  );
};

export const BellCurveRevealModule: ElementModule<Props> = {
  id: "text.bellCurve",
  category: "text",
  label: "Bell Curve Reveal",
  description: "Gaussian opacity envelope peaking at element midpoint — text fades in then out",
  defaultDurationSec: 10,
  defaultTrack: 0,
  schema,
  defaults,
  Renderer,
};
