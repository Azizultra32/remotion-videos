// src/components/TransportControls.tsx
import { useEditorStore } from "../store";

export const TransportControls = () => {
  const { isPlaying, setPlaying, currentTimeSec, setCurrentTime, compositionDuration, fps, beatData } = useEditorStore();

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "8px 16px",
        borderBottom: "1px solid #333",
        background: "#0a0a0a",
      }}
    >
      <button
        onClick={() => setPlaying(!isPlaying)}
        style={{
          padding: "6px 16px",
          background: isPlaying ? "#f44336" : "#4CAF50",
          border: "none",
          borderRadius: 4,
          color: "#fff",
          fontSize: 12,
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        {isPlaying ? "Pause" : "Play"}
      </button>

      <div style={{ fontSize: 12, color: "#aaa", fontFamily: "monospace" }}>
        {formatTime(currentTimeSec)} / {formatTime(compositionDuration)}
      </div>

      <div style={{ fontSize: 11, color: "#666" }}>
        Frame: {Math.round(currentTimeSec * fps)}
      </div>

      {beatData && (
        <div style={{ fontSize: 11, color: "#666" }}>
          BPM: {beatData.bpm_global.toFixed(1)}
        </div>
      )}

      <button
        onClick={() => setCurrentTime(0)}
        style={{
          padding: "4px 12px",
          background: "#333",
          border: "none",
          borderRadius: 4,
          color: "#fff",
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        Reset
      </button>
    </div>
  );
};
