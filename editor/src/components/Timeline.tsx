// src/components/Timeline.tsx
import { useEditorStore } from "../store";
import { TimelineTrack } from "./TimelineTrack";

export const Timeline = () => {
  const { elements, compositionDuration } = useEditorStore();

  // Organize elements by track
  const tracks = Array.from({ length: 5 }, (_, trackIndex) => ({
    trackIndex,
    elements: elements.filter((el) => el.trackIndex === trackIndex),
  }));

  const pxPerSec = 40; // 40 pixels per second
  const widthPx = compositionDuration * pxPerSec;

  return (
    <div style={{ padding: "16px", overflowX: "auto", overflowY: "auto", height: "100%" }}>
      <div style={{ position: "relative", width: widthPx, minHeight: "100%" }}>
        {tracks.map(({ trackIndex, elements }) => (
          <TimelineTrack
            key={trackIndex}
            trackIndex={trackIndex}
            elements={elements}
            pxPerSec={pxPerSec}
          />
        ))}
      </div>
    </div>
  );
};
