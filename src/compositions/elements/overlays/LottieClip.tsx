import type React from "react";
import { useEffect, useState } from "react";
import { AbsoluteFill, delayRender, continueRender, interpolate, staticFile } from "remotion";
import { Lottie, type LottieAnimationData } from "@remotion/lottie";
import { z } from "zod";
import { resolveStatic } from "../_helpers";
import type { ElementModule, ElementRendererProps } from "../types";

// Lottie animation playback (JSON files from After Effects via Bodymovin
// or LottieFiles). Renders a <Lottie> component sourced from a JSON file
// on the project's staticFile path. Positioned in viewport percent,
// sized in pixels, fade envelope for in/out.
//
// Determinism: Lottie playback is frame-locked to the composition fps;
// at any frame the rendered state is a pure function of (animationData,
// playbackRate, frame). No DOM hacks required — @remotion/lottie handles
// the headless render path.

const schema = z.object({
  jsonSrc: z.string(), // staticFile path or http(s) URL
  x: z.number().min(-50).max(150),
  y: z.number().min(-50).max(150),
  widthPct: z.number().min(1).max(200),
  heightPct: z.number().min(1).max(200),
  playbackRate: z.number().min(0.1).max(10),
  loop: z.boolean(),
  direction: z.enum(["forward", "backward"]),
  fadeInSec: z.number().min(0).max(5),
  fadeOutSec: z.number().min(0).max(5),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  jsonSrc: "",
  x: 50,
  y: 50,
  widthPct: 80,
  heightPct: 80,
  playbackRate: 1,
  loop: true,
  direction: "forward",
  fadeInSec: 0.3,
  fadeOutSec: 0.3,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { jsonSrc, x, y, widthPct, heightPct, playbackRate, loop, direction, fadeInSec, fadeOutSec } =
    element.props;

  const [data, setData] = useState<LottieAnimationData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [handle] = useState(() => delayRender("Loading Lottie JSON"));

  useEffect(() => {
    if (!jsonSrc) {
      continueRender(handle);
      return;
    }
    let cancelled = false;
    const url = resolveStatic(jsonSrc, staticFile, ctx.assetRegistry);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: LottieAnimationData) => {
        if (!cancelled) {
          setData(j);
          continueRender(handle);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(String(e));
          continueRender(handle);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [jsonSrc, handle]);

  const localSec = ctx.elementLocalSec;
  const durationSec = element.durationSec;

  const fadeIn =
    fadeInSec <= 0
      ? 1
      : interpolate(localSec, [0, fadeInSec], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const fadeOut =
    fadeOutSec <= 0
      ? 1
      : interpolate(
          localSec,
          [Math.max(0, durationSec - fadeOutSec), durationSec],
          [1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
  const opacity = fadeIn * fadeOut;

  if (err || !data) return null;

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
        <Lottie
          animationData={data}
          loop={loop}
          direction={direction}
          playbackRate={playbackRate}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </AbsoluteFill>
  );
};

const LottieClipModule: ElementModule<Props> = {
  id: "overlay.lottie",
  category: "overlay",
  label: "Lottie Animation",
  description: "Lottie (Bodymovin) JSON animation playback with fade envelope.",
  defaultDurationSec: 3,
  defaultTrack: 6,
  schema,
  defaults,
  Renderer,
};

export default LottieClipModule;
export { LottieClipModule };
