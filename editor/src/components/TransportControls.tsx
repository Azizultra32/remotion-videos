// src/components/TransportControls.tsx
import { useEditorStore } from "../store";
import { ProjectActions } from "./ProjectActions";

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
  // Granular selectors. A full destructure re-renders this component on
  // every store change — including every frameupdate at 24 Hz during
  // playback. That caused the whole toolbar to churn and starved the pause
  // button's click. Same fix Preview got in 83d932b and Scrubber now has.
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const currentTimeSec = useEditorStore((s) => s.currentTimeSec);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const compositionDuration = useEditorStore((s) => s.compositionDuration);
  const fps = useEditorStore((s) => s.fps);
  const beatData = useEditorStore((s) => s.beatData);
  const snapToBeat = useEditorStore((s) => s.snapToBeat);
  const setSnapToBeat = useEditorStore((s) => s.setSnapToBeat);
  const loopPlayback = useEditorStore((s) => s.loopPlayback);
  const setLoopPlayback = useEditorStore((s) => s.setLoopPlayback);

  const jump = (delta: number) => {
    setCurrentTime(
      Math.max(0, Math.min(compositionDuration, currentTimeSec + delta)),
    );
  };

  const jumpButton = (label: string, delta: number, title: string) => (
    <button
      onClick={() => jump(delta)}
      title={title}
      style={{
        padding: "4px 8px",
        background: "#1a1a1a",
        border: "1px solid #333",
        borderRadius: 4,
        color: "#ddd",
        fontSize: 11,
        cursor: "pointer",
        fontFamily: "monospace",
        minWidth: 34,
      }}
    >
      {label}
    </button>
  );

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
        onClick={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        title="Home: rewind to 0"
        style={{
          padding: "4px 8px",
          background: "#1a1a1a",
          border: "1px solid #333",
          borderRadius: 4,
          color: "#ddd",
          fontSize: 11,
          cursor: "pointer",
          fontFamily: "monospace",
        }}
      >
        ⏮
      </button>

      {jumpButton("-5s", -5, "Shift+Left · jump back 5s")}
      {jumpButton("-1s", -1, "Left · jump back 1s")}

      <button
        onClick={() => setPlaying(!isPlaying)}
        title="Space · play / pause"
        style={{
          padding: "6px 16px",
          background: isPlaying ? "#f44336" : "#4CAF50",
          border: "none",
          borderRadius: 4,
          color: "#fff",
          fontSize: 12,
          cursor: "pointer",
          fontWeight: 600,
          minWidth: 70,
        }}
      >
        {isPlaying ? "Pause" : "Play"}
      </button>

      {jumpButton("+1s", 1, "Right · jump forward 1s")}
      {jumpButton("+5s", 5, "Shift+Right · jump forward 5s")}

      <button
        onClick={() => {
          setPlaying(false);
          setCurrentTime(Math.max(0, compositionDuration - 1));
        }}
        title="End: jump to end"
        style={{
          padding: "4px 8px",
          background: "#1a1a1a",
          border: "1px solid #333",
          borderRadius: 4,
          color: "#ddd",
          fontSize: 11,
          cursor: "pointer",
          fontFamily: "monospace",
        }}
      >
        ⏭
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

      <ProjectActions />

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
        onClick={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        title="Stop: pause and rewind to 0"
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
        Stop
      </button>

      <button
        onClick={() => setCurrentTime(0)}
        style={{
          padding: "4px 12px",
          background: "#222",
          border: "1px solid #333",
          borderRadius: 4,
          color: "#aaa",
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        Reset
      </button>
    </div>
  );
};
