import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { useFFT } from "../../../hooks/useFFT";
import type { ElementModule, ElementRendererProps } from "../types";

// Spectrum waterfall: a horizontal plot of FFT amplitude rendered as a
// single column per frame. Consecutive frames scroll the prior columns
// left so you see a "moving painting" of the frequency content over time.
// Classic audio-analysis visual.
//
// Rendered via 2D canvas rather than WebGL — per-frame it only needs to
// blit the prior frame one pixel left + draw one new column. Very cheap.

const schema = z.object({
  position: z.enum(["top", "bottom", "full"]),
  heightPct: z.number().min(5).max(100),
  numberOfBars: z.number().int().min(32).max(512),
  colorA: z.string(),
  colorB: z.string(),
  scrollPxPerFrame: z.number().min(1).max(20),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  position: "bottom",
  heightPct: 35,
  numberOfBars: 128,
  colorA: "#1e3a5f",
  colorB: "#f0abfc",
  scrollPxPerFrame: 3,
};

// HSL-ish gradient between two colors; t in [0,1]
const interpColor = (a: string, b: string, t: number): string => {
  const parse = (h: string): [number, number, number] => {
    const m = h.replace("#", "");
    const ex = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
    const n = parseInt(ex, 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { position, heightPct, numberOfBars, colorA, colorB, scrollPxPerFrame } = element.props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameRef = useRef<number>(-1);

  // FFT for this frame. Lift to a memoized array that stays stable per frame.
  // visualizeAudio requires numberOfSamples to be a power of 2. Pick the
  // smallest power-of-2 >= numberOfBars so we have enough bins to bucket.
  const pow2Samples = useMemo(() => {
    let n = 1;
    while (n < numberOfBars) n *= 2;
    return n;
  }, [numberOfBars]);
  const fft = useFFT({ src: ctx.audioSrc ?? "", frame: ctx.frame, fps: ctx.fps, numberOfSamples: pow2Samples });
  const spectrum = useMemo(() => {
    if (!fft?.bins) return new Float32Array(numberOfBars);
    const src = fft.bins;
    const out = new Float32Array(numberOfBars);
    const step = Math.max(1, Math.floor(src.length / numberOfBars));
    for (let i = 0; i < numberOfBars; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += src[i * step + j] ?? 0;
      out[i] = sum / step;
    }
    return out;
  }, [fft, numberOfBars]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const g = canvas.getContext("2d", { alpha: true });
    if (!g) return;
    const dpr = 1; // Fixed for deterministic renders
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

    // Scroll the existing content left by scrollPxPerFrame, then paint a new
    // column on the right. If the frame hasn\'t advanced (rewound), clear.
    const scrollPx = Math.max(1, Math.floor(scrollPxPerFrame * dpr));
    if (ctx.frame !== lastFrameRef.current + 1) {
      g.clearRect(0, 0, w, h);
    } else {
      const img = g.getImageData(scrollPx, 0, w - scrollPx, h);
      g.putImageData(img, 0, 0);
      g.clearRect(w - scrollPx, 0, scrollPx, h);
    }
    lastFrameRef.current = ctx.frame;

    // Draw new column on the right edge
    const newColX = w - scrollPx;
    const colW = scrollPx;
    const barH = h / numberOfBars;
    for (let i = 0; i < numberOfBars; i++) {
      const amp = Math.min(1, Math.max(0, spectrum[i]));
      if (amp < 0.02) continue;
      const t = amp;
      g.fillStyle = interpColor(colorA, colorB, t);
      g.globalAlpha = amp;
      // Low frequencies at bottom (or top if user chose "top"). Canvas y=0 is top.
      const y = (numberOfBars - 1 - i) * barH; // low freq at bottom
      g.fillRect(newColX, y, colW, Math.max(1, Math.ceil(barH)));
    }
    g.globalAlpha = 1;
  }, [ctx.frame, spectrum, scrollPxPerFrame, numberOfBars, colorA, colorB]);

  const containerStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    width: "100%",
    height: `${heightPct}%`,
    pointerEvents: "none",
    ...(position === "top"
      ? { top: 0 }
      : position === "bottom"
        ? { bottom: 0 }
        : { top: 0, height: "100%" }),
  };

  return (
    <canvas ref={canvasRef} style={{ ...containerStyle, display: "block" }} />
  );
};

export const SpectrumWaterfallModule: ElementModule<Props> = {
  id: "audio.spectrumWaterfall",
  category: "audio",
  label: "Spectrum Waterfall",
  description: "Scrolling FFT plot — columns of frequency amplitude over time. Makes the whole track\\'s structure visible.",
  defaultDurationSec: 60,
  defaultTrack: 3,
  schema,
  defaults,
  Renderer,
};
