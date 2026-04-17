// src/components/TransportControls.tsx
import { useEditorStore } from "../store";

const toggleButtonStyle = (active: boolean) => ({
  padding: "4px 12px",
  background: active ? "#2196F3" : "#222",
  border: `1px solid ${active ? "#2196F3" : "#444"}`,
  borderRadius: 4,
  color: "#fff",
  fontSize: 11,
  cursor: "pointer" as const,
  fontWeight: 500,
});

export const TransportControls = () => {
  const {
    isPlaying,
    setPlaying,
    currentTimeSec,
    setCurrentTime,
    compositionDuration,
    fps,
    beatData,
    snapToBeat,
    setSnapToBeat,
    loopPlayback,
    setLoopPlayback,
  } = useEditorStore();

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

      <div style={{ flex: 1 }} />

      <button
        onClick={() => setSnapToBeat(!snapToBeat)}
        style={toggleButtonStyle(snapToBeat)}
        title="Snap dragged elements to beats (shift inverts)"
      >
        Snap: {snapToBeat ? "ON" : "OFF"}
      </button>

      <button
        onClick={() => setLoopPlayback(!loopPlayback)}
        style={toggleButtonStyle(loopPlayback)}
        title="Loop playback at end of composition"
      >
        Loop: {loopPlayback ? "ON" : "OFF"}
      </button>

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
