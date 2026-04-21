import type React from "react";
import { AbsoluteFill, interpolate, staticFile } from "remotion";
import { Gif } from "@remotion/gif";
import { z } from "zod";
import { resolveStatic } from "../_helpers";
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
  const { gifSrc, x, y, widthPct, heightPct, fit, playbackRate, loopBehavior, fadeInSec, fadeOutSec } =
    element.props;

  if (!gifSrc) return null;

  const localSec = ctx.elementLocalSec;
  const durationSec = element.durationSec;
  const fadeIn = fadeInSec <= 0 ? 1 : interpolate(localSec, [0, fadeInSec], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = fadeOutSec <= 0 ? 1 : interpolate(localSec, [Math.max(0, durationSec - fadeOutSec), durationSec], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = fadeIn * fadeOut;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${x - widthPct / 2}%`,
          top: `${y - heightPct / 2}%`,
          width: `${widthPct}%`,
          height: `${heightPct}%`,
          opacity,
        }}
      >
        <Gif
          src={resolveStatic(gifSrc, staticFile)}
          fit={fit}
          playbackRate={playbackRate}
          loopBehavior={loopBehavior}
          style={{ width: "100%", height: "100%" }}
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
