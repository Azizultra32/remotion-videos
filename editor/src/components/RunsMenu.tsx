// editor/src/components/RunsMenu.tsx
//
// Small dropdown showing the last N snapshots of analysis.json for the
// current project. Clicking one calls POST /api/analyze/runs/<stem>/restore
// which swaps that snapshot back in as the authoritative analysis.json.
// The restore itself snapshots the current state first, so it's reversible.
//
// Mounted inside StageStrip next to Clear / Re-analyze. Hidden when there
// are zero runs (i.e. fresh project, never re-analyzed).

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { stemFromAudioSrc } from "../utils/url";

type RunEntry = { id: string; timestamp: string; events: number };

// Format the ISO-ish timestamp back into something humanlike.
// Input: "2026-04-19T20-13-23-123Z"
// Output: "Apr 19 · 20:13"
const fmtRunId = (id: string): string => {
  const iso = id.replace(/-/g, (_m, i) => (i < 10 ? "-" : i < 13 ? "T" : ":"));
  const d = new Date(iso);
  if (isNaN(d.getTime())) return id;
  const mon = d.toLocaleString("en-US", { month: "short" });
  const day = String(d.getDate());
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mon} ${day} · ${hh}:${mm}`;
};

export const RunsMenu = () => {
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const stem = stemFromAudioSrc(audioSrc);
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchRuns = async () => {
    if (!stem) return;
    try {
      const r = await fetch(`/api/analyze/runs/${stem}`);
      if (!r.ok) return;
      const data = (await r.json()) as { runs: RunEntry[] };
      setRuns(data.runs ?? []);
    } catch {
      /* ignore */
    }
  };

  // Refetch when opening or when stem changes.
  useEffect(() => {
    if (open) void fetchRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stem]);

  // Also refetch once on mount so the badge shows the count without needing
  // the dropdown to be opened first.
  useEffect(() => {
    void fetchRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stem]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const restore = async (id: string) => {
    if (!stem) return;
    if (
      !window.confirm(
        `Restore analysis.json to snapshot ${fmtRunId(id)}?\nThe current state will be snapshotted first (reversible).`,
      )
    )
      return;
    setBusy(id);
    setError(null);
    try {
      const r = await fetch(`/api/analyze/runs/${stem}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.error ?? `HTTP ${r.status}`);
      } else {
        await fetchRuns(); // refresh — the restore created a new snapshot
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  if (!stem || runs.length === 0) return null;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Previous analysis snapshots (last 10). Click to pick one to restore."
        style={{
          padding: "3px 10px",
          fontSize: 10,
          fontFamily: "monospace",
          background: "#1a1a1a",
          border: "1px solid #333",
          borderRadius: 3,
          color: "#ddd",
          cursor: "pointer",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        Runs {runs.length}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            background: "#0f0f0f",
            border: "1px solid #333",
            borderRadius: 4,
            minWidth: 240,
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 100,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.6)",
          }}
        >
          <div
            style={{
              padding: "6px 10px",
              fontSize: 10,
              color: "#888",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              borderBottom: "1px solid #222",
            }}
          >
            Previous runs
          </div>
          {runs.map((run) => (
            <button
              key={run.id}
              disabled={busy !== null}
              onClick={() => void restore(run.id)}
              title={`Restore this snapshot (current state will be snapshotted first). ID: ${run.id}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                padding: "6px 10px",
                background: busy === run.id ? "#1e3a5a" : "transparent",
                border: "none",
                borderBottom: "1px solid #1a1a1a",
                color: "#ddd",
                fontSize: 11,
                fontFamily: "monospace",
                cursor: busy !== null ? "not-allowed" : "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                if (busy === null)
                  (e.currentTarget as HTMLButtonElement).style.background = "#1a1a1a";
              }}
              onMouseLeave={(e) => {
                if (busy !== run.id)
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              <span>{fmtRunId(run.id)}</span>
              <span style={{ color: "#6af", fontSize: 10 }}>
                {busy === run.id ? "restoring..." : `${run.events} events`}
              </span>
            </button>
          ))}
          {error && <div style={{ padding: "6px 10px", fontSize: 10, color: "#f66" }}>{error}</div>}
        </div>
      )}
    </div>
  );
};
