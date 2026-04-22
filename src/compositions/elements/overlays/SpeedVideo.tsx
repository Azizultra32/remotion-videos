import type React from "react";
import { staticFile } from "remotion";
import { z } from "zod";
import { resolveStatic } from "../_helpers";
import { buildMediaEffectStyle } from "../effectStackRuntime";
import { MediaClip } from "../MediaClip";
import { getPercentBoxStyle, secondsToStartFrame } from "../mediaRuntime";
import type { ElementModule, ElementRendererProps } from "../types";

// Speed-adjustable video. A single clip with playbackRate + startFromSec +
// audio-reactive bass-brightness boost. playbackRate can be any positive
// real — 0.5 for half-speed, 2.0 for double. Remotion handles decoding the
// right source frame per composition frame based on playbackRate.
//
// For beat-synchronized speed ramps, the intended workflow is to lay down
// multiple SpeedVideo instances on the timeline covering successive ranges
// (e.g., one at playbackRate=1.0 for bars 1-4, another at 0.5 for bars 5-8,
// etc.). Future enhancement: per-element keyframed playbackRate curves.

const schema = z.object({
  videoSrc: z.string(),
  playbackRate: z.number().min(0.01).max(100).step(0.05),
  startFromSec: z.number().min(0).max(600).step(0.01),
  fit: z.enum(["cover", "contain", "fill"]),
  x: z.number().min(-50).max(150),
  y: z.number().min(-50).max(150),
  widthPct: z.number().min(1).max(200),
  heightPct: z.number().min(1).max(200),
  opacity: z.number().min(0).max(1).step(0.01),
  scale: z.number().min(0.1).max(5).step(0.01),
  muted: z.boolean(),
  volume: z.number().min(0).max(1).step(0.01),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  videoSrc: "",
  playbackRate: 1.0,
  startFromSec: 0,
  fit: "cover",
  x: 50,
  y: 50,
  widthPct: 100,
  heightPct: 100,
  opacity: 1,
  scale: 1,
  muted: true,
  volume: 0,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    videoSrc,
    playbackRate,
    startFromSec,
    fit,
    x,
    y,
    widthPct,
    heightPct,
    opacity,
    scale,
    muted,
    volume,
  } = element.props;

  if (!videoSrc) return null;
  const src = resolveStatic(videoSrc, staticFile, ctx.assetRegistry);
  const wrap = getPercentBoxStyle({
    x,
    y,
    widthPct,
    heightPct,
    overflowHidden: true,
  });

  return (
    <div
      style={{
        ...wrap,
        ...buildMediaEffectStyle({
          opacity,
          scale,
        }),
      }}
    >
      <MediaClip
        source={{
          kind: "video",
          src,
          muted,
          volume: muted ? 0 : volume,
          playbackRate: Math.max(0.001, playbackRate),
          startFromFrame: secondsToStartFrame(startFromSec, ctx.fps),
        }}
        fit={fit}
      />
    </div>
  );
};

export const SpeedVideoModule: ElementModule<Props> = {
  id: "overlay.speedVideo",
  category: "overlay",
  label: "Speed Video",
  description:
    "Video clip with adjustable playbackRate + startFromSec. Chain multiple instances on the timeline for beat-ramped speed changes.",
  defaultDurationSec: 30,
  defaultTrack: 8,
  schema,
  defaults,
  mediaFields: [{ name: "videoSrc", kind: "video" }],
  Renderer,
};
