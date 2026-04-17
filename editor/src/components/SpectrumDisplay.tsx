// src/components/SpectrumDisplay.tsx
import { useEditorStore } from "../store";

export const SpectrumDisplay = () => {
  const { beatData, currentTimeSec } = useEditorStore();
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
      </div>
    </div>
  );
};
