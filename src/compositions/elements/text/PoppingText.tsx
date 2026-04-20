import type React from "react";
import { spring } from "remotion";
import { z } from "zod";
import { FONT_STACK } from "../_helpers";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  text: z.string(),
  colors: z.array(z.string()),
  fontSize: z.number(),
  fontWeight: z.number(),
  fontFamily: z.string(),
  delayPerChar: z.number(),
  damping: z.number(),
  stiffness: z.number(),
  x: z.number(),
  y: z.number(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  text: "POP",
  colors: ["#ff4444", "#ffaa00", "#44ff88", "#44aaff", "#aa44ff"],
  fontSize: 140,
  fontWeight: 800,
  fontFamily: FONT_STACK,
  delayPerChar: 3,
  damping: 10,
  stiffness: 180,
  x: 50,
  y: 50,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { text, colors, fontSize, fontWeight, fontFamily, delayPerChar, damping, stiffness, x, y } =
    element.props;
  const localFrame = ctx.frame - Math.round(element.startSec * ctx.fps);
  const chars = [...text];
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        display: "flex",
        fontFamily,
        fontSize,
        fontWeight,
      }}
    >
      {chars.map((ch, i) => {
        const s = spring({
          frame: Math.max(0, localFrame - i * delayPerChar),
          fps: ctx.fps,
          config: { damping, stiffness, mass: 1 },
        });
        const opacity = Math.max(0, Math.min(1, s));
        const scale = s;
        const color = colors[i % colors.length] ?? "#fff";
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
            key={i}
            style={{
              color,
              opacity,
              transform: `scale(${scale})`,
              display: "inline-block",
              whiteSpace: "pre",
            }}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
};

export const PoppingTextModule: ElementModule<Props> = {
  id: "text.popping",
  category: "text",
  label: "Popping Text",
  description: "Per-char spring pop-in with color cycling",
  defaultDurationSec: 2,
  defaultTrack: 0,
  schema,
  defaults,
  Renderer,
};
