// src/components/Scrubber.tsx
// A click-to-seek waveform with beat/drop/breakdown overlays and a live
// playhead. Replaces the old SpectrumDisplay (bass-bar readout) which
// wasn't actually interactive.
//
// Waveform rendering is now pure-canvas via CanvasWaveform (no wavesurfer.js)
// per the MC deep-dive §3 lift — AudioContext.decodeAudioData + extractPeaks
// produces the bucket array, a 2D canvas draws it.
import { useEffect, useRef, useState } from "react";
import { useShortcutSurface, useShortcuts } from "../contexts/shortcuts";
import { useStorage } from "../hooks/useStorage";
import { useEditorStore } from "../store";
import { anchoredZoom, clampViewport } from "../utils/timelineScale";
import { CanvasWaveform } from "./CanvasWaveform";
import { NamedEventPills } from "./NamedEventPills";

type Props = {
  audioUrl: string;
  height?: number;
};

export const Scrubber = ({ audioUrl, height = 180 }: Props) => {
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(0);
  // Live-preview state during event-marker drag. Holds the in-flight sec value
  // so the yellow line renders at the drag position (not the stored position)
  // until release, when the POST completes and SSE refreshes beatData. Without
  // this the line stays pinned at the original spot during drag and only jumps
  // on release — feels broken even though it works.
  const [dragState, setDragState] = useState<{ idx: number; sec: number } | null>(null);

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

  // Clear dragState once the beatData events array reflects our drag target.
  // This is the coordination point between "pointer released" and "server
  // confirmed via SSE" — until both, the line renders from dragState so it
  // stays pinned under where the user let go instead of jumping back.
  useEffect(() => {
    if (!dragState) return;
    if (!beatData) return;
    const events = beatData.phase2_events_sec?.length
      ? beatData.phase2_events_sec
      : (beatData.phase1_events_sec ?? []);
    if (events.some((t) => Math.abs(t - dragState.sec) < 0.1)) {
      setDragState(null);
    }
  }, [beatData, dragState]);

  const trackName = audioSrc
    ? audioSrc
        .replace(/^.*\//, "")
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]+/g, " ")
    : null;

  // Waveform decode is owned by CanvasWaveform; onReady fires once the
  // AudioBuffer has been decoded and peaks extracted. We mirror the old
  // "persist decoded duration into the store" trick so seeks never get
  // clamped against a stale compositionDuration.
  const onWaveformReady = (d: number) => {
    setDuration(d);
    setReady(true);
    if (d) {
      useEditorStore.setState({ compositionDuration: Math.ceil(d) });
    }
  };

  // Imperative playhead sync: move the playhead DOM node via inline style
  // as currentTimeSec changes in the store. No React re-render per frame —
  // this is the hot path during playback, and doing it via state caused the
  // visible pause-lag before.
  useEffect(() => {
    if (!ready || !duration) return;
    const update = (t: number) => {
      const el = playheadRef.current;
      if (el) {
        const pct = Math.min(100, Math.max(0, (t / duration) * 100));
        el.style.left = `${pct}%`;
      }
    };
    update(useEditorStore.getState().currentTimeSec);
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

  // Point-anchored zoom + pan state (MC deep-dive §2). Persisted per-project
  // via useStorage so track-specific zoom survives reloads and project
  // switches. secPerPx = 0 is a sentinel meaning "natural fit" — used on
  // first mount before we know containerWidth.
  const stem = audioSrc ? audioSrc.replace(/^.*\//, "").replace(/\.[^.]+$/, "") : null;
  const [secPerPx, setSecPerPx] = useStorage("scrubber-sec-per-px", 0, stem ?? undefined);
  const [offsetSec, setOffsetSec] = useStorage("scrubber-offset-sec", 0, stem ?? undefined);

  const scrollPortRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!scrollPortRef.current) return;
    const el = scrollPortRef.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const naturalSecPerPx = containerWidth > 0 && totalSec > 0 ? totalSec / containerWidth : 0;
  const effectiveSecPerPx = secPerPx > 0 ? secPerPx : naturalSecPerPx;
  const innerWidthPx = effectiveSecPerPx > 0 ? totalSec / effectiveSecPerPx : 0;
  const panPx = effectiveSecPerPx > 0 ? offsetSec / effectiveSecPerPx : 0;

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!effectiveSecPerPx || !containerWidth) return;
    e.preventDefault();
    if (e.shiftKey || e.deltaX !== 0) {
      // Pan: shift-wheel or trackpad horizontal scroll
      const deltaSec = (e.deltaX !== 0 ? e.deltaX : e.deltaY) * effectiveSecPerPx;
      const next = clampViewport({
        offsetSec: offsetSec + deltaSec,
        secPerPx: effectiveSecPerPx,
        containerPx: containerWidth,
        totalSec,
      });
      setOffsetSec(next);
      return;
    }
    // Zoom anchored at cursor
    const rect = scrollPortRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cursorPxInView = Math.max(0, Math.min(containerWidth, e.clientX - rect.left));
    // deltaY < 0 = zoom IN (factor > 1); deltaY > 0 = zoom OUT
    const zoomFactor = 1.1 ** (-e.deltaY / 100);
    const maxSecPerPx = naturalSecPerPx || effectiveSecPerPx; // cap zoom-out at fit-to-view
    const minSecPerPx = (naturalSecPerPx || effectiveSecPerPx) / 100; // cap zoom-in at 100x
    const { secPerPx: nextSecPerPx, offsetSec: nextOffset } = anchoredZoom({
      currentSecPerPx: effectiveSecPerPx,
      currentOffsetSec: offsetSec,
      zoomFactor,
      anchorPx: cursorPxInView,
      minSecPerPx,
      maxSecPerPx,
    });
    setSecPerPx(nextSecPerPx);
    setOffsetSec(
      clampViewport({
        offsetSec: nextOffset,
        secPerPx: nextSecPerPx,
        containerPx: containerWidth,
        totalSec,
      }),
    );
  };

  // Center-anchored zoom (for keyboard shortcuts). Same math as handleWheel
  // but anchor = containerWidth/2 instead of the mouse position.
  const zoomBy = (zoomFactor: number) => {
    if (!effectiveSecPerPx || !containerWidth) return;
    const maxSecPerPx = naturalSecPerPx || effectiveSecPerPx;
    const minSecPerPx = (naturalSecPerPx || effectiveSecPerPx) / 100;
    const { secPerPx: nextSecPerPx, offsetSec: nextOffset } = anchoredZoom({
      currentSecPerPx: effectiveSecPerPx,
      currentOffsetSec: offsetSec,
      zoomFactor,
      anchorPx: containerWidth / 2,
      minSecPerPx,
      maxSecPerPx,
    });
    setSecPerPx(nextSecPerPx);
    setOffsetSec(
      clampViewport({
        offsetSec: nextOffset,
        secPerPx: nextSecPerPx,
        containerPx: containerWidth,
        totalSec,
      }),
    );
  };

  // Per-surface shortcuts: +/- zoom, 0 resets. Only fire when the pointer
  // is over the Scrubber (see scrollPortRef's pointer handlers below).
  const surfaceHandlers = useShortcutSurface("scrubber");
  useShortcuts("scrubber", [
    { pattern: "=", handler: () => zoomBy(1.2) }, // "+" without shift
    { pattern: "+", handler: () => zoomBy(1.2) },
    { pattern: "-", handler: () => zoomBy(1 / 1.2) },
    {
      pattern: "0",
      handler: () => {
        setSecPerPx(0);
        setOffsetSec(0);
      },
    },
  ]);

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
          {naturalSecPerPx > 0 &&
            effectiveSecPerPx > 0 &&
            effectiveSecPerPx < naturalSecPerPx * 0.98 && (
              <button
                type="button"
                onClick={() => {
                  setSecPerPx(0);
                  setOffsetSec(0);
                }}
                title="Reset waveform zoom to fit"
                style={{
                  marginLeft: 10,
                  padding: "1px 6px",
                  fontSize: 9,
                  background: "#1a2a3a",
                  border: "1px solid #368",
                  borderRadius: 3,
                  color: "#8cf",
                  cursor: "pointer",
                  textTransform: "none",
                }}
              >
                {(naturalSecPerPx / effectiveSecPerPx).toFixed(1)}× · reset
              </button>
            )}
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
        ref={scrollPortRef}
        onWheel={handleWheel}
        onPointerEnter={surfaceHandlers.onPointerEnter}
        onPointerLeave={surfaceHandlers.onPointerLeave}
        style={{
          position: "relative",
          width: "100%",
          height,
          overflow: "hidden",
        }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven editor canvas; keyboard UI is separate */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-driven editor canvas; keyboard UI is separate */}
        <div
          style={{
            position: "relative",
            width: innerWidthPx > 0 ? `${innerWidthPx}px` : "100%",
            height,
            transform: `translateX(${-panPx}px)`,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
          onClick={(e) => {
            // Shift-click on waveform adds an event at the click's time.
            // Plain click falls through to CanvasWaveform's own seek handler.
            if (!e.shiftKey) {
              // Plain click -> seek. CanvasWaveform doesn't own clicks (we do),
              // so map x to time here. currentTarget is the inner timeline div,
              // so its rect reflects the zoomed/panned width and click math
              // works at any zoom level.
              if (totalSec > 0) {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const sec = Math.max(0, Math.min(totalSec, (x / rect.width) * totalSec));
                setCurrentTime(sec);
              }
              return;
            }
            if (!beatData || totalSec <= 0) return;
            if (!stem) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const sec = (x / rect.width) * totalSec;
            if (!Number.isFinite(sec) || sec < 0 || sec > totalSec) return;
            const current =
              (beatData.phase2_events_sec?.length
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
          <CanvasWaveform audioUrl={audioUrl} height={height} onReady={onWaveformReady} />

          {/* Event lines + breakdown regions + drop markers. SVG is
            pointer-events:auto but individual decoration elements are
            set to "none" so only the event-line hit targets intercept
            clicks; plain clicks fall through to wavesurfer. */}
          {ready && beatData && (
            <svg
              role="img"
              aria-label="Audio scrubber overlay"
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
              {beatData.breakdowns.map((b) => (
                <rect
                  key={`bd${b.start}`}
                  x={b.start}
                  width={Math.max(0.01, b.end - b.start)}
                  y={0}
                  height={100}
                  fill="rgba(255,80,80,0.08)"
                />
              ))}
              {/* Drop markers - decorative. */}
              {beatData.drops.map((t) => (
                <line
                  key={`d${t}`}
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
                beatData.phase1_events_sec?.map((t, i) => {
                  const x = dragState?.idx === i ? dragState.sec : t;
                  return (
                    <line
                      // biome-ignore lint/suspicious/noArrayIndexKey: index identifies the event during drag (dragState.idx === i)
                      key={`ph1-${i}`}
                      x1={x}
                      x2={x}
                      y1={0}
                      y2={100}
                      stroke={dragState?.idx === i ? "#ffb488" : "#ff8844"}
                      strokeWidth={dragState?.idx === i ? 3.5 : 2.5}
                      vectorEffect="non-scaling-stroke"
                      opacity={0.85}
                    />
                  );
                })}
              {/* Phase-2 event markers - canonical confirmed events. */}
              {beatData.phase2_events_sec?.map((t, i) => {
                const x = dragState?.idx === i ? dragState.sec : t;
                return (
                  <line
                    // biome-ignore lint/suspicious/noArrayIndexKey: index identifies the event during drag (dragState.idx === i)
                    key={`ph2-${i}`}
                    x1={x}
                    x2={x}
                    y1={0}
                    y2={100}
                    stroke={dragState?.idx === i ? "#ffe066" : "#ffcc00"}
                    strokeWidth={dragState?.idx === i ? 4 : 3}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
          )}

          {/* Interactive event-line hit targets - rendered as absolutely-
            positioned divs so they can be clicked (SVG sibling above is
            pointer-events:none). Clicking a marker selects the
            corresponding pipeline element in the store, which routes
            Backspace/Delete through Timeline's tryDelete path (which
            now persists the deletion to analysis.json). */}
          {ready &&
            beatData &&
            audioSrc &&
            (() => {
              const events =
                (beatData.phase2_events_sec?.length
                  ? beatData.phase2_events_sec
                  : beatData.phase1_events_sec) ?? [];
              const stem = audioSrc.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
              return events.map((t, i) => {
                const left = (t / totalSec) * 100;
                const pipelineId = `pipeline-${stem}-${t.toFixed(3)}`;
                const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
                  e.stopPropagation();
                  e.preventDefault();
                  // Select + seek on click. Drag commits on up if moved.
                  useEditorStore.getState().selectElement(pipelineId);
                  useEditorStore.getState().setCurrentTime(t);
                  const target = e.currentTarget;
                  const parent = target.parentElement;
                  if (!parent) return;
                  const rect = parent.getBoundingClientRect();
                  const startX = e.clientX;
                  const startSec = t;
                  let dragged = false;
                  let newSec = t;
                  const onMove = (ev: PointerEvent) => {
                    const dx = ev.clientX - startX;
                    if (Math.abs(dx) > 2) dragged = true;
                    if (!dragged) return;
                    newSec = Math.max(
                      0,
                      Math.min(totalSec, startSec + (dx / rect.width) * totalSec),
                    );
                    // Live preview for the WAVEFORM LINE — rendered from dragState
                    // instead of the stored event array until release.
                    setDragState({ idx: i, sec: newSec });
                    // Also move the corresponding pipeline element so the timeline
                    // block tracks the drag in sync with the line.
                    const eid = pipelineId;
                    const els = useEditorStore.getState().elements;
                    const el = els.find((x) => x.id === eid);
                    if (el) {
                      useEditorStore.getState().updateElement(eid, {
                        startSec: Math.max(0, newSec - el.durationSec / 2),
                      });
                    }
                  };
                  const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                    // Abort paths: no-drag or sub-threshold drag -> revert preview.
                    if (!dragged) {
                      setDragState(null);
                      return;
                    }
                    if (Math.abs(newSec - startSec) < 0.05) {
                      setDragState(null);
                      return;
                    }
                    // Commit path: DO NOT clear dragState here. A setDragState(null)
                    // at this point would render the line from beatData's STALE
                    // array for the ~100-500ms until SSE delivers the updated
                    // analysis.json, which is the visible snap-back-then-forward.
                    // Instead we leave dragState pinned at newSec; the useEffect
                    // watching beatData clears it once the array reflects our
                    // target (within 0.1s). POST failure rolls back below.
                    setDragState({ idx: i, sec: newSec });
                    const events =
                      (beatData.phase2_events_sec?.length
                        ? beatData.phase2_events_sec
                        : beatData.phase1_events_sec) ?? [];
                    const next = events.filter((x) => Math.abs(x - startSec) > 0.05).concat(newSec);
                    void fetch("/api/analyze/events/update", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ stem, events: next }),
                    })
                      .then((r) => {
                        if (!r.ok) setDragState(null);
                      })
                      .catch(() => setDragState(null));
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp);
                };
                const isDragging = dragState?.idx === i;
                const previewLeft = isDragging ? (dragState.sec / totalSec) * 100 : left;
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: index identifies the event during drag (dragState.idx === i)
                    key={`hit-${i}`}
                    onPointerDown={onPointerDown}
                    title={`Event ${i + 1} at ${t.toFixed(2)}s — drag to move (shift disables beat-snap), click to select, Delete key to remove`}
                    style={{
                      position: "absolute",
                      left: `calc(${previewLeft}% - 8px)`,
                      top: 0,
                      width: 16,
                      height: "100%",
                      cursor: "ew-resize",
                      background: "transparent",
                      zIndex: 2,
                      touchAction: "none",
                    }}
                  >
                    {/* Visible grab handle: downward triangle at the top of each
                    event line, so drag is discoverable without hovering to
                    test the cursor. Amber when mid-drag. */}
                    <div
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: -2,
                        transform: "translateX(-50%)",
                        width: 0,
                        height: 0,
                        borderLeft: "6px solid transparent",
                        borderRight: "6px solid transparent",
                        borderTop: `10px solid ${isDragging ? "#ffe066" : "#ffcc00"}`,
                        pointerEvents: "none",
                      }}
                    />
                  </div>
                );
              });
            })()}

          {/* Named time-event pills (§1b). Cyan, overlaid above amber pipeline
            markers, drag to move / click to seek. Events come from the store
            (fed by useEventsSync from projects/<stem>/events.json). */}
          {ready && <NamedEventPills totalSec={totalSec} />}

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
      </div>

      {/* Fallback overlay while audio is decoding */}
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
