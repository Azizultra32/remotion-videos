import type React from "react";
import { memo, useMemo } from "react";
import { OffthreadVideo, Sequence, staticFile } from "remotion";
import { z } from "zod";
import { resolveStatic } from "../_helpers";
import { getFillMediaStyle, getPercentBoxStyle, secondsToStartFrame } from "../mediaRuntime";
import { selectTriggeredMedia } from "../mediaSelectionRuntime";
import { selectTriggerTimes } from "../triggerRuntime";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  videos: z.array(z.string()),
  triggerOn: z.enum(["beats", "downbeats", "drops"]),
  everyN: z.number().int().min(1).max(32),
  selectionMode: z.enum(["sequence", "seeded-random", "weighted-random"]),
  selectionSeed: z.string().max(120),
  selectionWeights: z.array(z.number().positive().max(1000)).max(64),
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
  selectionMode: "sequence",
  selectionSeed: "",
  selectionWeights: [],
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

const ClipPlayer = memo(function ClipPlayer({
  src,
  startFromFrame,
  muted,
  volume,
  fit,
}: ClipPlayerProps) {
  return (
    <OffthreadVideo
      src={src}
      muted={muted}
      volume={muted ? 0 : volume}
      startFrom={startFromFrame}
      style={getFillMediaStyle(fit)}
    />
  );
});

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    videos,
    triggerOn,
    everyN,
    selectionMode,
    selectionSeed,
    selectionWeights,
    fit,
    x,
    y,
    widthPct,
    heightPct,
    startFromSec,
    muted,
    volume,
  } = element.props;

  const tSec = ctx.frame / Math.max(1, ctx.fps);
  const triggerTimes = selectTriggerTimes(ctx.beats, triggerOn);

  const { currentIdx, anchorSec: clipStartSec } = useMemo(
    () =>
      selectTriggeredMedia({
        items: videos,
        triggerTimes,
        tSec,
        everyN,
        selectionMode,
        seed: selectionSeed,
        weights: selectionWeights,
      }),
    [videos, triggerTimes, tSec, everyN, selectionMode, selectionSeed, selectionWeights],
  );

  if (videos.length === 0) return null;
  const src = resolveStatic(videos[currentIdx], staticFile, ctx.assetRegistry);
  const clipStartFrame = secondsToStartFrame(clipStartSec, ctx.fps);
  const startFromFrame = secondsToStartFrame(startFromSec, ctx.fps);
  const wrap = getPercentBoxStyle({
    x,
    y,
    widthPct,
    heightPct,
    overflowHidden: true,
  });

  return (
    <div style={wrap}>
      <Sequence from={clipStartFrame}>
        <ClipPlayer
          key={`${currentIdx}:${clipStartFrame}`}
          src={src}
          startFromFrame={startFromFrame}
          muted={muted}
          volume={volume}
          fit={fit}
        />
      </Sequence>
    </div>
  );
};

export const BeatVideoCycleModule: ElementModule<Props> = {
  id: "overlay.beatVideoCycle",
  category: "overlay",
  label: "Beat Video Cycle",
  description:
    "Cycles through a list of video clips on every Nth beat/downbeat/drop. Plays muted by default.",
  defaultDurationSec: 30,
  defaultTrack: 8,
  schema,
  defaults,
  mediaFields: [
    { name: "videos", kind: "video", multi: true, role: "collection", label: "Video collection" },
  ],
  Renderer,
};
