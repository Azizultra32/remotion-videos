// NamedEventPills — draggable name pills for MC-style time events stored in
// events.json (§1b of the MC deep-dive lift plan). Sits as an absolutely
// positioned overlay inside the Scrubber's waveform container.
//
// Visual language: cyan to distinguish from amber pipeline phase markers.
// Interactions:
//   - Click seeks the playhead to the event time.
//   - Drag horizontally moves the event; release commits via upsertEventMark,
//     which the useEventsSync hook persists to projects/<stem>/events.json.
//   - No add UI here — creation flows through the chat (addEvent mutation).

import { useState } from "react";
import { useEditorStore } from "../store";

type Props = {
  totalSec: number;
};

const HIT_WIDTH = 14;
const DRAG_THRESHOLD_PX = 2;
const NO_OP_DRAG_SEC = 0.05;

export const NamedEventPills = ({ totalSec }: Props) => {
  const events = useEditorStore((s) => s.events);
  const upsertEventMark = useEditorStore((s) => s.upsertEventMark);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const [dragState, setDragState] = useState<{
    name: string;
    sec: number;
  } | null>(null);

  if (totalSec <= 0 || events.length === 0) return null;

  return (
    <>
      {events.map((ev) => {
        const isDragging = dragState?.name === ev.name;
        const displaySec = isDragging ? dragState.sec : ev.timeSec;
        const leftPct = Math.max(0, Math.min(100, (displaySec / totalSec) * 100));

        const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
          e.preventDefault();
          e.stopPropagation();
          const parent = e.currentTarget.parentElement;
          if (!parent) return;
          const rect = parent.getBoundingClientRect();
          const startX = e.clientX;
          const startSec = ev.timeSec;
          let newSec = ev.timeSec;
          let dragged = false;

          setCurrentTime(startSec); // seek immediately on grab

          const onMove = (m: PointerEvent) => {
            const dx = m.clientX - startX;
            if (!dragged && Math.abs(dx) > DRAG_THRESHOLD_PX) dragged = true;
            if (!dragged) return;
            newSec = Math.max(0, Math.min(totalSec, startSec + (dx / rect.width) * totalSec));
            setDragState({ name: ev.name, sec: newSec });
          };
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setDragState(null);
            if (!dragged) return;
            if (Math.abs(newSec - startSec) < NO_OP_DRAG_SEC) return;
            upsertEventMark(ev.name, newSec);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        };

        const lineColor = isDragging ? "#a5f3fc" : "#22d3ee";
        return (
          <div
            key={`named-${ev.name}`}
            onPointerDown={onPointerDown}
            title={`${ev.name} @ ${displaySec.toFixed(2)}s — drag to move, click to seek`}
            style={{
              position: "absolute",
              left: `calc(${leftPct}% - ${HIT_WIDTH / 2}px)`,
              top: 0,
              height: "100%",
              width: HIT_WIDTH,
              cursor: "ew-resize",
              pointerEvents: "auto",
              zIndex: 3,
              touchAction: "none",
            }}
          >
            {/* vertical line through the waveform */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                bottom: 0,
                width: 2,
                transform: "translateX(-50%)",
                background: lineColor,
                opacity: 0.9,
                pointerEvents: "none",
              }}
            />
            {/* name label above the line */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: -20,
                transform: "translateX(-50%)",
                fontSize: 10,
                fontWeight: 600,
                color: lineColor,
                whiteSpace: "nowrap",
                padding: "1px 5px",
                background: "rgba(0,0,0,0.65)",
                borderRadius: 3,
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {ev.name}
            </div>
          </div>
        );
      })}
    </>
  );
};
