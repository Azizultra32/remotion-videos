import { useEditorStore } from "../store";

const fmtTime = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: "3px 8px",
  fontSize: 10,
  fontFamily: "monospace",
  background: active ? "#2196F3" : "#1a1a1a",
  border: "1px solid " + (active ? "#2196F3" : "#333"),
  borderRadius: 3,
  color: "#fff",
  cursor: "pointer",
  letterSpacing: "0.04em",
});

export const EventCycler = () => {
  // All hooks must run unconditionally — no early return before the last
  // store subscription below. Otherwise React sees a changing hook count
  // between renders and throws "Rendered more hooks than previous render".
  const beatData = useEditorStore((s) => s.beatData);
  const elements = useEditorStore((s) => s.elements);
  const currentTimeSec = useEditorStore((s) => s.currentTimeSec);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const selectElement = useEditorStore((s) => s.selectElement);

  const events =
    (beatData?.phase2_events_sec?.length
      ? beatData.phase2_events_sec
      : beatData?.phase1_events_sec) ?? [];
  if (!events.length) return null;

  const activeIndex = events.findIndex((t, i) => {
    const next = events[i + 1] ?? Number.POSITIVE_INFINITY;
    return currentTimeSec >= t - 0.5 && currentTimeSec < next - 0.5;
  });

  const go = (idx: number) => {
    if (idx < 0 || idx >= events.length) return;
    const t = events[idx];
    setCurrentTime(t);
    const el = elements.find(
      (e) =>
        e.origin === "pipeline" &&
        Math.abs(e.startSec + e.durationSec / 2 - t) < 0.1,
    );
    if (el) selectElement(el.id);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 16px",
        borderBottom: "1px solid #222",
        background: "#0a0a0a",
        flexWrap: "wrap",
        rowGap: 4,
      }}
    >
      <button
        onClick={() => go(Math.max(0, activeIndex - 1))}
        disabled={activeIndex <= 0}
        style={chipStyle(false)}
      >
        PREV
      </button>
      {events.map((t, i) => (
        <button
          key={`evt-${i}`}
          onClick={() => go(i)}
          style={chipStyle(i === activeIndex)}
          title={`Event ${i + 1} at ${t.toFixed(2)}s`}
        >
          {`EVT ${i + 1}  ${fmtTime(t)}`}
        </button>
      ))}
      <button
        onClick={() =>
          go(Math.min(events.length - 1, activeIndex + 1))
        }
        disabled={activeIndex >= events.length - 1}
        style={chipStyle(false)}
      >
        NEXT
      </button>
    </div>
  );
};
