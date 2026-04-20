import type React from "react";
import { spring } from "remotion";
import { z } from "zod";
import { FONT_STACK } from "../_helpers";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  text: z.string(),
  textColor: z.string(),
  fontSize: z.number(),
  fontWeight: z.number(),
  fontFamily: z.string(),
  slideDirection: z.enum(["left", "right", "top", "bottom"]),
  initialOffset: z.number(),
  damping: z.number(),
  stiffness: z.number(),
  x: z.number(),
  y: z.number(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  text: "SLIDING",
  textColor: "#ffffff",
  fontSize: 96,
  fontWeight: 300,
  fontFamily: FONT_STACK,
  slideDirection: "left",
  initialOffset: 400,
  damping: 18,
  stiffness: 120,
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
    slideDirection,
    initialOffset,
    damping,
    stiffness,
    x,
    y,
  } = element.props;
  const localFrame = ctx.frame - Math.round(element.startSec * ctx.fps);
  const s = spring({
    frame: Math.max(0, localFrame),
    fps: ctx.fps,
    config: { damping, stiffness, mass: 1 },
  });
  const progress = Math.max(0, Math.min(1, s));
  const offset = initialOffset * (1 - progress);
  let tx = 0,
    ty = 0;
  if (slideDirection === "left") tx = -offset;
  else if (slideDirection === "right") tx = offset;
  else if (slideDirection === "top") ty = -offset;
  else ty = offset;
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px)`,
        opacity: progress,
        fontFamily,
        fontSize,
        fontWeight,
        color: textColor,
        letterSpacing: "0.04em",
        whiteSpace: "pre",
      }}
    >
      {text}
    </div>
  );
};

export const SlidingTextModule: ElementModule<Props> = {
  id: "text.sliding",
  category: "text",
  label: "Sliding Text",
  description: "Directional slide-in with spring + fade",
  defaultDurationSec: 2,
  defaultTrack: 0,
  schema,
  defaults,
  Renderer,
};
