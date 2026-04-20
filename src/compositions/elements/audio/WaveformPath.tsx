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
  strokeWidth: z.number(),
  amplitude: z.number(),
  position: z.enum(["top", "bottom", "middle"]),
  height: z.number(),
  opacity: z.number(),
  numberOfSamples: z.number(),
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
  if (!ctx.audioSrc) return null;
  const resolved =
    ctx.audioSrc.startsWith("http") || ctx.audioSrc.startsWith("/")
      ? ctx.audioSrc
      : staticFile(ctx.audioSrc);
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: resolved,
    frame: ctx.frame,
    fps: ctx.fps,
    windowInSeconds: 10,
  });
  if (!audioData) return null;

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
