import {
  createSmoothSvgPath,
  useWindowedAudioData,
  visualizeAudioWaveform,
} from "@remotion/media-utils";
import type React from "react";
import { staticFile } from "remotion";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  color: z.string(),
  strokeWidth: z.number().min(0.5).max(20).step(0.5),
  amplitude: z.number().min(0).max(4).step(0.05),
  position: z.enum(["top", "bottom", "middle"]),
  height: z.number().min(10).max(2000),
  opacity: z.number().min(0).max(1).step(0.01),
  numberOfSamples: z.number().int().min(16).max(2048),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  color: "#ffffff",
  strokeWidth: 2,
  amplitude: 1,
  position: "middle",
  height: 160,
  opacity: 0.8,
  numberOfSamples: 256,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { color, strokeWidth, amplitude, position, height, opacity, numberOfSamples } =
    element.props;
  // Always call the hook — return null AFTER hook invocation so call order is
  // stable across renders.
  const resolved = !ctx.audioSrc
    ? ""
    : ctx.audioSrc.startsWith("http") || ctx.audioSrc.startsWith("/")
      ? ctx.audioSrc
      : staticFile(ctx.audioSrc);
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: resolved,
    frame: ctx.frame,
    fps: ctx.fps,
    windowInSeconds: 10,
  });
  if (!ctx.audioSrc || !audioData) return null;

  const samples = visualizeAudioWaveform({
    fps: ctx.fps,
    frame: ctx.frame,
    audioData,
    numberOfSamples,
    windowInSeconds: 1 / ctx.fps,
    dataOffsetInSeconds,
    channel: 0,
  });
  const points = samples.map((v, i) => ({
    x: (i / (samples.length - 1)) * ctx.width,
    y: height / 2 + v * (height / 2) * amplitude,
  }));
  const d = createSmoothSvgPath({ points });

  const top =
    position === "top"
      ? 0
      : position === "bottom"
        ? ctx.height - height
        : (ctx.height - height) / 2;

  return (
    <svg
      role="img"
      aria-label="Audio waveform path"
      viewBox={`0 0 ${ctx.width} ${height}`}
      width={ctx.width}
      height={height}
      style={{ position: "absolute", left: 0, top, opacity }}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const WaveformPathModule: ElementModule<Props> = {
  id: "audio.waveformPath",
  category: "audio",
  label: "Waveform Path",
  description: "Smooth oscilloscope SVG path from live audio samples",
  defaultDurationSec: 30,
  defaultTrack: 2,
  schema,
  defaults,
  Renderer,
};
