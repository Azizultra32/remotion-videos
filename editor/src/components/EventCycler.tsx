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

const chipStyle = (active: boolean, editing: boolean): React.CSSProperties => ({
  padding: "3px 8px",
  fontSize: 10,
  fontFamily: "monospace",
  background: editing ? "#8a5a1a" : active ? "#2196F3" : "#1a1a1a",
  border: "1px solid " + (editing ? "#c89040" : active ? "#2196F3" : "#333"),
  borderRadius: 3,
  color: "#fff",
  cursor: "pointer",
  letterSpacing: "0.04em",
});

const smallBtn = (variant: "primary" | "danger" | "ghost", disabled = false): React.CSSProperties => ({
  padding: "3px 8px",
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
  letterSpacing: "0.04em",
});

export const EventCycler = () => {
  const beatData = useEditorStore((s) => s.beatData);
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const elements = useEditorStore((s) => s.elements);
  const currentTimeSec = useEditorStore((s) => s.currentTimeSec);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const selectElement = useEditorStore((s) => s.selectElement);

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draftSec, setDraftSec] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const events =
    (beatData?.phase2_events_sec?.length
      ? beatData.phase2_events_sec
      : beatData?.phase1_events_sec) ?? [];
  const stem = stemFromAudioSrc(audioSrc);

  // Click-outside closes the edit popover without discarding — Save/Cancel
  // are explicit. If the user clicks another chip, that chip's click handler
  // re-opens editing at that index (handled below).
  useEffect(() => {
    if (editingIdx === null) return;
    const onDown = (e: MouseEvent) => {
      if (!rowRef.current) return;
      if (e.target instanceof Node && rowRef.current.contains(e.target)) return;
      setEditingIdx(null);
      setError(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [editingIdx]);

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

  const startEdit = (idx: number) => {
    go(idx);
    setEditingIdx(idx);
    setDraftSec(events[idx].toFixed(3));
    setError(null);
  };

  const postEvents = async (next: number[]): Promise<boolean> => {
    if (!stem) {
      setError("no stem selected");
      return false;
    }
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

  const saveEdit = async () => {
    if (editingIdx === null) return;
    const parsed = Number(draftSec);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("time must be a non-negative number");
      return;
    }
    const next = events.slice();
    next[editingIdx] = parsed;
    // Sort + dedupe handled server-side, but we can close the editor now.
    const ok = await postEvents(next);
    if (ok) setEditingIdx(null);
  };

  const snap = () => {
    const parsed = Number(draftSec);
    if (!Number.isFinite(parsed)) return;
    const beats = beatData?.beats ?? [];
    if (beats.length === 0) {
      setError("no beat grid; run seed-beats first");
      return;
    }
    setDraftSec(nearestBeat(parsed, beats).toFixed(3));
  };

  const remove = async () => {
    if (editingIdx === null) return;
    if (!window.confirm(`Remove event at ${events[editingIdx].toFixed(2)}s?`)) return;
    const next = events.slice();
    next.splice(editingIdx, 1);
    const ok = await postEvents(next);
    if (ok) setEditingIdx(null);
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
            onClick={() => (editingIdx === i ? setEditingIdx(null) : startEdit(i))}
            style={chipStyle(i === activeIndex, i === editingIdx)}
            title={`Click to seek + edit. Event ${i + 1} at ${t.toFixed(2)}s.`}
          >
            {`EVT ${i + 1}  ${fmtTime(t)}`}
          </button>
        ))}
        <button
          onClick={() =>
            go(Math.min(events.length - 1, activeIndex + 1))
          }
          disabled={activeIndex >= events.length - 1}
          style={chipStyle(false, false)}
        >
          NEXT
        </button>
      </div>
      {editingIdx !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", rowGap: 4 }}>
          <span style={{ fontSize: 10, color: "#888", letterSpacing: "0.05em" }}>
            EVT {editingIdx + 1} —
          </span>
          <input
            type="number"
            step="0.001"
            min={0}
            value={draftSec}
            onChange={(e) => setDraftSec(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void saveEdit(); }}
            disabled={busy}
            style={{
              width: 90,
              padding: "3px 6px",
              fontSize: 10,
              fontFamily: "monospace",
              background: busy ? "#111" : "#1a1a1a",
              color: busy ? "#666" : "#fff",
              border: "1px solid #333",
              borderRadius: 3,
            }}
          />
          <button onClick={() => void saveEdit()} disabled={busy} style={smallBtn("primary", busy)}>
            SAVE
          </button>
          <button onClick={snap} disabled={busy || (beatData?.beats?.length ?? 0) === 0} style={smallBtn("ghost", busy || (beatData?.beats?.length ?? 0) === 0)}>
            SNAP
          </button>
          <button onClick={() => void remove()} disabled={busy} style={smallBtn("danger", busy)}>
            DELETE
          </button>
          <button onClick={() => { setEditingIdx(null); setError(null); }} disabled={busy} style={smallBtn("ghost", busy)}>
            CANCEL
          </button>
          {error && (
            <span style={{ fontSize: 10, color: "#f66", fontFamily: "monospace" }}>{error}</span>
          )}
        </div>
      )}
    </div>
  );
};
