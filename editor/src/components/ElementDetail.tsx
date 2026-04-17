// src/components/ElementDetail.tsx
import { useEditorStore } from "../store";
import type { TimelineElement } from "../types";

const fieldStyle: React.CSSProperties = {
  padding: "6px 8px",
  background: "#222",
  border: "1px solid #444",
  borderRadius: 4,
  color: "#fff",
  fontSize: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#aaa",
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span style={labelStyle}>{label}</span>
    {children}
  </label>
);

/**
 * Mini spring-response preview. Samples a damped-oscillator response over
 * `frames` steps at fps=30, draws it as an SVG polyline. Target is 1, resting
 * position is 0. Useful for tuning damping/stiffness visually without rendering.
 */
const SpringPreview = ({
  damping,
  stiffness,
  frames = 60,
  width = 200,
  height = 60,
}: {
  damping: number;
  stiffness: number;
  frames?: number;
  width?: number;
  height?: number;
}) => {
  const mass = 1;
  const target = 1;
  const dt = 1 / 30;

  let pos = 0;
  let vel = 0;
  const yMin = -0.5;
  const yMax = 1.8;
  const range = yMax - yMin;
  const toY = (v: number) => height - ((v - yMin) / range) * height;

  const pts: string[] = [];
  for (let i = 0; i < frames; i++) {
    const force = -stiffness * (pos - target) - damping * vel;
    vel += (force / mass) * dt;
    pos += vel * dt;
    const x = (i / (frames - 1)) * width;
    const y = toY(Math.max(yMin, Math.min(yMax, pos)));
    pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  return (
    <svg
      width={width}
      height={height}
      style={{ background: "#0a0a0a", borderRadius: 4, display: "block" }}
    >
      {/* Zero line */}
      <line x1={0} y1={toY(0)} x2={width} y2={toY(0)} stroke="#333" strokeWidth={0.5} />
      {/* Target line */}
      <line
        x1={0}
        y1={toY(target)}
        x2={width}
        y2={toY(target)}
        stroke="#444"
        strokeDasharray="2 3"
        strokeWidth={0.5}
      />
      <path d={pts.join(" ")} fill="none" stroke="#4CAF50" strokeWidth={1.5} />
    </svg>
  );
};

const TextControls = ({ element }: { element: TimelineElement }) => {
  const { updateElement } = useEditorStore();
  const word = typeof element.props.word === "string" ? element.props.word : "";
  const fontSize = typeof element.props.fontSize === "number" ? element.props.fontSize : 72;
  const color = typeof element.props.color === "string" ? element.props.color : "#ffffff";
  // Spring config (Remotion default-ish: damping=10, stiffness=100, mass=1)
  const damping = typeof element.props.damping === "number" ? element.props.damping : 10;
  const stiffness = typeof element.props.stiffness === "number" ? element.props.stiffness : 100;

  const setProp = (k: string, v: unknown) =>
    updateElement(element.id, { props: { ...element.props, [k]: v } });

  return (
    <>
      <Field label="Word / Text">
        <input
          type="text"
          value={word}
          onChange={(e) => setProp("word", e.target.value)}
          style={fieldStyle}
        />
      </Field>
      <Field label={`Font Size (${fontSize}px)`}>
        <input
          type="range"
          min={12}
          max={200}
          step={1}
          value={fontSize}
          onChange={(e) => setProp("fontSize", parseInt(e.target.value, 10))}
        />
      </Field>
      <Field label="Color">
        <input
          type="color"
          value={color}
          onChange={(e) => setProp("color", e.target.value)}
          style={{ ...fieldStyle, padding: 2, height: 28 }}
        />
      </Field>
      <Field label={`Spring Damping (${damping.toFixed(1)})`}>
        <input
          type="range"
          min={1}
          max={40}
          step={0.5}
          value={damping}
          onChange={(e) => setProp("damping", parseFloat(e.target.value))}
        />
      </Field>
      <Field label={`Spring Stiffness (${stiffness.toFixed(0)})`}>
        <input
          type="range"
          min={10}
          max={400}
          step={5}
          value={stiffness}
          onChange={(e) => setProp("stiffness", parseFloat(e.target.value))}
        />
      </Field>
      <Field label="Spring Response Preview">
        <SpringPreview damping={damping} stiffness={stiffness} />
      </Field>
    </>
  );
};

const ImageControls = ({ element }: { element: TimelineElement }) => {
  const { updateElement } = useEditorStore();
  const src = typeof element.props.src === "string" ? element.props.src : "";
  const opacity = typeof element.props.opacity === "number" ? element.props.opacity : 1;
  const scale = typeof element.props.scale === "number" ? element.props.scale : 1;

  const setProp = (k: string, v: unknown) =>
    updateElement(element.id, { props: { ...element.props, [k]: v } });

  return (
    <>
      <Field label="Source (path in public/)">
        <input
          type="text"
          value={src}
          onChange={(e) => setProp("src", e.target.value)}
          placeholder="public-cut.jpeg"
          style={fieldStyle}
        />
      </Field>
      <Field label={`Opacity (${opacity.toFixed(2)})`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setProp("opacity", parseFloat(e.target.value))}
        />
      </Field>
      <Field label={`Scale (${scale.toFixed(2)}x)`}>
        <input
          type="range"
          min={0.1}
          max={3}
          step={0.05}
          value={scale}
          onChange={(e) => setProp("scale", parseFloat(e.target.value))}
        />
      </Field>
    </>
  );
};

const EffectControls = ({ element }: { element: TimelineElement }) => {
  const { updateElement } = useEditorStore();
  const effect = typeof element.props.effect === "string" ? element.props.effect : "zoom";
  const intensity = typeof element.props.intensity === "number" ? element.props.intensity : 1;

  const setProp = (k: string, v: unknown) =>
    updateElement(element.id, { props: { ...element.props, [k]: v } });

  return (
    <>
      <Field label="Effect Type">
        <select
          value={effect}
          onChange={(e) => setProp("effect", e.target.value)}
          style={fieldStyle}
        >
          <option value="zoom">Zoom</option>
          <option value="fade">Fade</option>
          <option value="shake">Shake</option>
          <option value="glow">Glow</option>
          <option value="blur">Blur</option>
        </select>
      </Field>
      <Field label={`Intensity (${intensity.toFixed(2)})`}>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={intensity}
          onChange={(e) => setProp("intensity", parseFloat(e.target.value))}
        />
      </Field>
    </>
  );
};

const BeatFlashControls = ({ element }: { element: TimelineElement }) => {
  const { updateElement } = useEditorStore();
  const color = typeof element.props.color === "string" ? element.props.color : "#ffffff";
  const intensity = typeof element.props.intensity === "number" ? element.props.intensity : 0.8;

  const setProp = (k: string, v: unknown) =>
    updateElement(element.id, { props: { ...element.props, [k]: v } });

  return (
    <>
      <Field label="Flash Color">
        <input
          type="color"
          value={color}
          onChange={(e) => setProp("color", e.target.value)}
          style={{ ...fieldStyle, padding: 2, height: 28 }}
        />
      </Field>
      <Field label={`Intensity (${intensity.toFixed(2)})`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={intensity}
          onChange={(e) => setProp("intensity", parseFloat(e.target.value))}
        />
      </Field>
    </>
  );
};

export const ElementDetail = () => {
  const { selectedElementId, elements, updateElement, removeElement } = useEditorStore();
  const element = elements.find((e) => e.id === selectedElementId);

  if (!element) {
    return (
      <div style={{ padding: 16, color: "#888", fontSize: 12 }}>
        No element selected. Click an element on the timeline to edit.
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          {element.label}{" "}
          <span style={{ color: "#666", fontWeight: 400 }}>({element.type})</span>
        </h3>
        <button
          onClick={() => removeElement(element.id)}
          style={{
            padding: "4px 10px",
            background: "#4a1a1a",
            border: "1px solid #833",
            borderRadius: 4,
            color: "#f88",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Delete
        </button>
      </div>

      <Field label="Label">
        <input
          type="text"
          value={element.label}
          onChange={(e) => updateElement(element.id, { label: e.target.value })}
          style={fieldStyle}
        />
      </Field>

      <Field label="Start Time (sec)">
        <input
          type="number"
          step="0.1"
          min={0}
          value={element.startSec}
          onChange={(e) =>
            updateElement(element.id, { startSec: parseFloat(e.target.value) || 0 })
          }
          style={fieldStyle}
        />
      </Field>

      <Field label="Duration (sec)">
        <input
          type="number"
          step="0.1"
          min={0.05}
          value={element.durationSec}
          onChange={(e) =>
            updateElement(element.id, { durationSec: parseFloat(e.target.value) || 0.05 })
          }
          style={fieldStyle}
        />
      </Field>

      <div style={{ height: 1, background: "#333", margin: "4px 0" }} />

      {element.type === "text" && <TextControls element={element} />}
      {element.type === "image" && <ImageControls element={element} />}
      {element.type === "effect" && <EffectControls element={element} />}
      {element.type === "beat-flash" && <BeatFlashControls element={element} />}
    </div>
  );
};
