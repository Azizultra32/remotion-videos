// src/components/FadeEnvelopeVisualizer.tsx
//
// Visual envelope editor for elements with the (fadeInSec, fadeOutSec,
// durationSec) pattern — e.g. overlay.staticImage. Renders the time-
// based opacity envelope as a trapezoid (rise → hold → fall) that the
// user can drag to adjust fade ramps directly.
//
// Bound to element.props — drag a ramp handle, fadeInSec/fadeOutSec
// update in place. Mirrors the SpringCurveVisualizer pattern: replace
// "two crude number inputs" with a single visual control that SHOWS
// the envelope you're authoring.
//
// Coordinate system: x-axis = 0..durationSec, y-axis = 0..1 opacity.
// SVG is fixed 320x90px regardless of duration (we rescale internally).

import { useRef } from "react";

type Props = {
  durationSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  onChange: (patch: { fadeInSec?: number; fadeOutSec?: number }) => void;
};

const W = 320;
const H = 90;
const PAD = 4;
const INNER_W = W - PAD * 2;

export const FadeEnvelopeVisualizer: React.FC<Props> = ({
  durationSec,
  fadeInSec,
  fadeOutSec,
  onChange,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  const d = Math.max(0.0001, durationSec);
  const fiClamped = Math.max(0, Math.min(d, fadeInSec));
  const foClamped = Math.max(0, Math.min(d, fadeOutSec));

  const timeToX = (t: number) => PAD + (t / d) * INNER_W;
  const fadeInX = timeToX(fiClamped);
  const fadeOutX = timeToX(Math.max(0, d - foClamped));
  const yTop = PAD;
  const yBottom = H - PAD;

  // Trapezoid: (0, bottom) → (fadeInX, top) → (fadeOutX, top) → (d, bottom)
  const polygonPoints = [
    `${PAD},${yBottom}`,
    `${fadeInX},${yTop}`,
    `${fadeOutX},${yTop}`,
    `${W - PAD},${yBottom}`,
  ].join(" ");

  const startDrag = (
    kind: "fadeIn" | "fadeOut",
    e: React.PointerEvent<SVGCircleElement>,
  ) => {
    e.preventDefault();
    (e.target as SVGElement).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      // Raw x within the drawable area, clamped.
      const rawX = Math.max(PAD, Math.min(W - PAD, ev.clientX - rect.left));
      const tSec = ((rawX - PAD) / INNER_W) * d;
      if (kind === "fadeIn") {
        // Clamp: fadeIn + fadeOut must leave at least a tiny sliver of hold
        const maxFadeIn = Math.max(0, d - foClamped - 0.01);
        onChange({ fadeInSec: Math.max(0, Math.min(maxFadeIn, tSec)) });
      } else {
        const maxFadeOut = Math.max(0, d - fiClamped - 0.01);
        const nextFadeOut = Math.max(0, Math.min(maxFadeOut, d - tSec));
        onChange({ fadeOutSec: nextFadeOut });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      style={{
        padding: 8,
        background: "#1a1a1a",
        border: "1px solid #333",
        borderRadius: 4,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#888",
          letterSpacing: "0.08em",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>FADE ENVELOPE</span>
        <span style={{ color: "#666" }}>
          in {fiClamped.toFixed(2)}s · hold{" "}
          {Math.max(0, d - fiClamped - foClamped).toFixed(2)}s · out{" "}
          {foClamped.toFixed(2)}s
        </span>
      </div>
      <svg
        ref={svgRef}
        width={W}
        height={H}
        style={{ background: "#0a0a0a", borderRadius: 2, display: "block", cursor: "default" }}
        aria-label="Fade envelope — drag handles to adjust fade in/out"
      >
        <title>Fade envelope — drag handles to adjust fade in/out</title>
        <line x1={PAD} y1={yBottom} x2={W - PAD} y2={yBottom} stroke="#2a2a2a" />
        <line x1={PAD} y1={yTop} x2={W - PAD} y2={yTop} stroke="#2a2a2a" strokeDasharray="2,3" />
        <polygon
          points={polygonPoints}
          fill="rgba(140, 204, 255, 0.12)"
          stroke="#8cf"
          strokeWidth={1.25}
          strokeLinejoin="round"
        />
        {/* Draggable handles at the two top corners of the trapezoid */}
        <circle
          cx={fadeInX}
          cy={yTop}
          r={5}
          fill="#8cf"
          stroke="#fff"
          strokeWidth={1}
          style={{ cursor: "ew-resize" }}
          onPointerDown={(e) => startDrag("fadeIn", e)}
        />
        <circle
          cx={fadeOutX}
          cy={yTop}
          r={5}
          fill="#8cf"
          stroke="#fff"
          strokeWidth={1}
          style={{ cursor: "ew-resize" }}
          onPointerDown={(e) => startDrag("fadeOut", e)}
        />
      </svg>
    </div>
  );
};
