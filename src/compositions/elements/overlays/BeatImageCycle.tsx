import type React from "react";
import { useMemo } from "react";
import { Img, staticFile } from "remotion";
import { z } from "zod";
import { resolveStatic } from "../_helpers";
import { selectTriggeredMedia } from "../mediaSelectionRuntime";
import { selectTriggerTimes } from "../triggerRuntime";
import type { ElementModule, ElementRendererProps } from "../types";

// Beat-cycling image: advances through a list of images on every Nth beat /
// downbeat / drop. Each element carries an ordered list of image paths (URLs
// or paths under public/). Deterministic: at any frame f, the displayed
// image is wholly a function of (image list, beat array, trigger mode). No
// runtime randomness — same audio + same props = same pixels.

const schema = z.object({
  images: z.array(z.string()),
  triggerOn: z.enum(["beats", "downbeats", "drops"]),
  everyN: z.number().int().min(1).max(32), // advance every N triggers
  selectionMode: z.enum(["sequence", "seeded-random", "weighted-random"]),
  selectionSeed: z.string().max(120),
  selectionWeights: z.array(z.number().positive().max(1000)).max(64),
  fit: z.enum(["cover", "contain"]),
  x: z.number().min(-50).max(150), // center x in % (0-100)
  y: z.number().min(-50).max(150), // center y in % (0-100)
  widthPct: z.number().min(1).max(200),
  heightPct: z.number().min(1).max(200),
  fadeSec: z.number().min(0).max(1).step(0.01), // cross-fade between consecutive images
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  images: [],
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
  fadeSec: 0.1,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    images,
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
    fadeSec,
  } = element.props;

  const tSec = ctx.frame / Math.max(1, ctx.fps);
  const triggerTimes = selectTriggerTimes(ctx.beats, triggerOn);

  const { currentIdx, prevIdx, tSinceChange } = useMemo(() => {
    if (images.length === 0 || triggerTimes.length === 0) {
      return { currentIdx: 0, prevIdx: -1, tSinceChange: 0 };
    }
    const state = selectTriggeredMedia({
      items: images,
      triggerTimes,
      tSec,
      everyN,
      selectionMode,
      seed: selectionSeed,
      weights: selectionWeights,
    });
    return {
      currentIdx: state.currentIdx,
      prevIdx: state.prevIdx,
      tSinceChange: state.timeSinceAnchorSec,
    };
  }, [images, triggerTimes, tSec, everyN, selectionMode, selectionSeed, selectionWeights]);

  if (images.length === 0) return null;
  const currentSrc = resolveStatic(images[currentIdx], staticFile, ctx.assetRegistry);
  const prevSrc =
    prevIdx >= 0 ? resolveStatic(images[prevIdx], staticFile, ctx.assetRegistry) : null;

  // Cross-fade: current fades in over fadeSec, prev fades out.
  const fadeT = fadeSec > 0 ? Math.min(1, tSinceChange / fadeSec) : 1;
  const repeatsCurrent = prevIdx >= 0 && prevSrc === currentSrc;
  const currentOpacity = repeatsCurrent ? 1 : fadeT;
  const prevOpacity = prevSrc && !repeatsCurrent && fadeT < 1 ? 1 - fadeT : 0;

  const wrap: React.CSSProperties = {
    position: "absolute",
    left: `${x - widthPct / 2}%`,
    top: `${y - heightPct / 2}%`,
    width: `${widthPct}%`,
    height: `${heightPct}%`,
    pointerEvents: "none",
  };
  const imgStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: fit,
  };

  return (
    <div style={wrap}>
      {prevSrc && prevOpacity > 0 && (
        <Img src={prevSrc} style={{ ...imgStyle, opacity: prevOpacity }} />
      )}
      <Img src={currentSrc} style={{ ...imgStyle, opacity: currentOpacity }} />
    </div>
  );
};

export const BeatImageCycleModule: ElementModule<Props> = {
  id: "overlay.beatImageCycle",
  category: "overlay",
  label: "Beat Image Cycle",
  description:
    "Cycles through a list of images on every Nth beat/downbeat/drop with optional cross-fade.",
  defaultDurationSec: 30,
  defaultTrack: 8,
  schema,
  defaults,
  mediaFields: [
    { name: "images", kind: "image", multi: true, label: "Image collection" },
  ],
  Renderer,
};
