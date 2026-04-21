import type React from "react";
import { z } from "zod";
import { expDecay } from "../_helpers";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  fadeInBeats: z.number().int().min(0).max(64),
  holdBeats: z.number().int().min(0).max(64),
  flashColor: z.string(),
  flashDecay: z.number().min(0).max(20).step(0.1),
  holdColor: z.string(),
  finalOpacity: z.number().min(0).max(1).step(0.01),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  fadeInBeats: 8,
  holdBeats: 4,
  flashColor: "#ffffff",
  flashDecay: 5,
  holdColor: "#000000",
  finalOpacity: 1,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { fadeInBeats, holdBeats, flashColor, flashDecay, holdColor, finalOpacity } = element.props;
  const dropTime = element.startSec + element.durationSec;

  const beatsBeforeDrop = ctx.beats.beats.filter((t) => t <= dropTime);
  if (beatsBeforeDrop.length < fadeInBeats + holdBeats + 1) {
    return <div style={{ position: "absolute", inset: 0, background: holdColor, opacity: 0 }} />;
  }
  const dropBeatIdx = beatsBeforeDrop.length - 1;
  const holdStartIdx = dropBeatIdx - holdBeats;
  const fadeStartIdx = holdStartIdx - fadeInBeats;
  const fadeStartT = beatsBeforeDrop[fadeStartIdx] ?? element.startSec;
  const holdStartT = beatsBeforeDrop[holdStartIdx] ?? dropTime;

  let phase: "pre" | "fade" | "hold" | "flash" = "pre";
  if (ctx.absTimeSec < fadeStartT) phase = "pre";
  else if (ctx.absTimeSec < holdStartT) phase = "fade";
  else if (ctx.absTimeSec < dropTime) phase = "hold";
  else phase = "flash";

  if (phase === "pre") return null;

  if (phase === "fade") {
    const p = (ctx.absTimeSec - fadeStartT) / Math.max(0.001, holdStartT - fadeStartT);
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: holdColor,
          opacity: Math.max(0, Math.min(1, p)) * finalOpacity,
          pointerEvents: "none",
        }}
      />
    );
  }
  if (phase === "hold") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: holdColor,
          opacity: finalOpacity,
          pointerEvents: "none",
        }}
      />
    );
  }
  // flash: flash color with decay envelope after the drop
  const op = expDecay(ctx.absTimeSec - dropTime, flashDecay);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: flashColor,
        opacity: op,
        pointerEvents: "none",
      }}
    />
  );
};

export const PreDropFadeHoldModule: ElementModule<Props> = {
  id: "overlay.preDropFadeHold",
  category: "overlay",
  label: "Pre-Drop Fade + Hold",
  description: "N-beat black fade-in → M-beat hold → white flash at drop (element end)",
  defaultDurationSec: 12,
  defaultTrack: 6,
  schema,
  defaults,
  Renderer,
};
