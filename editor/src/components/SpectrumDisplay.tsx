// src/components/SpectrumDisplay.tsx
import { useEditorStore } from "../store";

// Duration of the flash effect when passing a drop (seconds).
const DROP_FLASH_DURATION_SEC = 0.35;

export const SpectrumDisplay = () => {
  const { beatData, currentTimeSec, compositionDuration } = useEditorStore();
  if (!beatData || !beatData.energy) return null;

  // Find nearest energy point
  const energyPoint = beatData.energy.find((e) => Math.abs(e.t - currentTimeSec) < 0.5);
  const bassDb = energyPoint?.db ?? -20;

  // Normalize -20dB to 0dB → 0 to 100%
  const percentage = Math.max(0, Math.min(100, ((bassDb + 20) / 20) * 100));

  const getColor = (pct: number) => {
    if (pct < 30) return "#4CAF50"; // Green (quiet)
    if (pct < 70) return "#FFC107"; // Yellow (building)
    return "#f44336"; // Red (peak)
  };

  // Plan Task 9: "Drops marked with vertical flash lines".
  // Render a vertical line at every drop's timeline position. When the playhead
  // crosses a drop, the line brightens for DROP_FLASH_DURATION_SEC.
  const drops = beatData.drops ?? [];
  const totalSec = beatData.duration || compositionDuration || 1;

  return (
    <div
      style={{
        padding: "8px 16px",
        borderBottom: "1px solid #333",
        background: "#0a0a0a",
      }}
    >
      <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>
        Bass Energy
      </div>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: 8,
          background: "#222",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percentage}%`,
            height: "100%",
            background: getColor(percentage),
            transition: "width 0.1s ease-out, background 0.2s",
          }}
        />
        {drops.map((dropTime, i) => {
          const leftPct = (dropTime / totalSec) * 100;
          if (leftPct < 0 || leftPct > 100) return null;
          const timeSinceDrop = currentTimeSec - dropTime;
          const isActive =
            timeSinceDrop >= 0 && timeSinceDrop < DROP_FLASH_DURATION_SEC;
          const opacity = isActive
            ? 1 - timeSinceDrop / DROP_FLASH_DURATION_SEC
            : 0.25;
          return (
            <div
              key={`drop-${i}`}
              title={`Drop @ ${dropTime.toFixed(2)}s`}
              style={{
                position: "absolute",
                left: `${leftPct}%`,
                top: 0,
                width: isActive ? 2 : 1,
                height: "100%",
                background: "#ff4444",
                opacity,
                boxShadow: isActive
                  ? "0 0 6px rgba(255,68,68,0.9)"
                  : "none",
                pointerEvents: "none",
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
