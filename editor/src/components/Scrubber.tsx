// src/components/Scrubber.tsx
// A click-to-seek waveform with beat/drop/breakdown overlays and a live
// playhead. Replaces the old SpectrumDisplay (bass-bar readout) which
// wasn't actually interactive.
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { useEditorStore } from "../store";

type Props = {
  audioUrl: string;
  height?: number;
};

export const Scrubber = ({ audioUrl, height = 180 }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(0);

  // Granular selectors — only re-render when THESE specific fields change.
  // currentTimeSec is deliberately NOT subscribed as state: it changes 24 Hz
  // during playback, and if the whole component re-rendered on every frame
  // the 130-element SVG overlay + wavesurfer.setTime call would starve the
  // main thread and make Pause feel broken. Same fix Preview got in 83d932b.
  //
  // Instead we subscribe imperatively: a ref-based listener moves the
  // playhead div via `element.style.left` and calls `ws.setTime`, bypassing
  // React reconciliation entirely. React only re-renders when beatData,
  // duration, audioSrc, etc. change — which happens rarely.
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const beatData = useEditorStore((s) => s.beatData);
  const compositionDuration = useEditorStore((s) => s.compositionDuration);
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const playheadRef = useRef<HTMLDivElement>(null);

  const trackName = audioSrc
    ? audioSrc
        .replace(/^.*\//, "")
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]+/g, " ")
    : null;

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#3a3a3a",
      progressColor: "#6aa6ff",
      cursorColor: "transparent", // we draw our own playhead on top
      height,
      barWidth: 2,
      barGap: 1,
      normalize: true,
      interact: true,
    });
    ws.load(audioUrl);
    ws.on("ready", () => {
      setReady(true);
      const d = ws.getDuration();
      setDuration(d);
      // Always defer to the actual decoded audio length. Prevents a stale
      // (persisted or default) value from clamping seeks past its bound.
      if (d) {
        useEditorStore.setState({ compositionDuration: Math.ceil(d) });
      }
      // Kill wavesurfer's playback path entirely. We only want the waveform
      // render — playback is owned by the Remotion Player. Merely muting the
      // element isn't enough: HMR can leak detached audio elements that keep
      // playing after unmount (that's the "mashed noise after closing the
      // tab" symptom). Stripping src + pause is the reliable kill.
      try {
        ws.setVolume(0);
      } catch {}
      try {
        (ws as any).stop?.();
      } catch {}
      const media = ws.getMediaElement?.();
      if (media) {
        media.muted = true;
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
    });
    ws.on("click", (progress: number) => {
      const t = progress * ws.getDuration();
      setCurrentTime(t);
    });
    wsRef.current = ws;
    return () => {
      ws.destroy();
      wsRef.current = null;
      setReady(false);
    };
  }, [audioUrl, height, setCurrentTime]);

  // Do NOT call ws.play()/pause() here. WaveSurfer's internal MediaElement
  // would play its own audio in parallel with the Remotion Player, which
  // either doubles up or (more often) kills both.
  //
  // Imperative playhead + wavesurfer sync: subscribe directly to the store,
  // move the playhead DOM node via inline style, and call ws.setTime. No
  // React re-render per frame. This is the hot path during playback; doing
  // it via useState/useEffect re-renders was the root cause of the pause bug.
  useEffect(() => {
    if (!ready || !duration) return;
    const update = (t: number) => {
      const el = playheadRef.current;
      if (el) {
        const pct = Math.min(100, Math.max(0, (t / duration) * 100));
        el.style.left = `${pct}%`;
      }
      const ws = wsRef.current;
      if (ws && typeof (ws as any).setTime === "function") {
        try {
          (ws as any).setTime(t);
        } catch {
          // wavesurfer can throw after unmount or src removal; harmless.
        }
      }
    };
    // Paint initial position before the first store tick.
    update(useEditorStore.getState().currentTimeSec);
    // Listen for subsequent changes without re-rendering the component.
    return useEditorStore.subscribe((state, prev) => {
      if (state.currentTimeSec !== prev.currentTimeSec) {
        update(state.currentTimeSec);
      }
    });
  }, [ready, duration]);

  // Probe for confirmed-full PNGs produced by the waveform-analysis
  // pipeline. Prefer phase-2 (has all confirmed events merged); fall
  // back to phase-1 (Phase 2 not run yet); null if neither exists.
  // HEAD request is cheap; the sidecar's /api/projects/* handler
  const totalSec = duration || compositionDuration || 1;

  return (
    <div
      style={{
        padding: "6px 16px 8px",
        borderBottom: "1px solid #333",
        background: "#0a0a0a",
        position: "relative",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#888",
          marginBottom: 4,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Waveform{trackName ? ` - ${trackName}` : ""}
        </span>
        <span>
          {(() => {
            if (!beatData) return "loading beats…";
            const parts: string[] = [];
            if (beatData.beats.length > 0) parts.push(`${beatData.beats.length} beats`);
            if (beatData.drops.length > 0) parts.push(`${beatData.drops.length} drops`);
            const p2 = beatData.phase2_events_sec?.length ?? 0;
            const p1 = beatData.phase1_events_sec?.length ?? 0;
            const eventCount = p2 > 0 ? p2 : p1;
            if (eventCount > 0) parts.push(`${eventCount} events`);
            if (beatData.bpm_global > 0) parts.push(`${beatData.bpm_global.toFixed(1)} bpm`);
            return parts.length > 0 ? parts.join(" · ") : "no analysis loaded";
          })()}
        </span>
      </div>

      <div
        style={{ position: "relative", width: "100%", height }}
        onClick={(e) => {
          // Shift-click on waveform adds an event at the click's time.
          // Plain click passes through to wavesurfer for click-to-seek.
          if (!e.shiftKey) return;
          if (!beatData || totalSec <= 0) return;
          const stem = audioSrc ? audioSrc.replace(/^.*\//, "").replace(/\.[^.]+$/, "") : null;
          if (!stem) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const sec = (x / rect.width) * totalSec;
          if (!Number.isFinite(sec) || sec < 0 || sec > totalSec) return;
          const current = (beatData.phase2_events_sec?.length
            ? beatData.phase2_events_sec
            : beatData.phase1_events_sec) ?? [];
          const next = [...current, sec];
          void fetch("/api/analyze/events/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stem, events: next }),
          }).catch(() => {});
          e.stopPropagation();
        }}
      >
        <div ref={containerRef} style={{ width: "100%", height }} />

        {/* Event lines + breakdown regions + drop markers. SVG is
            pointer-events:auto but individual decoration elements are
            set to "none" so only the event-line hit targets intercept
            clicks; plain clicks fall through to wavesurfer. */}
        {ready && beatData && (
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
            preserveAspectRatio="none"
            viewBox={`0 0 ${totalSec} 100`}
          >
            {/* Breakdown regions - purely decorative. */}
            {beatData.breakdowns.map((b, i) => (
              <rect
                key={`bd${i}`}
                x={b.start}
                width={Math.max(0.01, b.end - b.start)}
                y={0}
                height={100}
                fill="rgba(255,80,80,0.08)"
              />
            ))}
            {/* Drop markers - decorative. */}
            {beatData.drops.map((t, i) => (
              <line
                key={`d${i}`}
                x1={t}
                x2={t}
                y1={0}
                y2={100}
                stroke="#ff4444"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                opacity={0.55}
              />
            ))}
            {/* Phase-1 event markers - shown only when phase-2 is empty. */}
            {!beatData.phase2_events_sec?.length &&
              beatData.phase1_events_sec?.map((t, i) => (
                <line
                  key={`ph1-${i}`}
                  x1={t}
                  x2={t}
                  y1={0}
                  y2={100}
                  stroke="#ff8844"
                  strokeWidth={2.5}
                  vectorEffect="non-scaling-stroke"
                  opacity={0.85}
                />
              ))}
            {/* Phase-2 event markers - canonical confirmed events. */}
            {beatData.phase2_events_sec?.map((t, i) => (
              <line
                key={`ph2-${i}`}
                x1={t}
                x2={t}
                y1={0}
                y2={100}
                stroke="#ffcc00"
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}

        {/* Interactive event-line hit targets - rendered as absolutely-
            positioned divs so they can be clicked (SVG sibling above is
            pointer-events:none). Clicking a marker selects the
            corresponding pipeline element in the store, which routes
            Backspace/Delete through Timeline's tryDelete path (which
            now persists the deletion to analysis.json). */}
        {ready && beatData && audioSrc && (() => {
          const events = (beatData.phase2_events_sec?.length
            ? beatData.phase2_events_sec
            : beatData.phase1_events_sec) ?? [];
          const stem = audioSrc.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
          return events.map((t, i) => {
            const left = (t / totalSec) * 100;
            const pipelineId = `pipeline-${stem}-${t.toFixed(3)}`;
            return (
              <div
                key={`hit-${i}`}
                onClick={(e) => {
                  e.stopPropagation();
                  useEditorStore.getState().selectElement(pipelineId);
                  useEditorStore.getState().setCurrentTime(t);
                }}
                title={`Event ${i + 1} at ${t.toFixed(2)}s - click to select, then Delete to remove`}
                style={{
                  position: "absolute",
                  left: `calc(${left}% - 6px)`,
                  top: 0,
                  width: 12,
                  height: "100%",
                  cursor: "pointer",
                  background: "transparent",
                  zIndex: 2,
                }}
              />
            );
          });
        })()}

        {/* Playhead — canonical store time. `left` is set imperatively by
            the subscribe hook above so this component does NOT re-render
            on every frame. */}
        <div
          ref={playheadRef}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "0%",
            width: 2,
            background: "#fff",
            boxShadow: "0 0 4px rgba(255,255,255,0.8)",
            pointerEvents: "none",
            transform: "translateX(-1px)",
            zIndex: 3,
          }}
        />
      </div>

      {/* Fallback transport while wavesurfer is loading */}
      {!ready && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#666",
            fontSize: 11,
            pointerEvents: "none",
          }}
        >
          decoding audio…
        </div>
      )}

    </div>
  );
};
