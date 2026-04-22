import { useEffect, useMemo, useRef, useState } from "react";
import { useShortcuts, useShortcutSurface } from "../contexts/shortcuts";
import { useEditorStore } from "../store";
import type { TimelineElement as TimelineElementType } from "../types";
import { seededPropsForModuleAsset, type AssetKind } from "../utils/assets";
import { ensureAssetRecord } from "../lib/assetRecordStore";
import { stemFromAudioSrc } from "../utils/url";
import { snapTime } from "../utils/time";
import { anchoredZoom, clampViewport } from "../utils/timelineScale";
import { ELEMENT_REGISTRY } from "@compositions/elements/registry";
import { TimelineBeatMarkers } from "./TimelineBeatMarkers";
import { TimelineEventMarkers } from "./TimelineEventMarkers";
import { TimelineElement } from "./TimelineElement";
import { TimelinePlayhead } from "./TimelinePlayhead";
import { TimelineRuler } from "./TimelineRuler";

const TRACK_COUNT = 9;
const TRACK_HEIGHT = 36;
const RULER_HEIGHT = 30;
const GUTTER_WIDTH = 96;
const TOOLBAR_HEIGHT = 31;
// pxPerSec derived from shared store zoom. 0.025 sec/px = 40 px/sec default
// (matches the former fixed scale). Inversely tied to secPerPx so the two
// views stay at the exact same time axis.
const DEFAULT_SEC_PER_PX = 0.025;

// Click-from-AssetLibrary defaults. Must stay in sync with the constants in
// AssetLibrary.tsx — both resolve the same "image vs video → which element
// module wraps it" question, and they must agree or drop-to-timeline and
// click-at-playhead produce different element types for the same asset.
const IMAGE_MODULE_ID_FOR_DROP = "overlay.staticImage";
const GIF_MODULE_ID_FOR_DROP = "overlay.gif";
const VIDEO_MODULE_ID_FOR_DROP = "overlay.speedVideo";

