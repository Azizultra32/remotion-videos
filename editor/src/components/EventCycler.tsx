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

const NUDGE_SEC = 0.05; // fine-adjust step for the ← / → buttons

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

const actionBtn = (variant: "primary" | "danger" | "ghost", disabled = false): React.CSSProperties => ({
  padding: "3px 10px",
  fontSize: 10,
  fontFamily: "monospace",
  background:
    disabled ? "#222" :
    variant === "primary" ? "#1a3a1a" :
    variant === "danger" ? "#3a1a1a" : "#1a1a1a",
  border: "1px solid " + (
    disabled ? "#333" :
    variant === "primary" ? "#386" :
    variant === "danger" ? "#833" : "#444"
  ),
  borderRadius: 3,
  color:
    disabled ? "#666" :
    variant === "primary" ? "#afa" :
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
  const [draftSec, setDraftSec] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const events =
    (beatData?.phase2_events_sec?.length
      ? beatData.phase2_events_sec
      : beatData?.phase1_events_sec) ?? [];
  const stem = stemFromAudioSrc(audioSrc);

  // Click outside the row deselects.
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

  // Sync the draft input whenever the selected event\'s stored time changes
  // (happens after every save — keeps the input matching what\'s persisted).
  useEffect(() => {
    if (selectedIdx === null) return;
    if (selectedIdx >= events.length) {
      setSelectedIdx(null);
      return;
    }
    setDraftSec(events[selectedIdx].toFixed(3));
  }, [selectedIdx, events]);

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
    setDraftSec(t.toFixed(3));
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

  const setEventTo = async (idx: number, newSec: number): Promise<boolean> => {
    if (!Number.isFinite(newSec) || newSec < 0) {
      setError("time must be non-negative");
      return false;
    }
    const next = events.slice();
    next[idx] = newSec;
    return postEvents(next);
  };

  const saveTyped = async () => {
    if (selectedIdx === null) return;
    const parsed = Number(draftSec);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("time must be a non-negative number");
      return;
    }
    await setEventTo(selectedIdx, parsed);
  };

  const snapSelected = async () => {
    if (selectedIdx === null) return;
    const beats = beatData?.beats ?? [];
    if (beats.length === 0) {
      setError("no beat grid; run Seed Beats first");
      return;
    }
    const snapped = nearestBeat(events[selectedIdx], beats);
    if (Math.abs(snapped - events[selectedIdx]) < 0.001) {
      setError("already on nearest beat");
      return;
    }
    await setEventTo(selectedIdx, snapped);
  };

  const snapToPlayhead = async () => {
    if (selectedIdx === null) return;
    const t = currentTimeSec;
    if (!Number.isFinite(t) || t < 0) {
      setError("playhead position invalid");
      return;
    }
    if (Math.abs(t - events[selectedIdx]) < 0.001) {
      setError("event is already at the playhead");
      return;
    }
    await setEventTo(selectedIdx, t);
  };

  const nudge = async (delta: number) => {
    if (selectedIdx === null) return;
    const next = Math.max(0, events[selectedIdx] + delta);
    await setEventTo(selectedIdx, next);
  };

  const duplicate = async () => {
    if (selectedIdx === null) return;
    const t = events[selectedIdx];
    // Offset by 0.1s so server-side dedupe (0.05s threshold) keeps both.
    const next = events.slice().concat(t + 0.1);
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
          <span style={{ fontSize: 10, color: "#888", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
            EVT {selectedIdx + 1} —
          </span>
          <input
            type="number"
            step="0.001"
            min={0}
            value={draftSec}
            onChange={(e) => setDraftSec(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void saveTyped(); }}
            disabled={busy}
            title="Type an exact time (seconds) and press Enter / SET to jump the event to it."
            style={{
              width: 80,
              padding: "3px 6px",
              fontSize: 10,
              fontFamily: "monospace",
              background: busy ? "#111" : "#1a1a1a",
              color: busy ? "#666" : "#fff",
              border: "1px solid #333",
              borderRadius: 3,
            }}
          />
          <button
            onClick={() => void saveTyped()}
            disabled={busy}
            title="Save the typed time."
            style={actionBtn("primary", busy)}
          >
            SET
          </button>
          <button
            onClick={() => void nudge(-NUDGE_SEC)}
            disabled={busy}
            title={`Move event earlier by ${NUDGE_SEC}s.`}
            style={actionBtn("ghost", busy)}
          >
            ← NUDGE
          </button>
          <button
            onClick={() => void nudge(NUDGE_SEC)}
            disabled={busy}
            title={`Move event later by ${NUDGE_SEC}s.`}
            style={actionBtn("ghost", busy)}
          >
            NUDGE →
          </button>
          <button
            onClick={() => void snapSelected()}
            disabled={busy}
            title="Snap this event to the nearest detected beat. Requires a beat grid — if none, run Seed Beats first (error inlines)."
            style={actionBtn("ghost", busy)}
          >
            Snap to beat
          </button>
          <button
            onClick={() => void snapToPlayhead()}
            disabled={busy}
            title="Move this event to the current playhead position."
            style={actionBtn("ghost", busy)}
          >
            Snap to playhead
          </button>
          <button
            onClick={() => void duplicate()}
            disabled={busy}
            title="Add a new event 0.1s after this one."
            style={actionBtn("ghost", busy)}
          >
            Duplicate
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
            or drag the yellow line on the waveform
          </span>
          {error && (
            <span style={{ fontSize: 10, color: "#f66", fontFamily: "monospace" }}>{error}</span>
          )}
        </div>
      )}
    </div>
  );
};
