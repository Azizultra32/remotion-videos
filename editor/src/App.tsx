import { useEffect } from "react";
import { AssetLibrary } from "./components/AssetLibrary";
import { SIDEBAR_COL_WIDTH, DETAIL_COL_WIDTH, CHAT_COL_WIDTH } from "./constants/layout";
import { ChatPane } from "./components/ChatPane";
import { ElementDetail } from "./components/ElementDetail";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FloatingPreview } from "./components/FloatingPreview";
import { Preview } from "./components/Preview";
import { Scrubber } from "./components/Scrubber";
import { Sidebar } from "./components/Sidebar";
import { SongPicker } from "./components/SongPicker";
import { Timeline } from "./components/Timeline";
import { TransportControls } from "./components/TransportControls";
import { ShortcutsProvider } from "./contexts/shortcuts";
import { useAutoSeedBeats } from "./hooks/useAutoSeedBeats";
import { useBeatData } from "./hooks/useBeatData";
import { useEventsSync } from "./hooks/useEventsSync";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useStoryboardSync } from "./hooks/useStoryboardSync";
import { useTimelineSync } from "./hooks/useTimelineSync";
import { useUndoHistory } from "./hooks/useUndoHistory";
import { useEditorStore } from "./store";
import { toEditorUrl } from "./utils/url";

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
  // Hydrate + autosave projects/<stem>/storyboard.json.
  useStoryboardSync();
  // Same shape for the MC-style named time events (events.json).
  useEventsSync();
  // Cmd-Z / Cmd-Shift-Z undo/redo for element mutations (50 levels deep).
  useUndoHistory();
  // Auto-fire /api/analyze/seed-beats when a project loads without beats,
  // so snap-to-beat starts working without a manual button click.
  useAutoSeedBeats();

  const audioSrc = useEditorStore((s) => s.audioSrc);
  const beatsSrc = useEditorStore((s) => s.beatsSrc);
  const setBeatsSrc = useEditorStore((s) => s.setBeatsSrc);
  const setTrack = useEditorStore((s) => s.setTrack);

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
  }, [setBeatsSrc, beatsSrc]);

  useEffect(() => {
    let cancelled = false;

    const waitForHydration = async () => {
      if (useEditorStore.persist.hasHydrated()) return;
      await new Promise<void>((resolve) => {
        const unsub = useEditorStore.persist.onFinishHydration(() => {
          unsub();
          resolve();
        });
      });
    };

    const bootstrapTrack = async () => {
      await waitForHydration();
      if (cancelled || useEditorStore.getState().audioSrc) return;

      const [currentStem, songs] = await Promise.all([
        fetch("/api/current-project")
          .then(async (r) => {
            if (!r.ok) return null;
            const body = (await r.json()) as { stem?: string | null };
            return body.stem ?? null;
          })
          .catch(() => null),
        fetch("/api/songs")
          .then(async (r) => {
            if (!r.ok) return [] as Array<{ stem: string; audioSrc: string; beatsSrc: string }>;
            return (await r.json()) as Array<{ stem: string; audioSrc: string; beatsSrc: string }>;
          })
          .catch(() => [] as Array<{ stem: string; audioSrc: string; beatsSrc: string }>),
      ]);
      if (cancelled || useEditorStore.getState().audioSrc) return;

      const currentSong = currentStem ? songs.find((song) => song.stem === currentStem) : null;
      if (currentSong?.audioSrc) {
        setTrack(currentSong.audioSrc, currentSong.beatsSrc);
        return;
      }

      const fallback = songs[0];
      if (fallback) setTrack(fallback.audioSrc, fallback.beatsSrc);
    };

    if (!audioSrc) void bootstrapTrack();
    return () => {
      cancelled = true;
    };
  }, [audioSrc, setTrack]);

  // Reactive beats load: re-fetches whenever the store's beatsSrc changes
  // (i.e. when SongPicker calls setTrack). toEditorUrl routes
  // "projects/<stem>/analysis.json" -> "/api/projects/<stem>/analysis.json".
  const beatsUrl = toEditorUrl(beatsSrc) ?? getQueryBeatsUrl();
  useBeatData(beatsUrl);

  const audioUrl = toEditorUrl(audioSrc);

  return (
    <ShortcutsProvider>
      <div
        onWheel={(e) => {
          // Block browser pinch-zoom (ctrl+wheel on mac trackpads) at the
          // root so it never escapes to the page. Individual panels
          // (Timeline/Scrubber) still handle their own wheel events; this
          // only catches ctrl-modifier zoom attempts which nothing else
          // consumes. Prevents the "scroll takes me away from the editor"
          // pathology where a pinch gesture rescaled the whole DOM.
          if (e.ctrlKey) e.preventDefault();
        }}
        style={{
          display: "grid",
          // Four columns now: palette | selected-item details | preview/timeline | chat.
          // The detail column (col 2) is the master-detail split the user
          // asked for — selecting an element shows its properties RIGHT of
          // the palette list, not stacked below. Previously everything in
          // the left stack (Sidebar + AssetLibrary + ElementDetail)
          // fought the same 240px of vertical space and crushed each other.
          gridTemplateColumns: `${SIDEBAR_COL_WIDTH}px ${DETAIL_COL_WIDTH}px minmax(0, 1fr) ${CHAT_COL_WIDTH}px`,
          gridTemplateRows: "auto auto minmax(0, 1fr) 360px",
          height: "100vh",
          width: "100vw",
          overflow: "hidden",
          background: "var(--surface-1)",
          color: "var(--text-primary)",
          // Block trackpad pinch + double-tap zoom from propagating to the
          // browser. Belt-and-braces with the ctrl+wheel guard above.
          touchAction: "none",
        }}
      >
        {/* Col 1 — palette: Header, Sidebar (element buttons), AssetLibrary.
            ElementDetail moved to col 2. Palette column narrowed from 240
            to 210 since it no longer needs to hold the long prop form. */}
        <div
          style={{
            gridRow: "1/5",
            borderRight: "1px solid var(--border-subtle)",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            background: "var(--surface-0)",
          }}
        >
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)", flex: "0 0 auto" }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, fontFamily: "var(--font-ui)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>Music Video Editor</h2>
            <ErrorBoundary name="Song Picker">
              <SongPicker />
            </ErrorBoundary>
          </div>
          <div style={{ flex: "1 1 60%", minHeight: 0, overflowY: "auto", borderBottom: "1px solid var(--border-subtle)" }}>
            <ErrorBoundary name="Sidebar">
              <Sidebar />
            </ErrorBoundary>
          </div>
          <div style={{ flex: "1 1 40%", minHeight: 0, overflowY: "auto", background: "var(--surface-0)" }}>
            <ErrorBoundary name="Asset Library">
              <AssetLibrary />
            </ErrorBoundary>
          </div>
        </div>

        {/* Col 2 — details: ElementDetail for the selected element. Own
            scroll, full height. Placeholder shown when nothing selected
            (ElementDetail already handles that branch internally). */}
        <div
          style={{
            gridRow: "1/5",
            gridColumn: 2,
            borderRight: "1px solid var(--border-subtle)",
            minWidth: 0,
            minHeight: 0,
            overflowY: "auto",
            background: "var(--surface-0)",
          }}
        >
          <ErrorBoundary name="Element Detail">
            <ElementDetail />
          </ErrorBoundary>
        </div>

        {/* Col 3 — preview + timeline stack (was col 2). */}
        <div style={{ gridRow: 1, gridColumn: 3, minWidth: 0 }}>
          <ErrorBoundary name="Transport Controls">
            <TransportControls />
          </ErrorBoundary>
        </div>

        <div style={{ gridRow: 2, gridColumn: 3, minWidth: 0 }}>
          <ErrorBoundary name="Scrubber">
            {audioUrl ? (
              <Scrubber audioUrl={audioUrl} />
            ) : (
              <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-ui)" }}>No audio source set.</div>
            )}
          </ErrorBoundary>
        </div>

        <div
          style={{
            gridRow: 3,
            gridColumn: 3,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "var(--surface-0)",
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <ErrorBoundary name="Preview">
            <Preview />
          </ErrorBoundary>
        </div>

        <div
          style={{
            gridRow: 4,
            gridColumn: 3,
            borderTop: "1px solid var(--border-subtle)",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <ErrorBoundary name="Timeline">
            <Timeline />
          </ErrorBoundary>
        </div>

        {/* Col 4 — chat (was col 3). */}
        <div
          style={{
            gridRow: "1/5",
            gridColumn: 4,
            borderLeft: "1px solid var(--border-subtle)",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ErrorBoundary name="Chat">
            <ChatPane />
          </ErrorBoundary>
        </div>
      </div>
      <ErrorBoundary name="Floating Preview">
        <FloatingPreview />
      </ErrorBoundary>
    </ShortcutsProvider>
  );
};
