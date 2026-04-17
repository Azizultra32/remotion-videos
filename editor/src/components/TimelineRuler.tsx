import type { BeatData } from "../types";

type Props = {
  compositionDuration: number;
  pxPerSec: number;
  beatData: BeatData | null;
  height: number;
};

const formatSec = (s: number): string => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${String(Math.round(r)).padStart(2, "0")}`;
};

export const TimelineRuler = ({ compositionDuration, pxPerSec, beatData, height }: Props) => {
  const widthPx = compositionDuration * pxPerSec;
  const totalSec = Math.ceil(compositionDuration);

  const ticks: number[] = [];
  for (let s = 0; s <= totalSec; s++) ticks.push(s);

  const drops = beatData?.drops ?? [];

  return (
    <div
      style={{
        position: "relative",
        width: widthPx,
        height,
        background: "#0a0a0a",
        borderBottom: "1px solid #333",
        overflow: "hidden",
      }}
    >
      {ticks.map((s) => {
        const major = s % 10 === 0;
        return (
          <div
            key={s}
            style={{
              position: "absolute",
              left: s * pxPerSec,
              bottom: 0,
              width: 1,
              height: major ? height * 0.6 : height * 0.25,
              background: major ? "#666" : "#333",
            }}
          />
        );
      })}
      {ticks
        .filter((s) => s % 10 === 0)
        .map((s) => (
          <div
            key={`l${s}`}
            style={{
              position: "absolute",
              left: s * pxPerSec + 3,
              top: 2,
              fontSize: 9,
              color: "#888",
              fontFamily: "monospace",
              pointerEvents: "none",
            }}
          >
            {formatSec(s)}
          </div>
        ))}
      {drops.map((t, i) => (
        <div
          key={`drop${i}`}
          title={`Drop @ ${t.toFixed(2)}s`}
          style={{
            position: "absolute",
            left: t * pxPerSec - 3,
            top: 2,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#ff4444",
            boxShadow: "0 0 4px rgba(255,68,68,0.8)",
          }}
        />
      ))}
    </div>
  );
};
