// src/components/Sidebar.tsx

import { ELEMENT_MODULES, listByCategory } from "@compositions/elements/registry";
import { useEditorStore } from "../store";
import type { TimelineElement } from "../types";

const newId = () => `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const CATEGORY_LABELS: Record<string, string> = {
  text: "TEXT",
  audio: "AUDIO REACTIVE",
  shape: "SHAPES",
  overlay: "OVERLAYS",
  video: "VIDEO",
};

const CATEGORY_ORDER = ["text", "audio", "shape", "overlay", "video"];

export const Sidebar = () => {
  const { addElement, currentTimeSec, selectElement } = useEditorStore();
  const byCategory = listByCategory();

  const handleAdd = (moduleId: string) => {
    const mod = ELEMENT_MODULES.find((m) => m.id === moduleId);
    if (!mod) return;
    const el: TimelineElement = {
      id: newId(),
      label: mod.label,
      type: mod.id,
      trackIndex: mod.defaultTrack,
      startSec: Math.max(0, currentTimeSec),
      durationSec: mod.defaultDurationSec,
      props: { ...mod.defaults },
    };
    addElement(el);
    selectElement(el.id);
  };

  return (
    <div
      style={{
        borderRight: "1px solid #333",
        background: "#0a0a0a",
        padding: 12,
        overflowY: "auto",
      }}
    >
      {CATEGORY_ORDER.filter((c) => (byCategory[c] ?? []).length > 0).map((cat) => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <h3
            style={{
              margin: "0 0 8px 0",
              fontSize: 10,
              fontWeight: 700,
              color: "#666",
              letterSpacing: "0.1em",
            }}
          >
            {CATEGORY_LABELS[cat] ?? cat.toUpperCase()}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {byCategory[cat].map((mod) => (
              <button
                key={mod.id}
                onClick={() => handleAdd(mod.id)}
                title={mod.description}
                style={{
                  padding: "6px 8px",
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
                <span style={{ fontWeight: 600 }}>+ {mod.label}</span>
                <span style={{ fontSize: 9, color: "#777" }}>{mod.description}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 10, color: "#666", lineHeight: 1.4, marginTop: 8 }}>
        Click to add at the current playhead. Drag on the timeline to move. Configure in the right
        panel.
      </div>
    </div>
  );
};