const newIdFromDrop = () => `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const resolveDroppedAsset = (asset: { path: string; kind: AssetKind }) => {
  if (asset.kind === "gif") {
    return {
      moduleId: GIF_MODULE_ID_FOR_DROP,
    };
  }
  if (asset.kind === "image") {
    return {
      moduleId: IMAGE_MODULE_ID_FOR_DROP,
    };
  }
  return {
    moduleId: VIDEO_MODULE_ID_FOR_DROP,
  };
};


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
  const secPerPx = useEditorStore((s) => s.timelineSecPerPx);
  const offsetSec = useEditorStore((s) => s.timelineOffsetSec);
  const setTimelineView = useEditorStore((s) => s.setTimelineView);
  const inPointSec = useEditorStore((state) => state.inPointSec);
  const outPointSec = useEditorStore((state) => state.outPointSec);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const measure = () => setContainerWidth(Math.max(1, el.clientWidth - GUTTER_WIDTH));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const naturalSecPerPx =
    containerWidth > 0 && compositionDuration > 0
      ? compositionDuration / containerWidth
      : DEFAULT_SEC_PER_PX;
  const effectiveSecPerPx = secPerPx > 0 ? secPerPx : naturalSecPerPx;
  const pxPerSec = 1 / effectiveSecPerPx;

  useTimelineDeleteKey();

  const getBarsViewportPx = () =>
    Math.max(1, containerWidth || (scrollRef.current?.clientWidth ?? 1000) - GUTTER_WIDTH);

  const fitToView = () => {
    setTimelineView({
      secPerPx: 0,
      offsetSec: 0,
    });
  };

  const panByFraction = (fraction: number) => {
    const barsPx = getBarsViewportPx();
    const visibleSec = barsPx * effectiveSecPerPx;
    setTimelineView({
      offsetSec: clampViewport({
        offsetSec: offsetSec + visibleSec * fraction,
        secPerPx: effectiveSecPerPx,
        containerPx: barsPx,
        totalSec: compositionDuration,
      }),
    });
  };

  const panByWheelDelta = (rawDelta: number) => {
    const barsPx = getBarsViewportPx();
    setTimelineView({
      offsetSec: clampViewport({
        offsetSec: offsetSec + rawDelta * effectiveSecPerPx,
        secPerPx: effectiveSecPerPx,
        containerPx: barsPx,
        totalSec: compositionDuration,
      }),
    });
  };

  const focusPlayhead = () => {
    const barsPx = getBarsViewportPx();
    const visibleSec = barsPx * effectiveSecPerPx;
    const currentTimeSec = useEditorStore.getState().currentTimeSec;
    setTimelineView({
      offsetSec: clampViewport({
        offsetSec: Math.max(0, currentTimeSec - visibleSec / 2),
        secPerPx: effectiveSecPerPx,
        containerPx: barsPx,
        totalSec: compositionDuration,
      }),
    });
  };

  const zoomByCenter = (zoomFactor: number) => {
    const barsPx = getBarsViewportPx();
    const { secPerPx: nextSecPerPx, offsetSec: nextOffset } = anchoredZoom({
      currentSecPerPx: effectiveSecPerPx,
      currentOffsetSec: offsetSec,
      zoomFactor,
      anchorPx: barsPx / 2,
      minSecPerPx: 0.001,
      maxSecPerPx: naturalSecPerPx,
    });
    setTimelineView({
      secPerPx: nextSecPerPx,
      offsetSec: clampViewport({
        offsetSec: nextOffset,
        secPerPx: nextSecPerPx,
        containerPx: barsPx,
        totalSec: compositionDuration,
      }),
    });
  };

  // Keyboard zoom bindings — active only while the pointer is over the
  // Timeline surface (pushed via useShortcutSurface on the root div).
  const timelineShortcuts = useMemo(
    () => [
      { pattern: "=", handler: () => zoomByCenter(1.25) },
      { pattern: "+", handler: () => zoomByCenter(1.25) },
      { pattern: "-", handler: () => zoomByCenter(1 / 1.25) },
      { pattern: "0", handler: () => fitToView() },
    ],
    // zoomByCenter reads from the store each call; bindings themselves
    // don't need to re-register when zoom/offset change.
    [compositionDuration, effectiveSecPerPx, offsetSec, setTimelineView],
  );
  useShortcuts("timeline", timelineShortcuts);
  const surfaceHandlers = useShortcutSurface("timeline");

  const barsViewportPx = getBarsViewportPx();
  const widthPx = compositionDuration * pxPerSec;
  const panPx = offsetSec * pxPerSec;
  const tracksHeight = TRACK_COUNT * TRACK_HEIGHT;

  // Explicit toolbar buttons. Timeline navigation should remain usable even
  // while playback runs; we intentionally do NOT auto-follow the playhead.
  // Use the target button below to jump the viewport back to the live head.
  const tbBtn: React.CSSProperties = {
    padding: "3px 8px",
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 3,
    color: "#ddd",
    fontSize: 10,
    cursor: "pointer",
    fontFamily: "monospace",
    minWidth: 36,
  };

  return (
    <div
      ref={scrollRef}
      className="timeline-scroll"
      style={{ height: "100%", overflowX: "hidden", overflowY: "auto", background: "#0a0a0a" }}
      onWheelCapture={(e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        // Only three regions are allowed to consume wheel input:
        //   gutter -> vertical editor scroll
        //   ruler  -> horizontal pan
        //   bars   -> zoom / horizontal pan
        // Everything else inside the timeline shell should ignore wheel
        // input so the sticky toolbar / corner cannot accidentally move
        // the editor.
        const withinGutter = !!target.closest?.('[data-timeline-scroll-gutter="true"]');
        const withinBars = !!target.closest?.('[data-timeline-bars="true"]');
        const withinRuler = !!target.closest?.('[data-timeline-ruler-nav="true"]');
        if (withinGutter || withinBars || withinRuler) return;
        e.preventDefault();
      }}
      onPointerEnter={surfaceHandlers.onPointerEnter}
      onPointerLeave={surfaceHandlers.onPointerLeave}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          left: 0,
          zIndex: 5,
          display: "flex",
          gap: 4,
          padding: "4px 8px",
          background: "#101010",
          borderBottom: "1px solid #222",
          fontFamily: "monospace",
          fontSize: 10,
          color: "#aaa",
        }}
      >
        <button
          type="button"
          onClick={() => setTimelineView({ offsetSec: 0 })}
          title="Pan view to 0:00"
          style={tbBtn}
        >
          ⏮ START
        </button>
        <button
          type="button"
          onClick={() => zoomByCenter(1 / 1.5)}
          title="Zoom out (−)"
          style={tbBtn}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => panByFraction(-0.8)}
          title="Pan left"
          style={tbBtn}
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => focusPlayhead()}
          title="Center the viewport on the playhead"
          style={tbBtn}
        >
          ◎
        </button>
        <button
          type="button"
          onClick={() => fitToView()}
          title="Fit whole composition in view (0)"
          style={tbBtn}
        >
          ⊡ FIT
        </button>
        <button
          type="button"
          onClick={() => panByFraction(0.8)}
          title="Pan right"
          style={tbBtn}
        >
          →
        </button>
        <button
          type="button"
          onClick={() => zoomByCenter(1.5)}
          title="Zoom in (+)"
          style={tbBtn}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            const scroller = scrollRef.current;
            const barsPx = Math.max(1, (scroller?.clientWidth ?? 1000) - GUTTER_WIDTH);
            const viewSec = barsPx * effectiveSecPerPx;
            setTimelineView({ offsetSec: Math.max(0, compositionDuration - viewSec) });
          }}
          title="Pan view to end"
          style={tbBtn}
        >
          END ⏭
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ alignSelf: "center" }}>
          offset {offsetSec.toFixed(1)}s · {pxPerSec.toFixed(0)} px/s
        </span>
      </div>
      <div style={{ position: "relative", width: GUTTER_WIDTH + widthPx, minHeight: "100%" }}>
        {/* Ruler row — sticky left corner + scrolling ticks */}
        <div
          style={{
            display: "flex",
            height: RULER_HEIGHT,
            position: "sticky",
            top: TOOLBAR_HEIGHT,
            zIndex: 3,
          }}
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
          <div
            // The visible ruler viewport owns navigation input. The drawn
            // ticks are translated inside it, but click/wheel hit-testing
            // is done against the viewport itself so hover works wherever
            // the user is actually pointing on the strip.
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const viewportPx = Math.max(0, Math.min(barsViewportPx, e.clientX - rect.left));
              const clickTimeSec = Math.max(
                0,
                Math.min(compositionDuration, offsetSec + viewportPx * effectiveSecPerPx),
              );
              const visibleSec = barsViewportPx * effectiveSecPerPx;
              setTimelineView({
                offsetSec: clampViewport({
                  offsetSec: Math.max(0, clickTimeSec - visibleSec / 2),
                  secPerPx: effectiveSecPerPx,
                  containerPx: barsViewportPx,
                  totalSec: compositionDuration,
                }),
              });
            }}
            onWheel={(e) => {
              // The ruler is a navigation strip, not a zoom strip.
              // Any wheel movement here pans left/right through time.
              e.preventDefault();
              e.stopPropagation();
              const rawDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
              panByWheelDelta(rawDelta);
            }}
            title="Click to pan the timeline to this area — playhead stays where it is"
            data-timeline-ruler-nav="true"
            style={{
              position: "relative",
              width: barsViewportPx,
              height: RULER_HEIGHT,
              overflow: "hidden",
              cursor: "crosshair",
            }}
          >
            <div
              style={{
                position: "relative",
                width: widthPx,
                height: RULER_HEIGHT,
                transform: `translateX(${-panPx}px)`,
                transformOrigin: "0 0",
              }}
            >
              <TimelineRuler
                compositionDuration={compositionDuration}
                pxPerSec={pxPerSec}
                beatData={beatData}
                height={RULER_HEIGHT}
              />
            </div>
          </div>
        </div>

        {/* Track rows — beat markers + playhead layered on top of the bar lanes */}
        <div style={{ display: "flex", position: "relative" }}>
          {/* Left column placeholder (keeps bar lanes aligned with ruler) */}
          <div
            onWheel={(e) => {
              // Vertical editor scrolling is only allowed from the label gutter.
              const scroller = scrollRef.current;
              if (!scroller) return;
              e.preventDefault();
              e.stopPropagation();
              scroller.scrollTop += e.deltaY;
            }}
            data-timeline-scroll-gutter="true"
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
          <div
            data-timeline-bars="true"
            onPointerDown={(e) => {
              // Click-to-seek on the timeline. Fires on any empty spot —
              // container, track row, beat markers, etc. Bails only when
              // the click started INSIDE an element (data-timeline-element)
              // so drag/select still works. Previously the handler bailed
              // on ANY child (via e.target !== e.currentTarget) which
              // meant clicking on a track row never seeked — user complaint.
              if (e.button !== 0) return;
              const target = e.target as HTMLElement;
              if (target.closest?.('[data-timeline-element="true"]')) return;
              const rect = e.currentTarget.getBoundingClientRect();
              // rect.left is post-CSS-transform. Children are absolutely
              // positioned at left=startSec*pxPerSec with no nested
              // transform — so (e.clientX - rect.left) is already data-x.
              // Adding panPx was a double-count that made click-to-seek
              // land `offsetSec` seconds past the cursor whenever the
              // view was panned.
              const dataPx = e.clientX - rect.left;
              const rawSec = Math.max(0, Math.min(compositionDuration, dataPx * effectiveSecPerPx));
              const state = useEditorStore.getState();
              // Snap to beat grid by default — matches drag/resize behavior.
              // Shift-click bypasses snap for precise placement.
              const snappedSec = snapTime(rawSec, state.snapMode, state.beatData, e.shiftKey);
              state.setCurrentTime(snappedSec);
              state.selectElement(null);
            }}
            onDragOver={(e) => {
              // Accept only asset drags from AssetLibrary; native file
              // drops land on the AssetLibrary panel's dropzone instead.
              if (!e.dataTransfer.types.includes("application/x-mv-asset")) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={async (e) => {
              const payload = e.dataTransfer.getData("application/x-mv-asset");
              if (!payload) return;
              e.preventDefault();
              let asset: { path: string; kind: AssetKind };
              try { asset = JSON.parse(payload); }
              catch { return; }

              const rect = e.currentTarget.getBoundingClientRect();
              // rect.left is post-CSS-transform; the children inside the
              // bars container have no nested transform. So e.clientX -
              // rect.left is already data-space. The previous +panPx was
              // a double-count that landed drops offsetSec seconds past
              // where the user dropped when the timeline was panned.
              const dataPx = e.clientX - rect.left;
              const rawSec = Math.max(0, Math.min(compositionDuration, dataPx * effectiveSecPerPx));

              // Track row. clientY - rect.top is already in the
              // container's local space (tracks start at top=0).
              const dropTrack = Math.floor((e.clientY - rect.top) / TRACK_HEIGHT);
              if (dropTrack < 0 || dropTrack >= TRACK_COUNT) return;

              // Respect the user's snap setting — matches the drag/resize
              // behavior. shiftKey inverts as elsewhere.
              const state = useEditorStore.getState();
              const snappedSec = snapTime(rawSec, state.snapMode, state.beatData, e.shiftKey);

              const insertion = resolveDroppedAsset(asset);
              const modId = insertion.moduleId;
              const mod = ELEMENT_REGISTRY[modId];
              if (!mod) return;

              const newEl: TimelineElementType = {
                id: newIdFromDrop(),
                label: `${mod.label}: ${asset.path.split("/").pop() ?? asset.path}`,
                type: mod.id,
                trackIndex: dropTrack,
                startSec: snappedSec,
                durationSec: mod.defaultDurationSec,
                props: seededPropsForModuleAsset(mod, asset.kind, asset.path),
              };
              state.addElement(newEl);
              state.selectElement(newEl.id);

              const stem = stemFromAudioSrc(useEditorStore.getState().audioSrc);
              if (!stem) return;

              void ensureAssetRecord(stem, {
                path: asset.path,
                kind: asset.kind,
              })
                .then((record) => {
                  const latest = useEditorStore.getState().elements.find((element) => element.id === newEl.id);
                  if (!latest) return;
                  const nextProps = seededPropsForModuleAsset(mod, asset.kind, record.id);
                  useEditorStore.getState().updateElement(newEl.id, { props: nextProps });
                })
                .catch(() => {
                  // Keep the immediate path-based insert if record creation fails.
                });
            }}
            onWheel={(e) => {
              // Timeline interaction model:
              //   vertical wheel           → zoom at cursor, keeping the
              //                              hovered time locked under the pointer
              //   Shift+wheel / horizontal → pan left/right
              e.preventDefault();
              e.stopPropagation();
              const barsPx = getBarsViewportPx();
              const isExplicitPan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
              if (isExplicitPan) {
                const rawDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
                setTimelineView({
                  offsetSec: clampViewport({
                    offsetSec: offsetSec + rawDelta * effectiveSecPerPx,
                    secPerPx: effectiveSecPerPx,
                    containerPx: barsPx,
                    totalSec: compositionDuration,
                  }),
                });
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              const anchorPx = Math.max(
                0,
                Math.min(barsPx, e.clientX - rect.left - panPx),
              );
              const zoomFactor = 1.1 ** (-e.deltaY / 100);
              const { secPerPx: nextSecPerPx, offsetSec: nextOffset } = anchoredZoom({
                currentSecPerPx: effectiveSecPerPx,
                currentOffsetSec: offsetSec,
                zoomFactor,
                anchorPx,
                minSecPerPx: 0.001,
                maxSecPerPx: naturalSecPerPx,
              });
              setTimelineView({
                secPerPx: nextSecPerPx,
                offsetSec: clampViewport({
                  offsetSec: nextOffset,
                  secPerPx: nextSecPerPx,
                  containerPx: barsPx,
                  totalSec: compositionDuration,
                }),
              });
            }}
            style={{ position: "relative", width: widthPx, height: tracksHeight, transform: `translateX(${-panPx}px)`, transformOrigin: "0 0" }}
          >
            <TimelineBeatMarkers beatData={beatData} pxPerSec={pxPerSec} height={tracksHeight} />
            <TimelineEventMarkers pxPerSec={pxPerSec} height={tracksHeight} />
            {inPointSec !== null && outPointSec !== null && (
              <div style={{position:"absolute",left:inPointSec*pxPerSec,top:0,width:Math.max(2,(outPointSec-inPointSec)*pxPerSec),height:tracksHeight,background:"rgba(59,130,246,0.08)",borderLeft:"2px solid #3b82f6",borderRight:"2px solid #3b82f6",pointerEvents:"none",zIndex:3}} title={`IN ${inPointSec.toFixed(2)}s → OUT ${outPointSec.toFixed(2)}s · range ${(outPointSec-inPointSec).toFixed(2)}s`} />
            )}
            {inPointSec !== null && outPointSec === null && (
              <div style={{position:"absolute",left:inPointSec*pxPerSec-1,top:0,width:2,height:tracksHeight,background:"#3b82f6",pointerEvents:"none",zIndex:3}} title={`IN ${inPointSec.toFixed(2)}s (set OUT with ])`} />
            )}
            {outPointSec !== null && inPointSec === null && (
              <div style={{position:"absolute",left:outPointSec*pxPerSec-1,top:0,width:2,height:tracksHeight,background:"#3b82f6",pointerEvents:"none",zIndex:3}} title={`OUT ${outPointSec.toFixed(2)}s (set IN with [)`} />
            )}
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
                    <TimelineElementHost key={el.id} el={el} height={TRACK_HEIGHT} pxPerSec={pxPerSec} />
                  ))}
              </div>
            ))}
            <TimelinePlayhead pxPerSec={pxPerSec} height={tracksHeight} />
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

const TimelineElementHost = ({ el, height, pxPerSec }: { el: TimelineElementType; height: number; pxPerSec: number }) => {
  const locked = !!el.locked;
  const leftPx = el.startSec * pxPerSec;
  const widthPx = Math.max(16, el.durationSec * pxPerSec);
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
      <TimelineElement element={el} pxPerSec={pxPerSec} height={height} />
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
