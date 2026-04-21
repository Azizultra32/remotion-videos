// src/components/EasingCurvePreview.tsx
//
// Tiny SVG preview of a named Penner easing function. Sits below the
// easing-dropdown in SchemaEditor so the user sees the CURVE, not just
// the name. Complements SpringCurveVisualizer — same "show the motion,
// don't just type the number" idea.
//
// Lightweight by design: samples the easing 50 times from 0..1, plots
// as a polyline, 1px stroke. No interactivity — just read-only preview.
// Dropdown stays as the authoritative picker.

import { EASINGS } from "@utils/easing";
import { useMemo } from "react";

type Props = {
  name: string;
  width?: number;
  height?: number;
};

const SAMPLES = 50;

export const EasingCurvePreview: React.FC<Props> = ({ name, width = 140, height = 50 }) => {
  const fn = EASINGS[name] ?? EASINGS.linear;
  const points = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / (SAMPLES - 1);
      const y = fn(t);
      pts.push(`${(t * width).toFixed(1)},${(height - y * height).toFixed(1)}`);
    }
    return pts.join(" ");
  }, [fn, width, height]);

  return (
    <svg
      width={width}
      height={height}
      style={{ background: "#0a0a0a", borderRadius: 2, marginTop: 4 }}
      aria-label={`${name} easing curve`}
    >
      <title>{`${name} easing curve`}</title>
      <line x1={0} y1={height} x2={width} y2={height} stroke="#222" />
      <line x1={0} y1={0} x2={width} y2={0} stroke="#222" strokeDasharray="2,3" />
      <polyline
        points={points}
        fill="none"
        stroke="#8cf"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
    </svg>
  );
};
