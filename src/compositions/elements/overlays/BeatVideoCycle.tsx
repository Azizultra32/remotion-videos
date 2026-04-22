import type React from "react";
import { memo, useMemo } from "react";
import { OffthreadVideo, staticFile } from "remotion";
import { z } from "zod";
import { resolveStatic } from "../_helpers";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  videos: z.array(z.string()),
  triggerOn: z.enum(["beats", "downbeats", "drops"]),
  everyN: z.number().int().min(1).max(32),
  fit: z.enum(["cover", "contain"]),
  x: z.number().min(-50).max(150),
  y: z.number().min(-50).max(150),
  widthPct: z.number().min(1).max(200),
  heightPct: z.number().min(1).max(200),
  startFromSec: z.number().min(0).max(600).step(0.01),
  muted: z.boolean(),
  volume: z.number().min(0).max(1).step(0.01),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  videos: [],
  triggerOn: "downbeats",
  everyN: 1,
  fit: "cover",
  x: 50,
  y: 50,
  widthPct: 100,
  heightPct: 100,
  startFromSec: 0,
  muted: true,
  volume: 0,
};

type ClipPlayerProps = {
  src: string;
  startFromFrame: number;
  muted: boolean;
  volume: number;
  fit: "cover" | "contain";
};

const ClipPlayer = memo(function ClipPlayer({ src, startFromFrame, muted, volume, fit }: ClipPlayerProps) {
  return (
    <OffthreadVideo
      src={src}
      muted={muted}
      volume={muted ? 0 : volume}
      startFrom={startFromFrame}
      style={{ width: "100%", height: "100%", objectFit: fit }}
    />
  );
});

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { videos, triggerOn, everyN, fit, x, y, widthPct, heightPct, startFromSec, muted, volume } =
    element.props;

  const beatArr =
    triggerOn === "beats" ? ctx.beats.beats :
    triggerOn === "downbeats" ? ctx.beats.downbeats :
    ctx.beats.drops;

  const tSec = ctx.frame / Math.max(1, ctx.fps);

  const { currentIdx, clipStartSec } = useMemo(() => {
    if (videos.length === 0 || beatArr.length === 0) {
      return { currentIdx: 0, clipStartSec: 0 };
    }
    let passed = 0;
    let lastTriggerAt = 0;
    for (const b of beatArr) {
      if (b > tSec) break;
      passed += 1;
      if (passed % everyN === 0) lastTriggerAt = b;
    }
    const stepCount = Math.floor(passed / everyN);
    return {
      currentIdx: stepCount % videos.length,
      clipStartSec: lastTriggerAt,
    };
  }, [videos.length, beatArr, tSec, everyN]);

  if (videos.length === 0) return null;
  const src = resolveStatic(videos[currentIdx], staticFile, ctx.assetRegistry);
  const tInClip = Math.max(0, tSec - clipStartSec);
  const startFromFrame = Math.max(0, Math.round((startFromSec + tInClip) * ctx.fps));

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
      <ClipPlayer
        key={currentIdx}
        src={src}
        startFromFrame={startFromFrame}
        muted={muted}
        volume={volume}
        fit={fit}
      />
    </div>
  );
};

export const BeatVideoCycleModule: ElementModule<Props> = {
  id: "overlay.beatVideoCycle",
  category: "overlay",
  label: "Beat Video Cycle",
  description: "Cycles through a list of video clips on every Nth beat/downbeat/drop. Plays muted by default.",
  defaultDurationSec: 30,
  defaultTrack: 8,
  schema,
  defaults,
  mediaFields: [{ name: "videos", kind: "video", multi: true }],
  Renderer,
};
