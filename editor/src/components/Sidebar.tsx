// src/components/Sidebar.tsx
//
// Compact element palette: ONE category visible at a time via tabs.
// Showing all ~28 engine elements simultaneously made the palette
// several viewports tall; the user had to scroll past Text to find
// Audio/Shape/Overlay/Video. Tabs keep it bounded to ~8 items visible.
//
// Per-project custom elements (id prefix "custom.") are NOT surfaced
// in this palette by design. AHURA is a specific instance, not a
// reusable primitive — re-adding it from the palette makes no sense.
// Per-project primitives that truly are reusable still register with
// the engine and can be referenced from timeline.json / chat; they
// just don't clutter the "+ add new element" UI. If a project genuinely
// needs a palette entry for one, it should be promoted to an engine
// element via src/compositions/elements/.

import { useState } from "react";
import { ELEMENT_MODULES, listByCategory } from "@compositions/elements/registry";
import { useEditorStore } from "../store";
import type { TimelineElement } from "../types";

const newId = () => `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const CATEGORY_LABELS: Record<string, string> = {
  text: "Text",
  audio: "Audio",
  shape: "Shape",
  overlay: "Overlay",
  video: "Video",
};

const CATEGORY_ORDER = ["text", "audio", "shape", "overlay", "video"];

const isProjectElement = (id: string): boolean => id.startsWith("custom.");

export const Sidebar = () => {
  const { addElement, currentTimeSec, selectElement } = useEditorStore();
  const byCategory = listByCategory();
  const [activeCat, setActiveCat] = useState<string>("text");

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

  const visibleCats = CATEGORY_ORDER.filter(
    (c) => (byCategory[c] ?? []).filter((m) => !isProjectElement(m.id)).length > 0,
  );
  const activeMods = (byCategory[activeCat] ?? []).filter((m) => !isProjectElement(m.id));

  return (
    <div
      style={{
        background: "#0a0a0a",
        padding: 8,
        overflowY: "auto",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Category tabs — one row, one click switches the visible list. */}
      <div
        style={{
          display: "flex",
          gap: 2,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        {visibleCats.map((cat) => {
          const active = cat === activeCat;
          return (
            <button
              type="button"
              key={cat}
              onClick={() => setActiveCat(cat)}
              style={{
                padding: "4px 8px",
                background: active ? "#2a4a7a" : "#1a1a1a",
                border: `1px solid ${active ? "#3a6aaa" : "#333"}`,
                borderRadius: 3,
                color: active ? "#fff" : "#aaa",
                fontSize: 10,
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
                letterSpacing: "0.04em",
              }}
            >
              {CATEGORY_LABELS[cat] ?? cat}
            </button>
          );
        })}
      </div>

      {/* Element list for the active category. Compact single-line rows —
          description is in the title attribute for hover-tooltip. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {activeMods.map((mod) => (
          <button
            type="button"
            key={mod.id}
            onClick={() => handleAdd(mod.id)}
            title={mod.description}
            style={{
              padding: "6px 8px",
              background: "#161616",
              border: "1px solid #2a2a2a",
              borderRadius: 3,
              color: "#ddd",
              fontSize: 11,
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ color: "#4a9", fontSize: 10 }}>+</span>
            <span>{mod.label}</span>
          </button>
        ))}
      </div>

      <div style={{ fontSize: 9, color: "#555", marginTop: 10, lineHeight: 1.5 }}>
        Click to add at playhead. Hover for description. Drag on the timeline to move.
      </div>
    </div>
  );
};
