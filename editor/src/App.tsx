import { useEffect } from "react";
import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { ElementDetail } from "./components/ElementDetail";
import { Sidebar } from "./components/Sidebar";
import { SongPicker } from "./components/SongPicker";
import { TransportControls } from "./components/TransportControls";
import { Scrubber } from "./components/Scrubber";
import { ChatPane } from "./components/ChatPane";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useBeatData } from "./hooks/useBeatData";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useTimelineSync } from "./hooks/useTimelineSync";
import { useAutoSeedBeats } from "./hooks/useAutoSeedBeats";
import { useUndoHistory } from "./hooks/useUndoHistory";
import { useEditorStore } from "./store";
import { toEditorUrl } from "./utils/url";

const DEFAULT_BEATS_URL = "/api/projects/love-in-traffic/analysis.json";

// Mount-time ?beats=... override. Historically this was the only way to
// switch tracks; now SongPicker handles runtime switching via store.setTrack.
// This remains only as a seed for initial state when the store was empty.
const getQueryBeatsUrl = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("beats");
  } catch {
    return null;
  }
};

export const App = () => {
  // Keyboard shortcuts (space, arrows, home/end, etc.)
  useKeyboardShortcuts();
  // Hydrate timeline.json on project switch + debounced autosave on mutations
  // + .current-project signal file for external Claude Code sessions.
  useTimelineSync();
  // Cmd-Z / Cmd-Shift-Z undo/redo for element mutations (50 levels deep).
  useUndoHistory();
  // Auto-fire /api/analyze/seed-beats when a project loads without beats,
  // so snap-to-beat starts working without a manual button click.
  useAutoSeedBeats();

  const audioSrc = useEditorStore((s) => s.audioSrc);
  const beatsSrc = useEditorStore((s) => s.beatsSrc);
  const setBeatsSrc = useEditorStore((s) => s.setBeatsSrc);

  // One-shot seed from ?beats=... if the store has no beatsSrc yet. After
  // this the SongPicker / store is the single source of truth.
  useEffect(() => {
    if (!beatsSrc) {
      const q = getQueryBeatsUrl();
      if (q) setBeatsSrc(q.replace(/^\//, ""));
    }
    // Intentionally run once — we only want to hydrate missing state, not
    // fight the user's later picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reactive beats load: re-fetches whenever the store's beatsSrc changes
  // (i.e. when SongPicker calls setTrack). toEditorUrl routes
  // "projects/<stem>/analysis.json" -> "/api/projects/<stem>/analysis.json".
  const beatsUrl =
    toEditorUrl(beatsSrc) ?? getQueryBeatsUrl() ?? DEFAULT_BEATS_URL;
  useBeatData(beatsUrl);

  const audioUrl = toEditorUrl(audioSrc);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr) 320px", gridTemplateRows: "auto auto minmax(0, 1fr) 360px", height: "100vh", width: "100vw", overflow: "hidden", background: "#111", color: "#fff" }}>
      {/* Sidebar column: Header → Element Library → Element Detail */}
      <div style={{ gridRow: "1/5", borderRight: "1px solid #333", padding: 0, overflowY: "auto" }}>
        <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Music Video Editor</h2>
          <ErrorBoundary name="Song Picker">
            <SongPicker />
          </ErrorBoundary>
        </div>
        <ErrorBoundary name="Sidebar">
          <Sidebar />
        </ErrorBoundary>
        <ErrorBoundary name="Element Detail">
          <ElementDetail />
        </ErrorBoundary>
      </div>

      {/* Transport Controls — pinned to row 1 col 2 (above Scrubber). */}
      <div style={{ gridRow: 1, gridColumn: 2, minWidth: 0 }}>
        <ErrorBoundary name="Transport Controls">
          <TransportControls />
        </ErrorBoundary>
      </div>

      {/* Scrubber — row 2 col 2. Click-to-seek waveform with drop markers
          and playhead. */}
      <div style={{ gridRow: 2, gridColumn: 2, minWidth: 0 }}>
        <ErrorBoundary name="Scrubber">
          {audioUrl ? (
            <Scrubber audioUrl={audioUrl} />
          ) : (
            <div style={{ padding: 12, color: "#888", fontSize: 11 }}>
              No audio source set.
            </div>
          )}
        </ErrorBoundary>
      </div>

      {/* Preview — row 3 col 2 (flexible middle section). */}
      <div style={{ gridRow: 3, gridColumn: 2, display: "flex", justifyContent: "center", alignItems: "center", background: "#000", minWidth: 0, minHeight: 0 }}>
        <ErrorBoundary name="Preview">
          <Preview />
        </ErrorBoundary>
      </div>

      {/* Timeline — row 4 col 2 (fixed-height bottom). */}
      <div style={{ gridRow: 4, gridColumn: 2, borderTop: "1px solid #333", minWidth: 0, overflow: "hidden" }}>
        <ErrorBoundary name="Timeline">
          <Timeline />
        </ErrorBoundary>
      </div>

      {/* Chat pane — natural-language mutations via /api/chat sidecar */}
      <div style={{ gridRow: "1/5", gridColumn: 3, borderLeft: "1px solid #333", minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ErrorBoundary name="Chat">
          <ChatPane />
        </ErrorBoundary>
      </div>
    </div>
  );
};
