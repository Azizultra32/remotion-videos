import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import type { TimelineElement as TimelineElementType } from "../types";
import { TimelineBeatMarkers } from "./TimelineBeatMarkers";
import { TimelineEventMarkers } from "./TimelineEventMarkers";
import { TimelineElement } from "./TimelineElement";
import { TimelinePlayhead } from "./TimelinePlayhead";
import { TimelineRuler } from "./TimelineRuler";

const TRACK_COUNT = 9;
const TRACK_HEIGHT = 36;
const RULER_HEIGHT = 22;
const GUTTER_WIDTH = 96;
const PX_PER_SEC = 40;

// Labels indexed by trackIndex. Matches each element module's defaultTrack:
// text/bell/glitch/typing/sliding/popping → 0, beatDrop/fitboxSVG → 1,
// spectrumBars/waveformPath → 2, bassGlow → 3, pathReveal/neonStack → 4,
// sonarRings → 5, preDropFadeHold → 6, watermarkMask → 7, videoClip → 8.
const TRACK_LABELS: string[] = [
  "TEXT 1",
  "TEXT 2",
  "AUDIO BG",
  "AUDIO FG",
  "SHAPES 1",
  "SHAPES 2",
  "OVERLAY",
  "MASK",
  "VIDEO",
];

export const Timeline = () => {
  const elements = useEditorStore((s) => s.elements);
  const compositionDuration = useEditorStore((s) => s.compositionDuration);
  const beatData = useEditorStore((s) => s.beatData);
  const scrollRef = useRef<HTMLDivElement>(null);

  useTimelineDeleteKey();

  const widthPx = compositionDuration * PX_PER_SEC;
  const tracksHeight = TRACK_COUNT * TRACK_HEIGHT;

  // Auto-follow the playhead. Subscribe imperatively so we don't re-render
  // the Timeline on every frame — just nudge scrollLeft when the playhead
  // approaches the visible edge. Keeps ~40px of leading gutter visible
  // when scrolled, so the user can still see track labels while scrubbing.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const follow = (sec: number) => {
      const playX = GUTTER_WIDTH + sec * PX_PER_SEC;
      const viewL = scroller.scrollLeft + GUTTER_WIDTH;
      const viewR = scroller.scrollLeft + scroller.clientWidth - 32;
      if (playX < viewL || playX > viewR) {
        scroller.scrollLeft = Math.max(0, playX - scroller.clientWidth / 2);
      }
    };
    follow(useEditorStore.getState().currentTimeSec);
    return useEditorStore.subscribe((state, prev) => {
      if (state.currentTimeSec !== prev.currentTimeSec) follow(state.currentTimeSec);
    });
  }, []);

  return (
    <div
      ref={scrollRef}
      className="timeline-scroll"
      style={{ height: "100%", overflow: "auto", background: "#0a0a0a" }}
    >
      <div style={{ position: "relative", width: GUTTER_WIDTH + widthPx, minHeight: "100%" }}>
        {/* Ruler row — sticky left corner + scrolling ticks */}
        <div
          style={{ display: "flex", height: RULER_HEIGHT, position: "sticky", top: 0, zIndex: 3 }}
        >
          <div
            style={{
              position: "sticky",
              left: 0,
              width: GUTTER_WIDTH,
              minWidth: GUTTER_WIDTH,
              height: RULER_HEIGHT,
              background: "#0a0a0a",
              borderRight: "1px solid #333",
              borderBottom: "1px solid #333",
              zIndex: 4,
            }}
          />
          <TimelineRuler
            compositionDuration={compositionDuration}
            pxPerSec={PX_PER_SEC}
            beatData={beatData}
            height={RULER_HEIGHT}
          />
        </div>

        {/* Track rows — beat markers + playhead layered on top of the bar lanes */}
        <div style={{ display: "flex", position: "relative" }}>
          {/* Left column placeholder (keeps bar lanes aligned with ruler) */}
          <div
            style={{
              position: "sticky",
              left: 0,
              width: GUTTER_WIDTH,
              minWidth: GUTTER_WIDTH,
              background: "#0f0f0f",
              borderRight: "1px solid #333",
              zIndex: 2,
            }}
          >
            {Array.from({ length: TRACK_COUNT }, (_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the index IS the track identity (trackIndex)
                key={i}
                style={{
                  height: TRACK_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 10,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#888",
                  letterSpacing: "0.08em",
                  borderBottom: "1px solid #222",
                  boxSizing: "border-box",
                }}
              >
                {TRACK_LABELS[i] ?? `TRACK ${i + 1}`}
                <span style={{ marginLeft: 6, color: "#444", fontWeight: 400 }}>{i}</span>
              </div>
            ))}
          </div>

          {/* Bar lanes — single relative container for all tracks so
              beat-markers + playhead can span the whole height */}
          <div style={{ position: "relative", width: widthPx, height: tracksHeight }}>
            <TimelineBeatMarkers beatData={beatData} pxPerSec={PX_PER_SEC} height={tracksHeight} />
            <TimelineEventMarkers pxPerSec={PX_PER_SEC} height={tracksHeight} />
            {Array.from({ length: TRACK_COUNT }, (_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the index IS the track identity (trackIndex)
                key={i}
                style={{
                  position: "absolute",
                  top: i * TRACK_HEIGHT,
                  left: 0,
                  width: widthPx,
                  height: TRACK_HEIGHT,
                  borderBottom: "1px solid #1a1a1a",
                  zIndex: 1,
                }}
              >
                {elements
                  .filter((el) => el.trackIndex === i)
                  .map((el) => (
                    <TimelineElementHost key={el.id} el={el} height={TRACK_HEIGHT} />
                  ))}
              </div>
            ))}
            <TimelinePlayhead pxPerSec={PX_PER_SEC} height={tracksHeight} />
          </div>
        </div>
      </div>
    </div>
  );
};

