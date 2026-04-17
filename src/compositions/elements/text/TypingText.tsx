import React from "react";
import { z } from "zod";
import { interpolate } from "remotion";
import type { ElementModule, ElementRendererProps } from "../types";
import { FONT_STACK } from "../_helpers";

const schema = z.object({
  text: z.string(),
  textColor: z.string(),
  cursorColor: z.string(),
  fontSize: z.number(),
  fontWeight: z.number(),
  fontFamily: z.string(),
  durationInFramesToType: z.number(),
  cursorBlinkSpeed: z.number(),
  textAlign: z.enum(["left", "center", "right"]),
  x: z.number(),
  y: z.number(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  text: "HELLO WORLD",
  textColor: "#ffffff",
  cursorColor: "#ffffff",
  fontSize: 72,
  fontWeight: 300,
  fontFamily: FONT_STACK,
  durationInFramesToType: 48,
  cursorBlinkSpeed: 12,
  textAlign: "center",
  x: 50,
  y: 50,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { text, textColor, cursorColor, fontSize, fontWeight, fontFamily,
    durationInFramesToType, cursorBlinkSpeed, textAlign, x, y } = element.props;
  const localFrame = ctx.frame - Math.round(element.startSec * ctx.fps);
  const visibleCount = Math.floor(
    interpolate(localFrame, [0, durationInFramesToType], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const visible = text.slice(0, visibleCount);
  const cursorOn = Math.floor(localFrame / cursorBlinkSpeed) % 2 === 0;
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        textAlign,
        fontFamily,
        fontSize,
        fontWeight,
        color: textColor,
        letterSpacing: "0.02em",
        whiteSpace: "pre",
      }}
    >
      {visible}
      <span style={{ color: cursorColor, opacity: cursorOn ? 1 : 0 }}>|</span>
    </div>
  );
};

export const TypingTextModule: ElementModule<Props> = {
  id: "text.typing",
  category: "text",
  label: "Typing Text",
  description: "Typewriter char-by-char reveal with blinking cursor",
  defaultDurationSec: 3,
  defaultTrack: 0,
  schema,
  defaults,
  Renderer,
};
