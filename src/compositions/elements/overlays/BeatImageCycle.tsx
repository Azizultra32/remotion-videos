import type React from "react";
import { useMemo } from "react";
import { Img, staticFile } from "remotion";
import { z } from "zod";
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
  fit: z.enum(["cover", "contain"]),
  x: z.number().min(-50).max(150),       // center x in % (0-100)
  y: z.number().min(-50).max(150),       // center y in % (0-100)
  widthPct: z.number().min(1).max(200),
  heightPct: z.number().min(1).max(200),
  fadeSec: z.number().min(0).max(1).step(0.01), // cross-fade between consecutive images
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  images: [],
  triggerOn: "downbeats",
  everyN: 1,
  fit: "cover",
  x: 50,
  y: 50,
  widthPct: 100,
  heightPct: 100,
  fadeSec: 0.1,
};

const resolvePath = (p: string): string =>
  p.startsWith("http") || p.startsWith("/") ? p : staticFile(p);

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { images, triggerOn, everyN, fit, x, y, widthPct, heightPct, fadeSec } = element.props;

  const beatArr =
    triggerOn === "beats" ? ctx.beats.beats :
    triggerOn === "downbeats" ? ctx.beats.downbeats :
    ctx.beats.drops;

  const tSec = ctx.frame / Math.max(1, ctx.fps);

  // Count triggers <= tSec to find current step; step/everyN -> current index.
  const { currentIdx, prevIdx, tSinceChange } = useMemo(() => {
    if (images.length === 0 || beatArr.length === 0) {
      return { currentIdx: 0, prevIdx: -1, tSinceChange: 0 };
    }
    let passed = 0;
    let lastTriggerAt = 0;
    for (const b of beatArr) {
      if (b > tSec) break;
      passed += 1;
      if (passed % everyN === 0) lastTriggerAt = b;
    }
    const stepCount = Math.floor(passed / everyN);
    const idx = stepCount % images.length;
    const prev = stepCount > 0 ? (stepCount - 1) % images.length : -1;
    return { currentIdx: idx, prevIdx: prev, tSinceChange: tSec - lastTriggerAt };
  }, [images.length, beatArr, tSec, everyN]);

  if (images.length === 0) return null;
  const currentSrc = resolvePath(images[currentIdx]);
  const prevSrc = prevIdx >= 0 ? resolvePath(images[prevIdx]) : null;

  // Cross-fade: current fades in over fadeSec, prev fades out.
  const fadeT = fadeSec > 0 ? Math.min(1, tSinceChange / fadeSec) : 1;
  const currentOpacity = fadeT;
  const prevOpacity = prevSrc && fadeT < 1 ? 1 - fadeT : 0;

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
  description: "Cycles through a list of images on every Nth beat/downbeat/drop with optional cross-fade.",
  defaultDurationSec: 30,
  defaultTrack: 8,
  schema,
  defaults,
  mediaFields: [{ name: "images", kind: "image", multi: true }],
  Renderer,
};
