// editor/src/components/TreeInspector.tsx
//
// Debugging-surface panel: at every playhead update, shows the list of
// elements currently active (startSec <= currentTimeSec < startSec+durationSec)
// with their id, type, label, position in the window, and key props. Click an
// entry to select it (same as clicking it on the timeline) — ElementDetail
// then takes over for prop editing.
//
// Answers the MC plan's "scene tree / composition inspector" gap. Simpler
// than MC's version because our element list IS the composition tree —
// no nested hierarchy to walk.

import { useEditorStore } from "../store";

const fmtTime = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const summarizeProps = (props: Record<string, unknown>): string => {
  const keys = Object.keys(props);
  if (keys.length === 0) return "{}";
  const parts: string[] = [];
  for (const k of keys.slice(0, 3)) {
    const v = props[k];
    const repr =
      typeof v === "string" ? (v.length > 16 ? `"${v.slice(0, 14)}…"` : `"${v}"`) :
      typeof v === "number" ? v.toFixed(3).replace(/\.?0+$/, "") :
      typeof v === "boolean" ? String(v) :
      Array.isArray(v) ? `[…${v.length}]` :
      v === null ? "null" :
      typeof v === "object" ? "{…}" : String(v);
    parts.push(`${k}: ${repr}`);
  }
  if (keys.length > 3) parts.push(`+${keys.length - 3} more`);
  return `{ ${parts.join(", ")} }`;
};

export const TreeInspector = () => {
  const elements = useEditorStore((s) => s.elements);
  const currentTimeSec = useEditorStore((s) => s.currentTimeSec);
  const selectedId = useEditorStore((s) => s.selectedElementId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);

  // Active = time range covers the playhead.
  const active = elements.filter(
    (el) => currentTimeSec >= el.startSec && currentTimeSec < el.startSec + el.durationSec,
  );
  const sorted = [...active].sort((a, b) => a.trackIndex - b.trackIndex);

  return (
    <div
      style={{
        borderTop: "1px solid #222",
        borderBottom: "1px solid #222",
        padding: "8px 16px",
        background: "#0a0a0a",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#888",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 6,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>Tree @ {fmtTime(currentTimeSec)}</span>
        <span style={{ color: "#555" }}>{sorted.length} active · {elements.length} total</span>
      </div>
      {sorted.length === 0 ? (
        <div style={{ fontSize: 10, color: "#555", fontStyle: "italic" }}>
          Nothing at the playhead.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {sorted.map((el) => {
            const isSelected = el.id === selectedId;
            const timeInEl = currentTimeSec - el.startSec;
            const pct = Math.min(100, Math.max(0, (timeInEl / el.durationSec) * 100));
            return (
              <button
                key={el.id}
                type="button"
                onClick={() => selectElement(el.id)}
                onDoubleClick={() => setCurrentTime(el.startSec)}
                title={`${el.id}\n${el.type}\nStart: ${el.startSec.toFixed(3)}s · Duration: ${el.durationSec.toFixed(3)}s · Track: ${el.trackIndex}\nDouble-click to seek to element start.`}
                style={{
                  background: isSelected ? "#1e3a5f" : "#141414",
                  border: "1px solid " + (isSelected ? "#2196F3" : "#2a2a2a"),
                  borderRadius: 3,
                  padding: "4px 6px",
                  textAlign: "left",
                  color: "#ddd",
                  fontFamily: "monospace",
                  fontSize: 10,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ color: "#888", width: 16 }}>#{el.trackIndex}</span>
                  <span style={{ fontWeight: 600, color: el.origin === "pipeline" ? "#fbbf24" : "#e5e5e5" }}>
                    {el.label}
                  </span>
                  <span style={{ color: "#666", fontSize: 9 }}>{el.type}</span>
                </div>
                {/* Progress bar showing position within the element */}
                <div style={{ position: "relative", height: 3, background: "#222", borderRadius: 1 }}>
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: "#3b82f6", borderRadius: 1 }} />
                </div>
                <div style={{ display: "flex", gap: 6, color: "#777", fontSize: 9 }}>
                  <span>{el.startSec.toFixed(2)}–{(el.startSec + el.durationSec).toFixed(2)}s</span>
                  <span style={{ marginLeft: "auto" }}>{timeInEl.toFixed(2)}s in</span>
                </div>
                <div style={{ color: "#666", fontSize: 9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {summarizeProps(el.props)}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
