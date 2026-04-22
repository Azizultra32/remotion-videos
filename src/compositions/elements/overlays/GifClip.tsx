import type React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { z } from "zod";
import { resolveStatic } from "../_helpers";
import { MediaClip } from "../MediaClip";
import { getElementFadeOpacity, getPercentBoxStyle } from "../mediaRuntime";
import type { ElementModule, ElementRendererProps } from "../types";

// Animated GIF playback. Uses @remotion/gif which decodes frames ahead
// of time and synchronizes playback to the composition's frame clock
// (unlike a native <img src=".gif">, which would play at whatever speed
// the file encodes).

const schema = z.object({
  gifSrc: z.string(),
  x: z.number().min(-50).max(150),
  y: z.number().min(-50).max(150),
  widthPct: z.number().min(1).max(200),
  heightPct: z.number().min(1).max(200),
  fit: z.enum(["contain", "cover", "fill"]),
  playbackRate: z.number().min(0.1).max(10),
  loopBehavior: z.enum(["loop", "pause-after-finish", "unmount-after-finish"]),
  fadeInSec: z.number().min(0).max(5),
  fadeOutSec: z.number().min(0).max(5),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  gifSrc: "",
  x: 50,
  y: 50,
  widthPct: 80,
  heightPct: 80,
  fit: "contain",
  playbackRate: 1,
  loopBehavior: "loop",
  fadeInSec: 0.2,
  fadeOutSec: 0.2,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    gifSrc,
    x,
    y,
    widthPct,
    heightPct,
    fit,
    playbackRate,
    loopBehavior,
    fadeInSec,
    fadeOutSec,
  } = element.props;

  if (!gifSrc) return null;

  const opacity = getElementFadeOpacity({
    localSec: ctx.elementLocalSec,
    durationSec: element.durationSec,
    fadeInSec,
    fadeOutSec,
  });
  const wrap = getPercentBoxStyle({ x, y, widthPct, heightPct, opacity });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={wrap}>
        <MediaClip
          source={{
            kind: "gif",
            src: resolveStatic(gifSrc, staticFile, ctx.assetRegistry),
            playbackRate,
            loopBehavior,
          }}
          fit={fit}
        />
      </div>
    </AbsoluteFill>
  );
};

const GifClipModule: ElementModule<Props> = {
  id: "overlay.gif",
  category: "overlay",
  label: "GIF Clip",
  description: "Animated GIF playback synchronized to the composition clock.",
  defaultDurationSec: 3,
  defaultTrack: 6,
  schema,
  defaults,
  mediaFields: [{ name: "gifSrc", kind: "gif" }],
  Renderer,
};

export default GifClipModule;
export { GifClipModule };
