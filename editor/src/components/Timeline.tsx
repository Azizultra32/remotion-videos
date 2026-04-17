import { useEffect, useRef } from "react";
import type { TimelineElement as TimelineElementType } from "../types";
import { useEditorStore } from "../store";
import { TimelineElement } from "./TimelineElement";
import { TimelineRuler } from "./TimelineRuler";
import { TimelinePlayhead } from "./TimelinePlayhead";
import { TimelineBeatMarkers } from "./TimelineBeatMarkers";

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
    <div ref={scrollRef} className="timeline-scroll" style={{ height: "100%", overflow: "auto", background: "#0a0a0a" }}>
      <div style={{ position: "relative", width: GUTTER_WIDTH + widthPx, minHeight: "100%" }}>
        {/* Ruler row — sticky left corner + scrolling ticks */}
        <div style={{ display: "flex", height: RULER_HEIGHT, position: "sticky", top: 0, zIndex: 3 }}>
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
            {Array.from({ length: TRACK_COUNT }, (_, i) => (
              <div
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

const TimelineElementHost = ({ el, height }: { el: TimelineElementType; height: number }) => (
  <TimelineElement element={el} pxPerSec={PX_PER_SEC} height={height} />
);
