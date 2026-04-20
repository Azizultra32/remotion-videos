import type React from "react";
import { z } from "zod";
import { useFFT } from "../../../hooks/useFFT";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  position: z.enum(["top", "bottom", "middle"]),
  numberOfBars: z.number(),
  height: z.number(),
  color: z.string(),
  opacity: z.number(),
  mirror: z.boolean(),
  gap: z.number(),
  amplitude: z.number(),
  logScale: z.boolean(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  position: "bottom",
  numberOfBars: 64,
  height: 120,
  color: "#ffffff",
  opacity: 0.6,
  mirror: false,
  gap: 1,
  amplitude: 1.6,
  logScale: true,
};

const remapLog = (bins: number[], n: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const frac = i / Math.max(1, n - 1);
    const src = frac ** 2.2 * (bins.length - 1);
    const lo = Math.floor(src);
    const hi = Math.min(bins.length - 1, lo + 1);
    const t = src - lo;
    out.push((bins[lo] ?? 0) * (1 - t) + (bins[hi] ?? 0) * t);
  }
  return out;
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { position, numberOfBars, height, color, opacity, mirror, gap, amplitude, logScale } =
    element.props;
  const fft = useFFT({
    src: ctx.audioSrc ?? "",
    frame: ctx.frame,
    fps: ctx.fps,
    numberOfSamples: 128,
  });
  if (!ctx.audioSrc || !fft) return null;

  const remapped = logScale ? remapLog(fft.bins, numberOfBars) : fft.bins.slice(0, numberOfBars);
  const data = mirror ? [...remapped.slice(1).reverse(), ...remapped] : remapped;
  const barW = ctx.width / data.length - gap;
  const bottom =
    position === "bottom"
      ? 0
      : position === "top"
        ? ctx.height - height
        : (ctx.height - height) / 2;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        bottom,
        width: "100%",
        height,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        opacity,
        gap,
      }}
    >
      {data.map((v, i) => {
        const h = Math.max(1, Math.min(height, v * height * amplitude));
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
            key={i}
            style={{
              width: Math.max(1, barW),
              height: h,
              background: color,
              boxShadow: v > 0.4 ? `0 0 ${v * 8}px ${color}` : "none",
            }}
          />
        );
      })}
    </div>
  );
};

export const SpectrumBarsModule: ElementModule<Props> = {
  id: "audio.spectrumBars",
  category: "audio",
  label: "Spectrum Bars",
  description: "FFT frequency bars driven by the audio track",
  defaultDurationSec: 30,
  defaultTrack: 2,
  schema,
  defaults,
  Renderer,
};
