import type React from "react";
import { z } from "zod";
import { useFFT } from "../../../hooks/useFFT";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  color: z.string(),
  band: z.enum(["bass", "mid", "highs"]),
  opacityScale: z.number().min(0).max(1).step(0.05),
  opacityBase: z.number().min(0).max(1).step(0.01),
  blendMode: z.enum(["normal", "screen", "overlay", "multiply", "lighten"]),
  bandWidthHint: z.number().int().min(8).max(512),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  color: "#ff3a3a",
  band: "bass",
  opacityScale: 0.7,
  opacityBase: 0,
  blendMode: "screen",
  bandWidthHint: 32,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { color, band, opacityScale, opacityBase, blendMode, bandWidthHint } = element.props;
  const fft = useFFT({
    src: ctx.audioSrc ?? "",
    frame: ctx.frame,
    fps: ctx.fps,
    numberOfSamples: Math.max(32, bandWidthHint),
  });
  if (!ctx.audioSrc || !fft) return null;
  const v = band === "bass" ? fft.bass : band === "mid" ? fft.mid : fft.highs;
  const opacity = Math.max(0, Math.min(1, opacityBase + v * opacityScale));
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: color,
        opacity,
        mixBlendMode: blendMode as React.CSSProperties["mixBlendMode"],
        pointerEvents: "none",
      }}
    />
  );
};

export const BassGlowOverlayModule: ElementModule<Props> = {
  id: "audio.bassGlow",
  category: "audio",
  label: "Bass Glow Overlay",
  description: "Full-frame color flash driven by a frequency band",
  defaultDurationSec: 30,
  defaultTrack: 3,
  schema,
  defaults,
  Renderer,
};