// Locked elements get a visual overlay + delete guard without touching
// TimelineElement.tsx. Rationale: the Task 2 engine-lock allows edits to
// Timeline.tsx only. The wrapper hosts:
//   - opacity dim when locked
//   - dashed #6af border as an absolutely-positioned overlay (pointer-events:none
//     so it doesn't intercept drag/resize from the inner TimelineElement)
//   - a tiny LOCK text badge pinned top-right of the block
const LOCK_BORDER = "1px dashed #6af";

const tryDelete = (id: string) => {
  const state = useEditorStore.getState();
  const el = state.elements.find((e) => e.id === id);
  if (!el) return;
  if (el.locked) {
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `"${el.label}" is locked (pipeline-created). Remove it from the event list too?`,
    );
    if (!ok) return;
  }
  // For pipeline-origin elements, also persist the deletion to the
  // authoritative analysis.json so the next SSE tick doesn't re-add it.
  // The id encodes the stem + event timestamp: "pipeline-<stem>-<sec>".
  if (el.origin === "pipeline") {
    const match = /^pipeline-(.+)-(\d+(?:\.\d+)?)$/.exec(el.id);
    if (match) {
      const stem = match[1];
      const removedSec = Number(match[2]);
      const beat = state.beatData;
      const current =
        (beat?.phase2_events_sec?.length ? beat.phase2_events_sec : beat?.phase1_events_sec) ?? [];
      const next = current.filter((t) => Math.abs(t - removedSec) > 0.05);
      void fetch("/api/analyze/events/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stem, events: next }),
      }).catch(() => {
        /* SSE won't refresh; store-level delete below is still applied */
      });
    }
  }
  state.removeElement(id);
};

// Timeline-scoped keyboard delete: Backspace / Delete on the selected element
// routes through tryDelete so locked elements prompt before removal. Skipped
// when focus is inside an editable field so text inputs (ElementDetail) still
// get their native backspace behavior.
const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
};

const useTimelineDeleteKey = () => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const id = useEditorStore.getState().selectedElementId;
      if (!id) return;
      e.preventDefault();
      tryDelete(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
};

const TimelineElementHost = ({ el, height }: { el: TimelineElementType; height: number }) => {
  const locked = !!el.locked;
  const leftPx = el.startSec * PX_PER_SEC;
  const widthPx = Math.max(16, el.durationSec * PX_PER_SEC);
  return (
    <div
      style={{
        // Wrapper sits at (0,0) so the inner TimelineElement keeps its own
        // absolute positioning math. Only opacity + cursor are applied here;
        // the dashed border comes from the overlay sibling below.
        position: "absolute",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        opacity: locked ? 0.72 : 1,
        cursor: locked ? "default" : "grab",
      }}
    >
      <TimelineElement element={el} pxPerSec={PX_PER_SEC} height={height} />
      {locked && (
        <>
          {/* Dashed border overlay — pointer-events:none so drag/resize on the
              inner element still works if the user later unlocks via
              ElementDetail. Sits atop the bar lane at the same bounds. */}
          <div
            style={{
              position: "absolute",
              left: leftPx,
              top: 0,
              width: widthPx,
              height,
              border: LOCK_BORDER,
              borderRadius: 4,
              boxSizing: "border-box",
              pointerEvents: "none",
              zIndex: 2,
            }}
          />
          {/* LOCK badge — pinned inside the top-right corner of the block. */}
          <span
            style={{
              position: "absolute",
              left: leftPx + Math.max(0, widthPx - 38),
              top: 2,
              fontSize: 9,
              color: "#6af",
              letterSpacing: "0.08em",
              marginLeft: 4,
              padding: "1px 4px",
              border: "1px solid #6af",
              borderRadius: 2,
              background: "rgba(0,0,0,0.35)",
              pointerEvents: "none",
              zIndex: 3,
              fontWeight: 600,
            }}
          >
            LOCK
          </span>
        </>
      )}
    </div>
  );
};
