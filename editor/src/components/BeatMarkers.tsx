// src/components/BeatMarkers.tsx
import { useEditorStore } from "../store";

export const BeatMarkers = ({
  widthPx,
  visibleRange,
}: {
  widthPx: number;
  visibleRange: [number, number]; // [startSec, endSec]
}) => {
  const beatData = useEditorStore((s) => s.beatData);
  if (!beatData) return null;
  const [start, end] = visibleRange;
  const duration = end - start;
  const toX = (t: number) => ((t - start) / duration) * widthPx;

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: widthPx,
        height: "100%",
        pointerEvents: "none",
      }}
    >
      {/* Beat ticks (thin, subtle) */}
      {beatData.beats
        .filter((t) => t >= start && t <= end)
        .map((t, i) => (
          <line
            key={`b${i}`}
            x1={toX(t)}
            x2={toX(t)}
            y1={0}
            y2="100%"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={0.5}
          />
        ))}
      {/* Drop markers (bold red) */}
      {beatData.drops
        .filter((t) => t >= start && t <= end)
        .map((t, i) => (
          <line
            key={`d${i}`}
            x1={toX(t)}
            x2={toX(t)}
            y1={0}
            y2="100%"
            stroke="#ff4444"
            strokeWidth={2}
          />
        ))}
      {/* Breakdown regions (dark red shading) */}
      {beatData.breakdowns
        .filter((b) => b.end >= start && b.start <= end)
        .map((b, i) => (
          <rect
            key={`bd${i}`}
            x={toX(b.start)}
            width={toX(b.end) - toX(b.start)}
            y={0}
            height="100%"
            fill="rgba(255,50,50,0.1)"
          />
        ))}
    </svg>
  );
};
