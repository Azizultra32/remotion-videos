// editor/src/components/StageStrip.tsx
//
// Persistent analysis panel. Always visible when a track is loaded.
//
// Three display modes, derived from two sources of truth:
//
//   1. beatData (from analysis.json via useBeatData) - the authoritative
//      "what events are confirmed right now" for Phase 1 + Phase 2.
//   2. status    (from .analyze-status.json via SSE) - live phase progress
//      when a run is in flight.
//
// Modes:
//   - IDLE + NOTHING RUN: [PHASE 1 -] [PHASE 2 -] Re-analyze (Clear dimmed)
//   - IDLE + PHASE 1 DONE: [PHASE 1 done N events] [PHASE 2 -] Re-analyze, Clear
//   - IDLE + PHASE 2 DONE: [PHASE 1 done N] [PHASE 2 done M events] Re-analyze, Clear
//   - RUNNING:             live stage chips (SETUP → … → DONE) + Running… button

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

// Reconnect EventSource with exponential backoff if browser gives up.
// EventSource auto-reconnects on normal drops, but after enough failures
// it transitions to CLOSED permanently - we need explicit recovery.
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

const btnStyle = (variant: "primary" | "danger" | "ghost", disabled: boolean): React.CSSProperties => ({
  padding: "3px 10px",
  fontSize: 10,
  fontFamily: "monospace",
  background:
    disabled ? "#222" :
    variant === "primary" ? "#2196F3" :
    variant === "danger" ? "#8a2a2a" : "#1a1a1a",
  border: "1px solid " + (
    disabled ? "#333" :
    variant === "primary" ? "#2196F3" :
    variant === "danger" ? "#b44" : "#333"
  ),
  borderRadius: 3,
  color: disabled ? "#666" : "#fff",
  cursor: disabled ? "not-allowed" : "pointer",
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  opacity: disabled ? 0.6 : 1,
});

const phaseBadge = (done: boolean, active: boolean): React.CSSProperties => ({
  padding: "3px 8px",
  fontSize: 10,
  fontFamily: "monospace",
  borderRadius: 3,
  letterSpacing: "0.06em",
  whiteSpace: "nowrap" as const,
  background: active ? "#1e88e5" : done ? "#103a5c" : "#1a1a1a",
  color: done || active ? "#fff" : "#666",
  border: "1px solid " + (active ? "#64b5f6" : done ? "#2196F3" : "#333"),
});

