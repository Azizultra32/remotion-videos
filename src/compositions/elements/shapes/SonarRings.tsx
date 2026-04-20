import type React from "react";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  color: z.string(),
  strokeWidth: z.number(),
  ringLifeSec: z.number(),
  maxRadiusPct: z.number(),
  triggerOn: z.enum(["beats", "downbeats", "drops"]),
  x: z.number(),
  y: z.number(),
  fadeExponent: z.number(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  color: "#ffffff",
  strokeWidth: 2,
  ringLifeSec: 1.2,
  maxRadiusPct: 80,
  triggerOn: "downbeats",
  x: 50,
  y: 50,
  fadeExponent: 1.5,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { color, strokeWidth, ringLifeSec, maxRadiusPct, triggerOn, x, y, fadeExponent } =
    element.props;
  const source =
    triggerOn === "beats"
      ? ctx.beats.beats
      : triggerOn === "downbeats"
        ? ctx.beats.downbeats
        : ctx.beats.drops;
  const lookback = ctx.absTimeSec - ringLifeSec;
  const active = source.filter(
    (t) => t >= Math.max(element.startSec, lookback) && t <= ctx.absTimeSec,
  );
  if (active.length === 0) return null;

  const cx = ctx.width * (x / 100);
  const cy = ctx.height * (y / 100);
  const maxR = Math.min(ctx.width, ctx.height) * (maxRadiusPct / 100);

  return (
    <svg
      width={ctx.width}
      height={ctx.height}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {active.map((ts, i) => {
        const age = (ctx.absTimeSec - ts) / ringLifeSec;
        const r = age * maxR;
        const opacity = (1 - age) ** fadeExponent;
        return (
          <circle
            key={`${ts}-${i}`}
            cx={cx}
            cy={cy}
            r={r}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            opacity={opacity}
          />
        );
      })}
    </svg>
  );
};

export const SonarRingsModule: ElementModule<Props> = {
  id: "shape.sonarRings",
  category: "shape",
  label: "Sonar Rings",
  description: "Expanding rings triggered on beats/downbeats/drops",
  defaultDurationSec: 20,
  defaultTrack: 5,
  schema,
  defaults,
  Renderer,
};
