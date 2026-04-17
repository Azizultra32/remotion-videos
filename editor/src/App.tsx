import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { ElementDetail } from "./components/ElementDetail";
import { TransportControls } from "./components/TransportControls";
import { SpectrumDisplay } from "./components/SpectrumDisplay";
import { useBeatData } from "./hooks/useBeatData";
import { usePlaybackSync } from "./hooks/usePlaybackSync";

export const App = () => {
  // Load beat data
  useBeatData("/dubfire-beats.json");

  // Sync playback
  usePlaybackSync();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gridTemplateRows: "auto auto 1fr 200px", height: "100vh", background: "#111", color: "#fff" }}>
      {/* Sidebar */}
      <div style={{ gridRow: "1/5", borderRight: "1px solid #333", padding: 0 }}>
        <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Music Video Editor</h2>
        </div>
        <ElementDetail />
      </div>

      {/* Transport Controls */}
      <TransportControls />

      {/* Spectrum Display */}
      <SpectrumDisplay />

      {/* Preview */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", background: "#000" }}>
        <Preview />
      </div>

      {/* Timeline */}
      <div style={{ borderTop: "1px solid #333" }}>
        <Timeline />
      </div>
    </div>
  );
};