export const StageStrip = () => {
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const stem = stemFromAudioSrc(audioSrc);
  const beatData = useEditorStore((s) => s.beatData);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"run" | "clear" | "seed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<{ attempt: number; timer: number | null }>({ attempt: 0, timer: null });
  // Local "I just clicked Run" flag. Flips true immediately on Re-analyze
  // click; cleared on the first SSE status frame OR on a 60s timeout
  // (stale SSE catches itself). Gives the user immediate visual feedback
  // even when the sidecar hasn't written the first status frame yet.
  const [kicking, setKicking] = useState(false);
  // now() ticker — re-renders once per second so the "started X seconds ago"
  // + watchdog comparisons update without a status frame arriving.
  const [nowMs, setNowMs] = useState<number>(Date.now());

  useEffect(() => {
    setStatus(null);
    setError(null);
    retryRef.current = { attempt: 0, timer: null };

    const connect = () => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (!stem) return;
      try {
        const es = new EventSource(`/api/analyze/status/${stem}`);
        es.addEventListener("status", (e: MessageEvent) => {
          try {
            const parsed = e.data === "null" ? null : (JSON.parse(e.data) as Status);
            setStatus(parsed);
            // Any live status frame means the run is real; stop showing
            // the local "starting..." indicator.
            setKicking(false);
            if (parsed && parsed.endedAt) setBusy(null);
            retryRef.current.attempt = 0;
          } catch { /* ignore malformed */ }
        });
        es.addEventListener("error", () => {
          // Browser will attempt its own reconnect. If it transitions to
          // CLOSED permanently we need our own reconnect with backoff.
          if (es.readyState === EventSource.CLOSED) {
            const attempt = retryRef.current.attempt;
            const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
            retryRef.current.attempt = attempt + 1;
            if (retryRef.current.timer !== null) window.clearTimeout(retryRef.current.timer);
            retryRef.current.timer = window.setTimeout(connect, delay);
          }
        });
        esRef.current = es;
      } catch { /* EventSource unsupported */ }
    };
    connect();

    return () => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (retryRef.current.timer !== null) {
        window.clearTimeout(retryRef.current.timer);
        retryRef.current.timer = null;
      }
    };
  }, [stem]);

  // Tick every second so "X seconds ago" + watchdog thresholds update
  // without needing a status frame or user interaction.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Safety net: if kicking stays true for 60s with no SSE frame, force-clear
  // it so the user isn't locked out. At that point we've shown a stale
  // "starting..." for a minute and the watchdog UI takes over.
  useEffect(() => {
    if (!kicking) return;
    const id = window.setTimeout(() => setKicking(false), 60_000);
    return () => window.clearTimeout(id);
  }, [kicking]);

  if (!stem) return null;

  const phase1Count = beatData?.phase1_events_sec?.length ?? 0;
  const phase2Count = beatData?.phase2_events_sec?.length ?? 0;
  const isRunning = !!status && !!status.startedAt && !status.endedAt;
  const isFailed = status?.phase === "failed";
  const currentIdx = status?.phase ? STAGES.indexOf(status.phase) : -1;

  // Which phase band is active right now (for the "active" badge styling).
  const activePhase: "phase1" | "phase2" | null = !isRunning
    ? null
    : status!.phase.startsWith("phase1") ? "phase1"
    : status!.phase.startsWith("phase2") || status!.phase === "done" ? "phase2"
    : null;

  const runAnalysis = async () => {
    if (!stem || isRunning || busy) return;
    setBusy("run");
    setKicking(true);
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
        setKicking(false);
      }
      // Success → busy clears when SSE delivers endedAt; kicking clears
      // on first status frame via the SSE listener above.
    } catch (err) {
      setError(String(err));
      setBusy(null);
      setKicking(false);
    }
  };

  const cancelRun = async () => {
    if (!stem) return;
    try {
      await fetch("/api/analyze/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stem }),
      });
      setKicking(false);
      // Status frame with phase:"cancelled" will arrive via SSE and clear
      // isRunning, but also clear locally so the UI flips instantly even
      // if SSE is dragging.
      setBusy(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const seedBeats = async () => {
    if (!stem || isRunning || busy) return;
    setBusy("seed");
    setError(null);
    try {
      const r = await fetch("/api/analyze/seed-beats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stem }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.error ?? `HTTP ${r.status}`);
        setBusy(null);
        return;
      }
      // The sidecar's SSE watcher on analysis.json will push the updated
      // beats when detect-beats.py finishes (~30-60s). useBeatData picks
      // it up and beats.length > 0 hides this UI. Until then, keep the
      // button disabled.
      setTimeout(() => setBusy((b) => (b === "seed" ? null : b)), 90_000);
    } catch (err) {
      setError(String(err));
      setBusy(null);
    }
  };

  const clearEvents = async () => {
    if (!stem || isRunning) return;
    if (!window.confirm(
      `Clear pipeline events for ${stem}?\nUser-origin elements stay. On-disk analysis artifacts (PNGs) are kept. Re-analyze to regenerate events.`,
    )) return;
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

      {/* Persistent Phase 1 + Phase 2 completion badges. */}
      <span style={phaseBadge(phase1Count > 0, activePhase === "phase1")}>
        Phase 1{phase1Count > 0 ? `  ${phase1Count}` : "  -"}
      </span>
      <span style={phaseBadge(phase2Count > 0, activePhase === "phase2")}>
        Phase 2{phase2Count > 0 ? `  ${phase2Count}` : "  -"}
      </span>

      {/* No-beat-grid chip + Seed button. Appears ONLY when analysis.json
          lacks a beats array (old projects, or a fresh scaffold before
          mv:analyze ran). Snap-to-beat silently no-ops without beats — this
          makes the broken state honest and one-click fixable. */}
      {(beatData?.beats?.length ?? 0) === 0 && (
        <>
          <span
            style={{
              padding: "3px 8px",
              fontSize: 10,
              fontFamily: "monospace",
              background: "#3a2a10",
              color: "#f9c47a",
              border: "1px solid #a87c30",
              borderRadius: 3,
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
            }}
            title="No beat grid for this track. Snap-to-beat silently no-ops until you seed beats. Click SEED BEATS to run detect-beats.py (~30-60s); it does not disturb phase events."
          >
            NO BEAT GRID
          </span>
          <button
            onClick={seedBeats}
            disabled={isRunning || busy !== null}
            title="Run detect-beats.py on this project's audio and merge beats/downbeats/bpm_global into analysis.json. Preserves all other fields. Takes ~30-60s."
            style={btnStyle("ghost", isRunning || busy !== null)}
          >
            {busy === "seed" ? "Seeding…" : "Seed beats"}
          </button>
        </>
      )}

      {/* Live stage chips only while running - gives the per-sub-phase detail
          that the two persistent badges don't surface. */}
      {isRunning && !isFailed && (
        <>
          <span style={{ fontSize: 10, color: "#555" }}>·</span>
          {STAGES.map((s, i) => {
            const active = i === currentIdx;
            const done = i < currentIdx;
            return (
              <span
                key={s}
                style={{
                  padding: "2px 6px",
                  fontSize: 9,
                  fontFamily: "monospace",
                  borderRadius: 2,
                  letterSpacing: "0.05em",
                  whiteSpace: "nowrap",
                  background: done ? "#2196F3" : active ? "#1e88e5" : "transparent",
                  color: done || active ? "#fff" : "#555",
                  border: "1px solid " + (i <= currentIdx ? "#2196F3" : "#2a2a2a"),
                  opacity: active ? 1 : done ? 0.85 : 0.5,
                }}
              >
                {s.toUpperCase()}
                {active && status!.stage ? `  ${status!.stage.current}/${status!.stage.total}` : ""}
              </span>
            );
          })}
        </>
      )}

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

      {/* Kick-off indicator: shown from click until the first SSE frame
          arrives. Gives the user "yes, I heard you" feedback even when
          the sidecar hasn't written .analyze-status.json yet. */}
      {kicking && !status && (
        <span
          style={{
            padding: "3px 8px",
            fontSize: 10,
            fontFamily: "monospace",
            background: "#1e3a5a",
            color: "#9cf",
            border: "1px solid #3a6ca8",
            borderRadius: 3,
            letterSpacing: "0.06em",
            animation: "pulse 1.2s infinite",
          }}
        >
          STARTING...
        </span>
      )}

      {/* Watchdog: no status update in > 60s while run is nominally in-flight.
          Surfaces the "is this actually running?" question to the user and
          encourages Cancel + retry. */}
      {(() => {
        if (!isRunning || !status) return null;
        const staleMs = nowMs - status.updatedAt;
        if (staleMs < 60_000) return null;
        return (
          <span
            style={{
              padding: "3px 8px",
              fontSize: 10,
              fontFamily: "monospace",
              background: "#3a2a10",
              color: "#f9c47a",
              border: "1px solid #a87c30",
              borderRadius: 3,
              letterSpacing: "0.06em",
            }}
            title={`No progress update from the analysis run in ${Math.floor(staleMs / 1000)}s. Either the run genuinely takes a while on this stage, the SSE stream is stuck, or mv:analyze is hung. Use Cancel + retry if you want to kill it.`}
          >
            NO UPDATE {Math.floor(staleMs / 1000)}s
          </span>
        );
      })()}

      {/* Last-run timestamp: when a run has ended (success or cancel), show
          when. Clears the "am I looking at stale UI?" ambiguity. */}
      {status?.endedAt && !isRunning && (
        <span
          style={{ fontSize: 10, color: "#666", fontFamily: "monospace" }}
          title={`Run ${status.phase}. Last status update at ${new Date(status.updatedAt).toLocaleTimeString()}.`}
        >
          {status.phase === "cancelled" ? "CANCELLED" : status.phase === "failed" ? "FAILED" : "DONE"} {new Date(status.endedAt).toLocaleTimeString()}
        </span>
      )}

      {error && (
        <span style={{ fontSize: 10, color: "#f66", fontFamily: "monospace" }}>
          {error}
        </span>
      )}

      <div style={{ flex: 1 }} />

      <button
        onClick={() => {
          if (!stem || isRunning || busy) return;
          const state = useEditorStore.getState();
          const sec = state.currentTimeSec;
          if (!Number.isFinite(sec) || sec < 0) return;
          const current = (beatData?.phase2_events_sec?.length
            ? beatData.phase2_events_sec
            : beatData?.phase1_events_sec) ?? [];
          const next = [...current, sec];
          void fetch("/api/analyze/events/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stem, events: next }),
          }).catch((err) => setError(String(err)));
        }}
        disabled={isRunning || busy !== null}
        title="Drop a new event marker at the current playhead position. The marker persists to analysis.json and appears on the waveform + timeline."
        style={btnStyle("ghost", isRunning || busy !== null)}
      >
        Add event at playhead
      </button>

      {isRunning || busy === "run" || kicking ? (
        <button
          onClick={cancelRun}
          title="Kill the in-flight mv:analyze process group and mark the run cancelled. Artifacts already written are kept."
          style={btnStyle("danger", false)}
        >
          Cancel
        </button>
      ) : (
        <button
          onClick={runAnalysis}
          title="Run npm run mv:analyze in the background. Takes 5-10 min. Live progress streams here."
          style={btnStyle("primary", false)}
        >
          {phase2Count > 0 ? "Re-analyze" : "Analyze"}
        </button>
      )}

      <button
        onClick={clearEvents}
        disabled={busy === "clear" || isRunning || (phase1Count === 0 && phase2Count === 0)}
        title="Remove all pipeline-origin events (Phase 1 + Phase 2) from the timeline. User elements are kept. Does not delete on-disk PNG artifacts."
        style={btnStyle("danger", busy === "clear" || isRunning || (phase1Count === 0 && phase2Count === 0))}
      >
        {busy === "clear" ? "Clearing…" : "Clear events"}
      </button>
    </div>
  );
};
