import type React from "react";
import { OffthreadVideo, staticFile } from "remotion";
import { z } from "zod";
import { expDecay, resolveStatic } from "../_helpers";
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
  const resolved = resolveStatic(videoSrc, staticFile);

  let brightness = 1;
  if (beatBrightnessBoost > 0) {
    const lastBeat = ctx.beats.lastBeatBefore(ctx.absTimeSec);
    if (lastBeat != null && lastBeat >= element.startSec) {
      brightness =
        1 + beatBrightnessBoost * expDecay(ctx.absTimeSec - lastBeat, beatBrightnessDecay);
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity,
        transform: `scale(${scale})`,
        filter: brightness !== 1 ? `brightness(${brightness})` : undefined,
        overflow: "hidden",
      }}
    >
      <OffthreadVideo
        src={resolved}
        startFrom={Math.round(videoStartSec * ctx.fps)}
        muted={muted}
        style={{ width: "100%", height: "100%", objectFit }}
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
