// src/components/Sidebar.tsx
import { useEditorStore } from "../store";
import type { ElementType, TimelineElement } from "../types";

const newId = () => `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Preset = {
  label: string;
  type: ElementType;
  durationSec: number;
  trackIndex: number;
  props: Record<string, unknown>;
  description: string;
};

const presets: Preset[] = [
  {
    label: "Text Block",
    type: "text",
    durationSec: 2,
    trackIndex: 0,
    props: { word: "HELLO", fontSize: 72, color: "#ffffff" },
    description: "Animated title word",
  },
  {
    label: "Image",
    type: "image",
    durationSec: 3,
    trackIndex: 1,
    props: { src: "public-cut.jpeg", opacity: 1, scale: 1 },
    description: "Static image reveal",
  },
  {
    label: "Effect",
    type: "effect",
    durationSec: 1,
    trackIndex: 2,
    props: { effect: "zoom", intensity: 1 },
    description: "Generic visual effect",
  },
  {
    label: "Beat Flash",
    type: "beat-flash",
    durationSec: 0.2,
    trackIndex: 2,
    props: { color: "#ffffff", intensity: 0.8 },
    description: "Brief flash on a beat",
  },
];

export const Sidebar = () => {
  const { addElement, currentTimeSec, selectElement } = useEditorStore();

  const handleAdd = (preset: Preset) => {
    const el: TimelineElement = {
      id: newId(),
      label: preset.label.toUpperCase(),
      type: preset.type,
      trackIndex: preset.trackIndex,
      startSec: Math.max(0, currentTimeSec),
      durationSec: preset.durationSec,
      props: { ...preset.props },
    };
    addElement(el);
    selectElement(el.id);
  };

  return (
    <div
      style={{
        borderBottom: "1px solid #333",
        background: "#0a0a0a",
        padding: 12,
      }}
    >
      <h3 style={{ margin: "0 0 12px 0", fontSize: 12, fontWeight: 600, color: "#aaa" }}>
        ELEMENTS
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => handleAdd(p)}
            style={{
              padding: "8px 10px",
              background: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 4,
              color: "#fff",
              fontSize: 11,
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontWeight: 600 }}>+ {p.label}</span>
            <span style={{ fontSize: 10, color: "#888" }}>{p.description}</span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16, fontSize: 10, color: "#666", lineHeight: 1.4 }}>
        Click to add at current playhead time. Drag on timeline to move. Configure in right panel.
      </div>
    </div>
  );
};
