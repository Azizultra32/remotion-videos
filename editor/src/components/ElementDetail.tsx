// src/components/ElementDetail.tsx
import { useEditorStore } from "../store";

export const ElementDetail = () => {
  const { selectedElementId, elements, updateElement } = useEditorStore();
  const element = elements.find((e) => e.id === selectedElementId);

  if (!element) {
    return (
      <div style={{ padding: 16, color: "#888" }}>
        No element selected. Click an element on the timeline to edit.
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 16px 0", fontSize: 14, fontWeight: 600 }}>
        {element.label}
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#aaa" }}>Label</span>
          <input
            type="text"
            value={element.label}
            onChange={(e) => updateElement(element.id, { label: e.target.value })}
            style={{
              padding: "6px 8px",
              background: "#222",
              border: "1px solid #444",
              borderRadius: 4,
              color: "#fff",
              fontSize: 12,
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#aaa" }}>Start Time (sec)</span>
          <input
            type="number"
            step="0.1"
            value={element.startSec}
            onChange={(e) => updateElement(element.id, { startSec: parseFloat(e.target.value) })}
            style={{
              padding: "6px 8px",
              background: "#222",
              border: "1px solid #444",
              borderRadius: 4,
              color: "#fff",
              fontSize: 12,
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#aaa" }}>Duration (sec)</span>
          <input
            type="number"
            step="0.1"
            value={element.durationSec}
            onChange={(e) => updateElement(element.id, { durationSec: parseFloat(e.target.value) })}
            style={{
              padding: "6px 8px",
              background: "#222",
              border: "1px solid #444",
              borderRadius: 4,
              color: "#fff",
              fontSize: 12,
            }}
          />
        </label>
      </div>
    </div>
  );
};
