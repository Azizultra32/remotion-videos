// editor/src/components/StageStrip.tsx
//
// Analysis control strip — always visible when a track is loaded. When no
// analysis is in flight, shows "Ready" + a RE-ANALYZE button + a CLEAR
// EVENTS button. When a run is active, shows live phase chips (SETUP …
// DONE) driven by /api/analyze/status/:stem SSE. The RE-ANALYZE button
// disables itself while a run is in flight so the user can't double-kick
// an analysis.

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { stemFromAudioSrc } from "../utils/url";

type Status = {
  startedAt: number;
  phase: string;
  stage: { current: number; total: number; label: string } | null;
  updatedAt: number;
  endedAt: number | null;
};

const STAGES = [
  "setup",
  "phase1-review",
  "phase1-zoom",
  "phase1-confirmed",
  "phase2-slice",
  "phase2-zoom",
  "phase2-confirmed",
  "done",
];

const btnStyle = (variant: "primary" | "danger" | "ghost"): React.CSSProperties => ({
  padding: "3px 10px",
  fontSize: 10,
  fontFamily: "monospace",
  background: variant === "primary" ? "#2196F3" : variant === "danger" ? "#8a2a2a" : "#1a1a1a",
  border: "1px solid " + (variant === "primary" ? "#2196F3" : variant === "danger" ? "#b44" : "#333"),
  borderRadius: 3,
  color: "#fff",
  cursor: "pointer",
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
});

export const StageStrip = () => {
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const stem = stemFromAudioSrc(audioSrc);
  const beatData = useEditorStore((s) => s.beatData);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"run" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setStatus(null);
    setError(null);
    if (!stem) return;
    try {
      const es = new EventSource(`/api/analyze/status/${stem}`);
      es.addEventListener("status", (e: MessageEvent) => {
        try {
          const parsed = e.data === "null" ? null : (JSON.parse(e.data) as Status);
          setStatus(parsed);
          if (parsed && parsed.endedAt) setBusy(null);
        } catch {
          /* ignore malformed */
        }
      });
      esRef.current = es;
    } catch {
      /* EventSource unsupported */
    }
    return () => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [stem]);

  if (!stem) return null;

  const isRunning =
    !!status && !!status.startedAt && !status.endedAt;
  const isFailed = status?.phase === "failed";
  const eventCount =
    beatData?.phase2_events_sec?.length ??
    beatData?.phase1_events_sec?.length ??
    0;

  const runAnalysis = async () => {
    if (!stem) return;
    setBusy("run");
    setError(null);
    try {
      const r = await fetch("/api/analyze/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stem }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.error ?? `HTTP ${r.status}`);
        setBusy(null);
      }
      // On 202 the SSE will start pushing phase updates — busy clears
      // when endedAt lands.
    } catch (err) {
      setError(String(err));
      setBusy(null);
    }
  };

  const clearEvents = async () => {
    if (!stem) return;
    if (!window.confirm(`Clear pipeline events for ${stem}? User-origin elements are kept. Re-analyze to regenerate.`)) return;
    setBusy("clear");
    setError(null);
    try {
      const r = await fetch("/api/analyze/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stem }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.error ?? `HTTP ${r.status}`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "4px 16px",
        borderBottom: "1px solid #222",
        background: "#0a0a0a",
        overflowX: "auto",
        flexWrap: "wrap",
        rowGap: 4,
      }}
    >
      <span style={{ fontSize: 10, color: "#888", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Analysis
      </span>

      {/* Stage chips — only while running */}
      {isRunning && !isFailed && STAGES.map((s, i) => {
        const currentIdx = STAGES.indexOf(status!.phase);
        const active = i === currentIdx;
        const done = i < currentIdx;
        return (
          <span
            key={s}
            style={{
              padding: "3px 8px",
              fontSize: 9,
              fontFamily: "monospace",
              borderRadius: 3,
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
              background: done ? "#2196F3" : active ? "#1e88e5" : "#1a1a1a",
              color: "#fff",
              border: "1px solid " + (i <= currentIdx ? "#2196F3" : "#333"),
              opacity: active ? 1 : done ? 0.9 : 0.5,
            }}
          >
            {s.toUpperCase()}
            {active && status!.stage ? `  ${status!.stage.current}/${status!.stage.total}` : ""}
          </span>
        );
      })}

      {isFailed && (
        <span
          style={{
            padding: "3px 8px",
            fontSize: 9,
            fontFamily: "monospace",
            background: "#c33",
            color: "#fff",
            border: "1px solid #c33",
            borderRadius: 3,
            letterSpacing: "0.06em",
          }}
        >
          LAST RUN FAILED
        </span>
      )}

      {!isRunning && !isFailed && (
        <span
          style={{
            padding: "3px 8px",
            fontSize: 9,
            fontFamily: "monospace",
            background: eventCount > 0 ? "#1a1a1a" : "#2a2a2a",
            color: eventCount > 0 ? "#6af" : "#aaa",
            border: "1px solid " + (eventCount > 0 ? "#2196F3" : "#444"),
            borderRadius: 3,
            letterSpacing: "0.06em",
          }}
        >
          {eventCount > 0 ? `${eventCount} EVENTS` : "NO EVENTS"}
        </span>
      )}

      {error && (
        <span style={{ fontSize: 10, color: "#f66", fontFamily: "monospace" }}>
          {error}
        </span>
      )}

      <div style={{ flex: 1 }} />

      <button
        onClick={runAnalysis}
        disabled={isRunning || busy === "run"}
        title={
          isRunning
            ? "Analysis already running — wait for it to finish."
            : "Run npm run mv:analyze in the background. Takes 5–10 min. Progress streams here as stage chips."
        }
        style={{
          ...btnStyle("primary"),
          opacity: isRunning || busy === "run" ? 0.5 : 1,
          cursor: isRunning || busy === "run" ? "not-allowed" : "pointer",
        }}
      >
        {busy === "run" ? "Starting…" : isRunning ? "Running…" : "Re-analyze"}
      </button>

      <button
        onClick={clearEvents}
        disabled={busy === "clear" || eventCount === 0}
        title="Remove all pipeline-origin events from the timeline. User elements are kept. Does not delete on-disk artifacts."
        style={{
          ...btnStyle("danger"),
          opacity: busy === "clear" || eventCount === 0 ? 0.5 : 1,
          cursor: busy === "clear" || eventCount === 0 ? "not-allowed" : "pointer",
        }}
      >
        {busy === "clear" ? "Clearing…" : "Clear events"}
      </button>
    </div>
  );
};
