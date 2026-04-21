import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { noise3D } from "@remotion/noise";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

// Procedural animated noise field. Samples @remotion/noise's noise3D
// over a grid (x, y, time) and renders the values as a gradient-ish
// color field. Useful as an animated background, bass-reactive backdrop,
// or stylized transition plate.

const schema = z.object({
  seed: z.string(),
  gridCols: z.number().min(4).max(120),
  gridRows: z.number().min(4).max(120),
  scale: z.number().min(0.1).max(10), // noise frequency
  timeScale: z.number().min(0).max(4), // seconds of noise per second of video
  colorLow: z.string(),
  colorHigh: z.string(),
  opacity: z.number().min(0).max(1),
  fadeInSec: z.number().min(0).max(5),
  fadeOutSec: z.number().min(0).max(5),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  seed: "noise-field",
  gridCols: 40,
  gridRows: 24,
  scale: 2.5,
  timeScale: 0.5,
  colorLow: "#0a0a28",
  colorHigh: "#8cf",
  opacity: 0.7,
  fadeInSec: 0.5,
  fadeOutSec: 0.5,
};

// Cheap hex lerp: "#rrggbb" -> "#rrggbb". Clamps components.
const lerpColor = (a: string, b: string, t: number): string => {
  const ah = a.replace("#", "");
  const bh = b.replace("#", "");
  const ar = parseInt(ah.slice(0, 2), 16);
  const ag = parseInt(ah.slice(2, 4), 16);
  const ab = parseInt(ah.slice(4, 6), 16);
  const br = parseInt(bh.slice(0, 2), 16);
  const bg = parseInt(bh.slice(2, 4), 16);
  const bb = parseInt(bh.slice(4, 6), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    seed,
    gridCols,
    gridRows,
    scale,
    timeScale,
    colorLow,
    colorHigh,
    opacity,
    fadeInSec,
    fadeOutSec,
  } = element.props;

  const localSec = ctx.elementLocalSec;
  const durationSec = element.durationSec;
  const z = localSec * timeScale;

  const cells = useMemo(() => {
    const out: { tl: string; tr: string; br: string; bl: string }[] = [];
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const sample = (ci: number, ri: number) => {
          const v = noise3D(seed, (ci / gridCols) * scale, (ri / gridRows) * scale, z);
          // noise3D returns roughly -1..1; remap to 0..1 then clamp.
          const t = Math.max(0, Math.min(1, (v + 1) / 2));
          return lerpColor(colorLow, colorHigh, t);
        };
        out.push({
          tl: sample(c, r),
          tr: sample(c + 1, r),
          br: sample(c + 1, r + 1),
          bl: sample(c, r + 1),
        });
      }
    }
    return out;
    // Grid re-samples every frame via `z`. For a static frame, memoize by
    // all inputs; React.useMemo without deps would cache stale. We rely
    // on ctx updating localSec per frame which re-invokes Renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, gridCols, gridRows, scale, z, colorLow, colorHigh]);

  const fadeIn = fadeInSec <= 0 ? 1 : interpolate(localSec, [0, fadeInSec], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = fadeOutSec <= 0 ? 1 : interpolate(localSec, [Math.max(0, durationSec - fadeOutSec), durationSec], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const alpha = opacity * fadeIn * fadeOut;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: alpha }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          gridTemplateRows: `repeat(${gridRows}, 1fr)`,
        }}
      >
        {cells.map((cell, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: grid cell identity IS its index
            key={i}
            style={{
              background: `linear-gradient(135deg, ${cell.tl}, ${cell.tr}, ${cell.br}, ${cell.bl})`,
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const NoiseFieldModule: ElementModule<Props> = {
  id: "overlay.noise",
  category: "overlay",
  label: "Noise Field",
  description: "Animated procedural Perlin noise field as a background plate.",
  defaultDurationSec: 5,
  defaultTrack: 8,
  schema,
  defaults,
  Renderer,
};

export default NoiseFieldModule;
export { NoiseFieldModule };
