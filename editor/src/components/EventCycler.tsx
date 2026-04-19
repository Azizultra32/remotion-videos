import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { stemFromAudioSrc } from "../utils/url";

const fmtTime = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const nearestBeat = (sec: number, beats: number[]): number => {
  if (beats.length === 0) return sec;
  let best = beats[0];
  let minDist = Math.abs(best - sec);
  for (let i = 1; i < beats.length; i++) {
    const d = Math.abs(beats[i] - sec);
    if (d < minDist) { best = beats[i]; minDist = d; }
    else if (beats[i] > sec) break;
  }
  return best;
};

const chipStyle = (active: boolean, selected: boolean): React.CSSProperties => ({
  padding: "3px 8px",
  fontSize: 10,
  fontFamily: "monospace",
  background: selected ? "#8a5a1a" : active ? "#2196F3" : "#1a1a1a",
  border: "1px solid " + (selected ? "#c89040" : active ? "#2196F3" : "#333"),
  borderRadius: 3,
  color: "#fff",
  cursor: "pointer",
  letterSpacing: "0.04em",
});

const actionBtn = (variant: "danger" | "ghost", disabled = false): React.CSSProperties => ({
  padding: "3px 10px",
  fontSize: 10,
  fontFamily: "monospace",
  background:
    disabled ? "#222" :
    variant === "danger" ? "#3a1a1a" : "#1a1a1a",
  border: "1px solid " + (
    disabled ? "#333" :
    variant === "danger" ? "#833" : "#444"
  ),
  borderRadius: 3,
  color:
    disabled ? "#666" :
    variant === "danger" ? "#f88" : "#ddd",
  cursor: disabled ? "not-allowed" : "pointer",
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
});

export const EventCycler = () => {
  const beatData = useEditorStore((s) => s.beatData);
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const elements = useEditorStore((s) => s.elements);
  const currentTimeSec = useEditorStore((s) => s.currentTimeSec);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const selectElement = useEditorStore((s) => s.selectElement);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const events =
    (beatData?.phase2_events_sec?.length
      ? beatData.phase2_events_sec
      : beatData?.phase1_events_sec) ?? [];
  const stem = stemFromAudioSrc(audioSrc);

  // Click anywhere outside this row de-selects. We still want the in-row
  // button clicks to NOT close (they handle their own state transitions).
  useEffect(() => {
    if (selectedIdx === null) return;
    const onDown = (e: MouseEvent) => {
      if (!rowRef.current) return;
      if (e.target instanceof Node && rowRef.current.contains(e.target)) return;
      setSelectedIdx(null);
      setError(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [selectedIdx]);

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
    setSelectedIdx(idx);
    setError(null);
  };

  const postEvents = async (next: number[]): Promise<boolean> => {
    if (!stem) { setError("no stem"); return false; }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/analyze/events/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stem, events: next }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.error ?? `HTTP ${r.status}`);
        return false;
      }
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const snapSelected = async () => {
    if (selectedIdx === null) return;
    const beats = beatData?.beats ?? [];
    if (beats.length === 0) {
      setError("no beat grid; run Seed beats first");
      return;
    }
    const snapped = nearestBeat(events[selectedIdx], beats);
    if (Math.abs(snapped - events[selectedIdx]) < 0.001) {
      setError("already on nearest beat");
      return;
    }
    const next = events.slice();
    next[selectedIdx] = snapped;
    const ok = await postEvents(next);
    if (ok) setError(null);
  };

  const deleteSelected = async () => {
    if (selectedIdx === null) return;
    if (!window.confirm(`Remove event at ${events[selectedIdx].toFixed(2)}s?`)) return;
    const next = events.slice();
    next.splice(selectedIdx, 1);
    const ok = await postEvents(next);
    if (ok) setSelectedIdx(null);
  };

  return (
    <div
      ref={rowRef}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "4px 16px",
        borderBottom: "1px solid #222",
        background: "#0a0a0a",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", rowGap: 4 }}>
        <button
          onClick={() => go(Math.max(0, activeIndex - 1))}
          disabled={activeIndex <= 0}
          style={chipStyle(false, false)}
        >
          PREV
        </button>
        {events.map((t, i) => (
          <button
            key={`evt-${i}`}
            onClick={() => go(i)}
            style={chipStyle(i === activeIndex, i === selectedIdx)}
            title={`Event ${i + 1} at ${t.toFixed(2)}s — click to select. Drag the yellow line on the waveform to move.`}
          >
            {`EVT ${i + 1}  ${fmtTime(t)}`}
          </button>
        ))}
        <button
          onClick={() => go(Math.min(events.length - 1, activeIndex + 1))}
          disabled={activeIndex >= events.length - 1}
          style={chipStyle(false, false)}
        >
          NEXT
        </button>
      </div>
      {selectedIdx !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", rowGap: 4 }}>
          <span style={{ fontSize: 10, color: "#888", letterSpacing: "0.05em" }}>
            EVT {selectedIdx + 1} · {events[selectedIdx].toFixed(3)}s —
          </span>
          <button
            onClick={snapSelected}
            disabled={busy || (beatData?.beats?.length ?? 0) === 0}
            title="Snap this event to the nearest detected beat. Disabled when the track has no beat grid."
            style={actionBtn("ghost", busy || (beatData?.beats?.length ?? 0) === 0)}
          >
            Snap to beat
          </button>
          <button
            onClick={() => void deleteSelected()}
            disabled={busy}
            title="Remove this event from analysis.json. The pipeline element disappears too. User-origin elements stay."
            style={actionBtn("danger", busy)}
          >
            Delete
          </button>
          <span style={{ fontSize: 9, color: "#666", marginLeft: 6 }}>
            drag the yellow line on the waveform to move
          </span>
          {error && (
            <span style={{ fontSize: 10, color: "#f66", fontFamily: "monospace" }}>{error}</span>
          )}
        </div>
      )}
    </div>
  );
};
