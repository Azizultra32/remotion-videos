// editor/src/components/StageStrip.tsx
//
// Live progress indicator for `npm run mv:analyze`. Subscribes to the
// sidecar's SSE endpoint GET /api/analyze/status/:stem which streams the
// contents of projects/<stem>/.analyze-status.json at each phase boundary.
//
// Renders 8 stage chips (SETUP / PHASE1-REVIEW / ... / DONE) and
// highlights the current phase. Hides itself when no status file exists
// (no run active) or when the last run ended more than 20s ago.

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

export const StageStrip = () => {
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const stem = stemFromAudioSrc(audioSrc);
  const [status, setStatus] = useState<Status | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    if (!stem) { setStatus(null); return; }
    try {
      const es = new EventSource(`/api/analyze/status/${stem}`);
      es.addEventListener("status", (e: MessageEvent) => {
        try {
          setStatus(e.data === "null" ? null : JSON.parse(e.data));
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

  // Hide when no status OR when the run finished more than 20s ago
  if (!status) return null;
  if (status.endedAt && Date.now() - status.endedAt > 20000) return null;

  const currentIdx = STAGES.indexOf(status.phase);
  const isFailed = status.phase === "failed";

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "4px 16px",
        borderBottom: "1px solid #222",
        background: "#0a0a0a",
        overflowX: "auto",
      }}
    >
      {STAGES.map((s, i) => {
        const active = i === currentIdx;
        const done = i < currentIdx;
        const bg = isFailed && active ? "#c33" : done ? "#2196F3" : active ? "#1e88e5" : "#1a1a1a";
        const border = isFailed && active ? "#c33" : i <= currentIdx ? "#2196F3" : "#333";
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
              background: bg,
              color: "#fff",
              border: "1px solid " + border,
              opacity: active ? 1 : done ? 0.9 : 0.5,
            }}
          >
            {s.toUpperCase()}
            {active && status.stage ? `  ${status.stage.current}/${status.stage.total}` : ""}
          </span>
        );
      })}
    </div>
  );
};
