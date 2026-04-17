import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { ElementDetail } from "./components/ElementDetail";
import { TransportControls } from "./components/TransportControls";
import { SpectrumDisplay } from "./components/SpectrumDisplay";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useBeatData } from "./hooks/useBeatData";
import { usePlaybackSync } from "./hooks/usePlaybackSync";

const DEFAULT_BEATS_URL = "/dubfire-beats.json";

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

  // Sync playback
  usePlaybackSync();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gridTemplateRows: "auto auto 1fr 200px", height: "100vh", background: "#111", color: "#fff" }}>
      {/* Sidebar */}
      <div style={{ gridRow: "1/5", borderRight: "1px solid #333", padding: 0 }}>
        <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Music Video Editor</h2>
        </div>
        <ErrorBoundary name="Element Detail">
          <ElementDetail />
        </ErrorBoundary>
      </div>

      {/* Transport Controls */}
      <ErrorBoundary name="Transport Controls">
        <TransportControls />
      </ErrorBoundary>

      {/* Spectrum Display */}
      <ErrorBoundary name="Spectrum Display">
        <SpectrumDisplay />
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
