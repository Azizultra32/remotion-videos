import type { BeatData } from "../types";

type Props = {
  beatData: BeatData | null;
  pxPerSec: number;
  height: number;
};

// Faint vertical lines at every detected beat, slightly bolder on downbeats.
// Rendered behind the bars so they read as background rhythm.
export const TimelineBeatMarkers = ({ beatData, pxPerSec, height }: Props) => {
  if (!beatData) return null;
  const downbeats = new Set(beatData.downbeats ?? []);
  const breakdowns = beatData.breakdowns ?? [];

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        width: beatData.duration * pxPerSec,
        height,
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {breakdowns.map((b, i) => (
        <div
          key={`bd${i}`}
          style={{
            position: "absolute",
            left: b.start * pxPerSec,
            width: Math.max(1, (b.end - b.start) * pxPerSec),
            top: 0,
            height,
            background: "rgba(255,80,80,0.05)",
          }}
        />
      ))}
      {beatData.beats.map((t, i) => {
        const isDown = downbeats.has(t);
        return (
          <div
            key={`b${i}`}
            style={{
              position: "absolute",
              left: t * pxPerSec,
              top: 0,
              height,
              width: 1,
              background: isDown ? "rgba(120,180,255,0.22)" : "rgba(120,180,255,0.08)",
            }}
          />
        );
      })}
    </div>
  );
};
