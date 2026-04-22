import type React from "react";
import { staticFile } from "remotion";
import { z } from "zod";
import { resolveStatic } from "../_helpers";
import { buildMediaEffectStyle } from "../effectStackRuntime";
import { MediaClip } from "../MediaClip";
import { secondsToStartFrame } from "../mediaRuntime";
import { getExponentialTriggerDecay } from "../modulationRuntime";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  videoSrc: z.string(),
  videoStartSec: z.number().min(0).max(600).step(0.01),
  opacity: z.number().min(0).max(1).step(0.01),
  scale: z.number().min(0.1).max(5).step(0.01),
  beatBrightnessBoost: z.number().min(0).max(4).step(0.05),
  beatBrightnessDecay: z.number().min(0).max(20).step(0.1),
  objectFit: z.enum(["cover", "contain", "fill"]),
  muted: z.boolean(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  videoSrc: "",
  videoStartSec: 0,
  opacity: 1,
  scale: 1,
  beatBrightnessBoost: 0,
  beatBrightnessDecay: 5,
  objectFit: "cover",
  muted: true,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    videoSrc,
    videoStartSec,
    opacity,
    scale,
    beatBrightnessBoost,
    beatBrightnessDecay,
    objectFit,
    muted,
  } = element.props;
  if (!videoSrc) return null;
  const resolved = resolveStatic(videoSrc, staticFile, ctx.assetRegistry);

  let brightness = 1;
  if (beatBrightnessBoost > 0) {
    const lastBeat = ctx.beats.lastBeatBefore(ctx.absTimeSec);
    if (lastBeat != null && lastBeat >= element.startSec) {
      brightness = getExponentialTriggerDecay({
        lastTriggerAt: lastBeat,
        tSec: ctx.absTimeSec,
        decay: beatBrightnessDecay,
        amplitude: beatBrightnessBoost,
        baseline: 1,
      });
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        ...buildMediaEffectStyle({
          opacity,
          scale,
          effects: brightness !== 1 ? [{ type: "brightness", amount: brightness }] : [],
        }),
      }}
    >
      <MediaClip
        source={{
          kind: "video",
          src: resolved,
          muted,
          startFromFrame: secondsToStartFrame(videoStartSec, ctx.fps),
        }}
        fit={objectFit}
      />
    </div>
  );
};

export const VideoClipModule: ElementModule<Props> = {
  id: "overlay.videoClip",
  category: "video",
  label: "Video Clip",
  description: "OffthreadVideo layer with optional beat-synced brightness boost",
  defaultDurationSec: 10,
  defaultTrack: 8,
  schema,
  defaults,
  mediaFields: [{ name: "videoSrc", kind: "video" }],
  Renderer,
};
