import type React from "react";
import { useMemo } from "react";
import { z } from "zod";
import { getLinearTriggerDecay } from "../modulationRuntime";
import { getTriggerState, selectTriggerTimes } from "../triggerRuntime";
import type { ElementModule, ElementRendererProps } from "../types";

// Beat-gated color flash: on each beat/downbeat/drop, a full-frame color
// overlay ramps from maxOpacity down to 0 over flashDurationSec. Simple
// color pulse — useful for strobe-adjacent effects or cross-cut color
// grading that punches on rhythm.
//
// "Manual adjustment": the overlay's existing startSec/durationSec on the
// timeline bracket when it's active at all; props control flash duration
// per beat and max intensity. Combines naturally with other overlays via
// mix-blend-mode.

const schema = z.object({
  color: z.string(),
  triggerOn: z.enum(["beats", "downbeats", "drops"]),
  everyN: z.number().int().min(1).max(32),
  flashDurationSec: z.number().min(0.02).max(2),
  maxOpacity: z.number().min(0).max(1),
  blendMode: z.enum(["normal", "screen", "multiply", "overlay", "lighten", "difference"]),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  color: "#ffffff",
  triggerOn: "downbeats",
  everyN: 1,
  flashDurationSec: 0.2,
  maxOpacity: 0.45,
  blendMode: "screen",
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { color, triggerOn, everyN, flashDurationSec, maxOpacity, blendMode } = element.props;

  const tSec = ctx.frame / Math.max(1, ctx.fps);
  const triggerTimes = selectTriggerTimes(ctx.beats, triggerOn);

  // Find most recent "every Nth" trigger <= tSec.
  const lastTriggerAt = useMemo(
    () =>
      getTriggerState({
        triggerTimes,
        tSec,
        everyN,
        itemCount: 1,
      }).lastNthTriggerAt,
    [everyN, tSec, triggerTimes],
  );

  const opacity = getLinearTriggerDecay({
    lastTriggerAt,
    tSec,
    durationSec: flashDurationSec,
    peak: maxOpacity,
  });

  if (opacity <= 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: color,
        opacity,
        mixBlendMode: blendMode as React.CSSProperties["mixBlendMode"],
        pointerEvents: "none",
      }}
    />
  );
};

export const BeatColorFlashModule: ElementModule<Props> = {
  id: "overlay.beatColorFlash",
  category: "overlay",
  label: "Beat Color Flash",
  description:
    "Full-frame color overlay that punches to maxOpacity on every Nth beat, fades to 0 over flashDurationSec.",
  defaultDurationSec: 30,
  defaultTrack: 7,
  schema,
  defaults,
  Renderer,
};
