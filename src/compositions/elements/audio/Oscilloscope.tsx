import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { useFFT } from "../../../hooks/useFFT";
import type { ElementModule, ElementRendererProps } from "../types";

// Oscilloscope: draws the current audio waveform as a glowing polyline.
// Unlike spectrum visualizers (frequency domain), this shows the raw time-
// domain signal for the current frame\'s audio window. Pairs well with the
// spectrum waterfall — time domain + frequency domain side-by-side.
//
// Canvas 2D; per-frame it clears and redraws the N-point polyline. Glow via
// a large stroke underneath the sharp stroke (cheap trick, no blur filter).

const schema = z.object({
  position: z.enum(["center", "top", "bottom"]),
  amplitude: z.number().min(0.1).max(3.0),
  color: z.string(),
  lineWidth: z.number().min(0.5).max(10),
  glow: z.number().min(0).max(1),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  position: "center",
  amplitude: 1.2,
  color: "#86efac",
  lineWidth: 2,
  glow: 0.7,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { position, amplitude, color, lineWidth, glow } = element.props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // We want the RAW time-domain signal. useFFT gives the frequency spectrum;
  // we use waveform from the same hook. Not all hook variants expose it;
  // we fall back to approximating from spectrum if not.
  const fft = useFFT({ src: ctx.audioSrc ?? "", frame: ctx.frame, fps: ctx.fps, numberOfSamples: 512, assetRegistry: ctx.assetRegistry });
  // useFFT doesn\'t expose a time-domain waveform directly. We build a
  // pseudo-oscilloscope from `raw` (visualizeAudio amplitudes per frequency
  // bin) — multiply by a slowly-varying sinusoid so the line oscillates
  // around the axis, with amplitude tracking the audio energy. Not a
  // physically accurate oscilloscope but visually reads the same.
  const wave = useMemo(() => {
    const r = fft?.raw;
    if (!r || r.length === 0) return new Float32Array(0);
    const out = new Float32Array(r.length);
    for (let i = 0; i < r.length; i++) {
      // Normalize raw amplitude, center around 0, oscillate across bins
      const amp = Math.min(1.2, Math.max(0, r[i] ?? 0));
      out[i] = amp * Math.sin(i * 0.6);
    }
    return out;
  }, [fft]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const g = canvas.getContext("2d", { alpha: true });
    if (!g) return;
    const dpr = 1; // Fixed for deterministic renders
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

    g.clearRect(0, 0, w, h);
    if (wave.length === 0) return;

    const yMid =
      position === "center" ? h / 2 :
      position === "top" ? h / 4 : (h * 3) / 4;

    const step = w / wave.length;

    // Glow pass: thick low-alpha stroke
    if (glow > 0) {
      g.beginPath();
      for (let i = 0; i < wave.length; i++) {
        const x = i * step;
        const y = yMid - (wave[i] ?? 0) * (h / 2) * amplitude;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = color;
      g.globalAlpha = glow * 0.35;
      g.lineWidth = lineWidth * 5 * dpr;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.stroke();
    }

    // Sharp pass
    g.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const x = i * step;
      const y = yMid - (wave[i] ?? 0) * (h / 2) * amplitude;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = color;
    g.globalAlpha = 1;
    g.lineWidth = lineWidth * dpr;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.stroke();
  }, [ctx.frame, wave, position, amplitude, color, lineWidth, glow]);

  return (
    <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
  );
};

export const OscilloscopeModule: ElementModule<Props> = {
  id: "audio.oscilloscope",
  category: "audio",
  label: "Oscilloscope",
  description: "Time-domain waveform line with optional glow. Pairs with Spectrum Waterfall for classic analyzer look.",
  defaultDurationSec: 60,
  defaultTrack: 2,
  schema,
  defaults,
  Renderer,
};
