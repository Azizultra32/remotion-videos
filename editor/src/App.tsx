import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { ElementDetail } from "./components/ElementDetail";
import { Sidebar } from "./components/Sidebar";
import { TransportControls } from "./components/TransportControls";
import { Scrubber } from "./components/Scrubber";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useBeatData } from "./hooks/useBeatData";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useEditorStore } from "./store";

const DEFAULT_BEATS_URL = "/love-in-traffic-beats.json";

// Allow overriding beats JSON via ?beats=/path/to/beats.json so the editor
// isn't locked to the dubfire mix. Falls back to the default on any error.
const getBeatsUrl = (): string => {
  if (typeof window === "undefined") return DEFAULT_BEATS_URL;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("beats") ?? DEFAULT_BEATS_URL;
  } catch {
    return DEFAULT_BEATS_URL;
  }
};

export const App = () => {
  // Load beat data (overridable via ?beats=... query param)
  useBeatData(getBeatsUrl());

  // Keyboard shortcuts (space, arrows, home/end, etc.)
  useKeyboardShortcuts();

  const audioSrc = useEditorStore((s) => s.audioSrc);
  const audioUrl = audioSrc ? `/${audioSrc.replace(/^\//, "")}` : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr)", gridTemplateRows: "auto auto 1fr 200px", height: "100vh", width: "100vw", overflow: "hidden", background: "#111", color: "#fff" }}>
      {/* Sidebar column: Header → Element Library → Element Detail */}
      <div style={{ gridRow: "1/5", borderRight: "1px solid #333", padding: 0, overflowY: "auto" }}>
        <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Music Video Editor</h2>
        </div>
        <ErrorBoundary name="Sidebar">
          <Sidebar />
        </ErrorBoundary>
        <ErrorBoundary name="Element Detail">
          <ElementDetail />
        </ErrorBoundary>
      </div>

      {/* Transport Controls */}
      <ErrorBoundary name="Transport Controls">
        <TransportControls />
      </ErrorBoundary>

      {/* Scrubber — click-to-seek waveform with drop markers and playhead */}
      <ErrorBoundary name="Scrubber">
        {audioUrl ? (
          <Scrubber audioUrl={audioUrl} />
        ) : (
          <div style={{ padding: 12, color: "#888", fontSize: 11 }}>
            No audio source set.
          </div>
        )}
      </ErrorBoundary>

      {/* Preview */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", background: "#000" }}>
        <ErrorBoundary name="Preview">
          <Preview />
        </ErrorBoundary>
      </div>

      {/* Timeline */}
      <div style={{ borderTop: "1px solid #333" }}>
        <ErrorBoundary name="Timeline">
          <Timeline />
        </ErrorBoundary>
      </div>
    </div>
  );
};
