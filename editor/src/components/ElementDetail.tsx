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

const TextControls = ({ element }: { element: TimelineElement }) => {
  const { updateElement } = useEditorStore();
  const word = typeof element.props.word === "string" ? element.props.word : "";
  const fontSize = typeof element.props.fontSize === "number" ? element.props.fontSize : 72;
  const color = typeof element.props.color === "string" ? element.props.color : "#ffffff";

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
