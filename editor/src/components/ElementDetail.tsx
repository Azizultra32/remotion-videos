// src/components/ElementDetail.tsx
import { useEditorStore } from "../store";
import { getElementModule } from "@compositions/elements/registry";
import { SchemaEditor } from "./SchemaEditor";

const fieldStyle: React.CSSProperties = {
  padding: "6px 8px",
  background: "#222",
  border: "1px solid #444",
  borderRadius: 4,
  color: "#fff",
  fontSize: 12,
};

const labelStyle: React.CSSProperties = { fontSize: 11, color: "#aaa" };

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span style={labelStyle}>{label}</span>
    {children}
  </label>
);

const buildTimingEditorHash = (damping: number, stiffness: number): string => {
  const cfg = {
    components: [
      {
        id: "timing-1",
        mixingMode: "additive",
        config: {
          type: "spring",
          springConfig: { damping, mass: 1, stiffness, overshootClamping: false },
          durationInFrames: null,
          delay: 0,
          reverse: false,
        },
      },
    ],
    selectedAnimation: "Scale",
  };
  return `#config=${btoa(JSON.stringify(cfg))}`;
};

export const ElementDetail = () => {
  const {
    selectedElementId,
    elements,
    updateElement,
    removeElement,
    beatData,
    snapMode,
  } = useEditorStore();
  const element = elements.find((e) => e.id === selectedElementId);

  if (!element) {
    return (
      <div style={{ padding: 16, color: "#888", fontSize: 12 }}>
        No element selected. Click an element on the timeline to edit.
      </div>
    );
  }

  const mod = getElementModule(element.type);

  const snapStart = () => {
    if (!beatData) return;
    const beats = beatData.beats ?? [];
    if (beats.length === 0) return;
    let best = beats[0];
    let bestDist = Math.abs(beats[0] - element.startSec);
    for (const b of beats) {
      const d = Math.abs(b - element.startSec);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    updateElement(element.id, { startSec: best });
  };

  const hasSpringProps =
    typeof element.props.damping === "number" &&
    typeof element.props.stiffness === "number";
  const openTimingEditor = () => {
    const d = Number(element.props.damping);
    const s = Number(element.props.stiffness);
    const url = `https://www.remotion.dev/timing-editor${buildTimingEditorHash(d, s)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          {element.label}{" "}
          <span style={{ color: "#666", fontWeight: 400, fontSize: 10 }}>
            ({mod ? mod.id : `unknown: ${element.type}`})
          </span>
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

      {!mod && (
        <div style={{ padding: 8, background: "#3a1a1a", color: "#faa", fontSize: 11, borderRadius: 4 }}>
          No renderer registered for type <code>{element.type}</code>. This element will not appear in the preview.
          Delete it or change the type.
        </div>
      )}

      <Field label="Label">
        <input
          type="text"
          value={element.label}
          onChange={(e) => updateElement(element.id, { label: e.target.value })}
          style={fieldStyle}
        />
      </Field>

      <div style={{ display: "flex", gap: 8 }}>
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
        {beatData && snapMode !== "off" && (
          <button
            onClick={snapStart}
            title="Snap start time to nearest detected beat"
            style={{
              alignSelf: "flex-end",
              padding: "6px 8px",
              background: "#1a3a1a",
              border: "1px solid #386",
              borderRadius: 4,
              color: "#afa",
              fontSize: 10,
              cursor: "pointer",
              height: 30,
            }}
          >
            Snap
          </button>
        )}
      </div>

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

      <Field label="Track Index">
        <input
          type="number"
          step="1"
          min={0}
          max={20}
          value={element.trackIndex}
          onChange={(e) =>
            updateElement(element.id, { trackIndex: parseInt(e.target.value, 10) || 0 })
          }
          style={fieldStyle}
        />
      </Field>

      <div style={{ height: 1, background: "#333", margin: "4px 0" }} />

      {hasSpringProps && (
        <button
          onClick={openTimingEditor}
          style={{
            padding: "6px 8px",
            background: "#1a2a3a",
            border: "1px solid #368",
            borderRadius: 4,
            color: "#8cf",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Tune spring in Timing Editor
        </button>
      )}

      {mod && (
        <SchemaEditor
          schema={mod.schema}
          value={element.props}
          onChange={(patch) =>
            updateElement(element.id, { props: { ...element.props, ...patch } })
          }
        />
      )}
    </div>
  );
};
