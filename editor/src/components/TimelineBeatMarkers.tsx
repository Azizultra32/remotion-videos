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
      {breakdowns.map((b) => (
        <div
          key={`bd${b.start}`}
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
      {beatData.beats.map((t) => {
        const isDown = downbeats.has(t);
        return (
          <div
            key={`b${t}`}
            style={{
              position: "absolute",
              left: t * pxPerSec,
              top: 0,
              height,
              width: 1,
              background: isDown ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.05)",
              borderRight: isDown ? "none" : "1px dotted rgba(59,130,246,0.06)",
            }}
          />
        );
      })}
    </div>
  );
};
