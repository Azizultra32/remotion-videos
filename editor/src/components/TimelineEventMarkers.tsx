// editor/src/components/TimelineEventMarkers.tsx
//
// Projects both phase events (yellow, from analysis.json) and named events
// (cyan, from events.json) down onto the Timeline tracks area as vertical
// lines. Complements TimelineBeatMarkers. Click a line to seek.
//
// Addresses the gap that events were only visible on the Scrubber waveform
// (above) but not on the timeline tracks (below) where elements actually
// live. User observation: "events should show up in the actual editor,
// not just where the waveform appears."

import { useEditorStore } from "../store";

type Props = {
  pxPerSec: number;
  height: number;
};

export const TimelineEventMarkers = ({ pxPerSec, height }: Props) => {
  const beatData = useEditorStore((s) => s.beatData);
  const namedEvents = useEditorStore((s) => s.events);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);

  const phase2 = beatData?.phase2_events_sec ?? [];
  const phase1 = (!phase2.length && beatData?.phase1_events_sec) || [];

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}>
      {/* Phase 1 — shown only when phase2 is empty (downgraded-confidence tier). */}
      {phase1.map((t, i) => (
        <div
          key={`tl-ph1-${i}`}
          onClick={() => setCurrentTime(t)}
          title={`Phase 1 event @ ${t.toFixed(2)}s — click to seek`}
          style={{
            position: "absolute",
            left: t * pxPerSec,
            top: 0,
            width: 2,
            height,
            background: "#ff8844",
            opacity: 0.6,
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        />
      ))}

      {/* Phase 2 — canonical confirmed events. */}
      {phase2.map((t, i) => (
        <div
          key={`tl-ph2-${i}`}
          onClick={() => setCurrentTime(t)}
          title={`Event ${i + 1} @ ${t.toFixed(2)}s — click to seek`}
          style={{
            position: "absolute",
            left: t * pxPerSec,
            top: 0,
            width: 2,
            height,
            background: "#ffcc00",
            opacity: 0.7,
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        />
      ))}

      {/* Named events — cyan, with a label at the top (inside the tracks area,
          so it's not clipped like the Scrubber version was). Labels stack at
          top: 2 so they read cleanly above the first track's content. */}
      {namedEvents.map((ev) => (
        <div
          key={`tl-named-${ev.name}`}
          onClick={() => setCurrentTime(ev.timeSec)}
          title={`${ev.name} @ ${ev.timeSec.toFixed(2)}s — click to seek`}
          style={{
            position: "absolute",
            left: ev.timeSec * pxPerSec - 1,
            top: 0,
            height,
            pointerEvents: "auto",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 2,
              height,
              background: "#22d3ee",
              opacity: 0.95,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 4,
              top: 2,
              fontSize: 9,
              fontWeight: 600,
              color: "#22d3ee",
              background: "rgba(0,0,0,0.7)",
              padding: "1px 4px",
              borderRadius: 2,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            {ev.name}
          </div>
        </div>
      ))}
    </div>
  );
};
