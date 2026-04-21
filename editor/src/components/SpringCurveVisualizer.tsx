// src/components/SpringCurveVisualizer.tsx
//
// Inline visual editor for spring-based element props. Replaces the three
// raw number inputs (damping / mass / stiffness) with a live SVG curve +
// sliders + Remotion's standard presets, so the user can SEE the motion
// they're configuring instead of typing numbers blind.
//
// Bound directly to element.props — every slider move / preset click
// patches the timeline element in place. The full Remotion Timing Editor
// is still one click away via the `onOpenFullEditor` link, but for the
// 90% case (just tune a spring) everything is inline.
//
// Curve math: we call remotion's `spring()` once per frame for a 60-frame
// window, which is a pure function (no Remotion render context required).
// Samples get plotted as an SVG polyline. Dashed reference lines at y=0
// and y=1 make overshoot behavior obvious.

import { spring } from "remotion";
import { useMemo } from "react";

type SpringParams = {
  damping: number;
  mass: number;
  stiffness: number;
  overshootClamping: boolean;
};

// Remotion's standard presets (damping/mass/stiffness/overshootClamping).
// Defaults match `spring()`'s own defaults. `Gentle/Wobbly/Stiff/Slow`
// mirror react-spring community conventions.
const PRESETS: Array<[string, SpringParams]> = [
  ["Default",    { damping: 10, mass: 1, stiffness: 100, overshootClamping: false }],
  ["Gentle",     { damping: 15, mass: 1, stiffness: 50,  overshootClamping: false }],
  ["Wobbly",     { damping: 7,  mass: 1, stiffness: 100, overshootClamping: false }],
  ["Stiff",      { damping: 20, mass: 1, stiffness: 300, overshootClamping: false }],
  ["Slow",       { damping: 14, mass: 1, stiffness: 40,  overshootClamping: false }],
  ["No overshoot", { damping: 10, mass: 1, stiffness: 100, overshootClamping: true }],
];

const W = 320;
const H = 120;
const SAMPLES = 60; // 60 frames = 2s at 30fps, 2.5s at 24fps

type Props = SpringParams & {
  fps: number;
  onChange: (patch: Partial<SpringParams>) => void;
  onOpenFullEditor?: () => void;
};

export const SpringCurveVisualizer: React.FC<Props> = ({
  damping,
  mass,
  stiffness,
  overshootClamping,
  fps,
  onChange,
  onOpenFullEditor,
}) => {
  const samples = useMemo(() => {
    const out: number[] = [];
    for (let f = 0; f < SAMPLES; f++) {
      out.push(
        spring({
          frame: f,
          fps,
          config: { damping, mass, stiffness, overshootClamping },
        }),
      );
    }
    return out;
  }, [damping, mass, stiffness, overshootClamping, fps]);

  // Pad ranges so overshoot is visible above 1 and dip below 0 is visible.
  const minY = Math.min(-0.15, ...samples);
  const maxY = Math.max(1.25, ...samples);
  const yToPx = (v: number) => H - ((v - minY) / (maxY - minY)) * H;
  const xToPx = (i: number) => (i / (SAMPLES - 1)) * W;
  const points = samples.map((v, i) => `${xToPx(i).toFixed(1)},${yToPx(v).toFixed(1)}`).join(" ");
  const y0 = yToPx(0);
  const y1 = yToPx(1);

  const presetMatch = PRESETS.find(
    ([, p]) =>
      p.damping === damping &&
      p.mass === mass &&
      p.stiffness === stiffness &&
      p.overshootClamping === overshootClamping,
  )?.[0];

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
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 10,
          color: "#888",
          letterSpacing: "0.08em",
        }}
      >
        <span>SPRING CURVE{presetMatch ? ` · ${presetMatch}` : ""}</span>
        {onOpenFullEditor && (
          <button
            type="button"
            onClick={onOpenFullEditor}
            style={{
              fontSize: 10,
              padding: "2px 6px",
              background: "transparent",
              border: "1px solid #555",
              borderRadius: 2,
              color: "#8cf",
              cursor: "pointer",
            }}
            title="Open the full Remotion Timing Editor in a new tab"
          >
            full editor ↗
          </button>
        )}
      </div>
      <svg
        width={W}
        height={H}
        style={{ background: "#0a0a0a", borderRadius: 2, display: "block" }}
        aria-label="Spring animation curve preview"
      >
        <title>Spring animation curve preview</title>
        <line x1={0} y1={y0} x2={W} y2={y0} stroke="#2a2a2a" strokeDasharray="2,3" />
        <line x1={0} y1={y1} x2={W} y2={y1} stroke="#2a2a2a" strokeDasharray="2,3" />
        <text x={4} y={y0 - 2} fill="#444" fontSize="9">
          0
        </text>
        <text x={4} y={y1 - 2} fill="#444" fontSize="9">
          1
        </text>
        <polyline
          points={points}
          fill="none"
          stroke="#8cf"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <ParamSlider
        label="Damping"
        value={damping}
        min={1}
        max={50}
        step={0.5}
        onChange={(v) => onChange({ damping: v })}
      />
      <ParamSlider
        label="Mass"
        value={mass}
        min={0.1}
        max={10}
        step={0.1}
        onChange={(v) => onChange({ mass: v })}
      />
      <ParamSlider
        label="Stiffness"
        value={stiffness}
        min={1}
        max={500}
        step={1}
        onChange={(v) => onChange({ stiffness: v })}
      />
      <label
        style={{
          fontSize: 11,
          color: "#aaa",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <input
          type="checkbox"
          checked={overshootClamping}
          onChange={(e) => onChange({ overshootClamping: e.target.checked })}
        />
        Clamp overshoot (flat at 1, no bounce)
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {PRESETS.map(([name, p]) => {
          const isActive = name === presetMatch;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onChange(p)}
              style={{
                fontSize: 10,
                padding: "3px 8px",
                background: isActive ? "#1a3050" : "#222",
                border: `1px solid ${isActive ? "#368" : "#444"}`,
                borderRadius: 2,
                color: isActive ? "#8cf" : "#bbb",
                cursor: "pointer",
              }}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ParamSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, onChange }) => (
  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#aaa" }}>
    <span style={{ width: 62 }}>{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ flex: 1 }}
    />
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      style={{
        width: 52,
        padding: "2px 4px",
        background: "#222",
        border: "1px solid #444",
        borderRadius: 2,
        color: "#fff",
        fontSize: 11,
      }}
    />
  </label>
);
