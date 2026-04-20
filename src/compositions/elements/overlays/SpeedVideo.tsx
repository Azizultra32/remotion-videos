import type React from "react";
import { OffthreadVideo, staticFile } from "remotion";
import { z } from "zod";
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
  playbackRate: z.number().min(0).max(100),
  startFromSec: z.number().min(0),
  fit: z.enum(["cover", "contain"]),
  x: z.number(),
  y: z.number(),
  widthPct: z.number().min(1).max(200),
  heightPct: z.number().min(1).max(200),
  muted: z.boolean(),
  volume: z.number().min(0).max(1),
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
  muted: true,
  volume: 0,
};

const resolvePath = (p: string): string =>
  p.startsWith("http") || p.startsWith("/") ? p : staticFile(p);

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element }) => {
  const { videoSrc, playbackRate, startFromSec, fit, x, y, widthPct, heightPct, muted, volume } =
    element.props;

  if (!videoSrc) return null;
  const src = resolvePath(videoSrc);

  const wrap: React.CSSProperties = {
    position: "absolute",
    left: `${x - widthPct / 2}%`,
    top: `${y - heightPct / 2}%`,
    width: `${widthPct}%`,
    height: `${heightPct}%`,
    pointerEvents: "none",
    overflow: "hidden",
  };

  return (
    <div style={wrap}>
      <OffthreadVideo
        src={src}
        muted={muted}
        volume={muted ? 0 : volume}
        playbackRate={Math.max(0.001, playbackRate)}
        startFrom={Math.max(0, Math.round(startFromSec * 30))}
        style={{ width: "100%", height: "100%", objectFit: fit }}
      />
    </div>
  );
};

export const SpeedVideoModule: ElementModule<Props> = {
  id: "overlay.speedVideo",
  category: "overlay",
  label: "Speed Video",
  description: "Video clip with adjustable playbackRate + startFromSec. Chain multiple instances on the timeline for beat-ramped speed changes.",
  defaultDurationSec: 30,
  defaultTrack: 8,
  schema,
  defaults,
  Renderer,
};
