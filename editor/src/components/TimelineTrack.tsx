// src/components/TimelineTrack.tsx
import type { TimelineElement as TimelineElementType } from "../types";
import { TimelineElement } from "./TimelineElement";

interface TimelineTrackProps {
  trackIndex: number;
  elements: TimelineElementType[];
  pxPerSec: number;
}

export const TimelineTrack = ({ trackIndex, elements, pxPerSec }: TimelineTrackProps) => {
  return (
    <div
      style={{
        position: "relative",
        height: 60,
        borderBottom: "1px solid #333",
        marginBottom: 8,
      }}
    >
      {/* Track label */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          padding: "4px 8px",
          fontSize: 11,
          color: "#888",
          pointerEvents: "none",
        }}
      >
        Track {trackIndex + 1}
      </div>

      {/* Elements */}
      {elements.map((el) => (
        <TimelineElement key={el.id} element={el} pxPerSec={pxPerSec} />
      ))}
    </div>
  );
};
