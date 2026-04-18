// src/hooks/useTimelineSync.ts
//
// Binds the editor's Zustand store to projects/<stem>/timeline.json on disk.
// Three responsibilities, one hook:
//
//   1. Hydrate    — on mount and on stem change, fetch timeline.json via
//                   GET /api/timeline/:stem and apply it to the store. If
//                   the file doesn't exist (404), start with whatever's
//                   already in the store (usually an empty elements array
//                   from setTrack).
//
//   2. Autosave   — subscribe to store element mutations. 500ms debounce.
//                   POST /api/timeline/save writes {version, fps, duration,
//                   elements[]} to projects/<stem>/timeline.json.
//
//   3. .current-project — on every stem change, POST /api/current-project
//                   so an external Claude Code session can discover the
//                   active track via `npm run mv:current`.
//
// Hook mounts once in App.tsx. Unmount is rare (only on full tab close).

import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import type { TimelineElement } from "../types";
import { stemFromAudioSrc } from "../utils/url";

// Shape of projects/<stem>/timeline.json on disk. Versioned so future
// schema changes can migrate old files without breaking the editor.
type OnDiskTimeline = {
  version: 1;
  stem: string;
  fps: number;
  compositionDuration: number;
  elements: TimelineElement[];
};

// Debounce window for autosave. 500ms is enough to coalesce rapid drags
// into one disk write without feeling stale.
const SAVE_DEBOUNCE_MS = 500;

export const useTimelineSync = () => {
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedJsonRef = useRef<string>("");
  const currentStemRef = useRef<string | null>(null);

  // ---- (1) Hydrate on stem change + bootstrap on mount ----
  useEffect(() => {
    // Re-run whenever audioSrc changes (project switch).
    const unsub = useEditorStore.subscribe(
      (state, prev) => state.audioSrc !== prev.audioSrc,
    );
    unsub(); // no-op; this just asserts API shape at type level. Real subscription below.

    let cancelled = false;
    const hydrate = async (stem: string) => {
      try {
        const resp = await fetch(`/api/timeline/${stem}`);
        if (!resp.ok) {
          // 404 is expected for a fresh project. Clear the last-saved marker
          // so the first mutation triggers a save.
          lastSavedJsonRef.current = "";
          return;
        }
        const data = (await resp.json()) as Partial<OnDiskTimeline>;
        if (cancelled) return;
        useEditorStore.setState({
          elements: Array.isArray(data.elements) ? data.elements : [],
          fps: typeof data.fps === "number" ? data.fps : 24,
          compositionDuration:
            typeof data.compositionDuration === "number"
              ? data.compositionDuration
              : 90,
        });
        lastSavedJsonRef.current = JSON.stringify(data);
      } catch {
        // network / sidecar down — swallow; store stays as-is
      }
    };

    const unsubSwitch = useEditorStore.subscribe((state, prev) => {
      const nextStem = stemFromAudioSrc(state.audioSrc);
      const prevStem = stemFromAudioSrc(prev.audioSrc);
      if (nextStem && nextStem !== prevStem) {
        currentStemRef.current = nextStem;
        void hydrate(nextStem);
        void fetch("/api/current-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stem: nextStem }),
        }).catch(() => {});
      }
    });

    // Bootstrap: hydrate once for the initial audioSrc at mount.
    const initialStem = stemFromAudioSrc(
      useEditorStore.getState().audioSrc,
    );
    if (initialStem) {
      currentStemRef.current = initialStem;
      void hydrate(initialStem);
      void fetch("/api/current-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stem: initialStem }),
      }).catch(() => {});
    }

    return () => {
      cancelled = true;
      unsubSwitch();
    };
  }, []);

  // ---- (2) Debounced autosave on element mutations ----
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      // Only persist fields that matter for a timeline snapshot.
      const fieldsChanged =
        state.elements !== prev.elements ||
        state.fps !== prev.fps ||
        state.compositionDuration !== prev.compositionDuration;
      if (!fieldsChanged) return;

      const stem = currentStemRef.current;
      if (!stem) return;

      const snapshot: OnDiskTimeline = {
        version: 1,
        stem,
        fps: state.fps,
        compositionDuration: state.compositionDuration,
        elements: state.elements,
      };
      const serialized = JSON.stringify(snapshot);
      // Don't re-save identical payload (would re-trigger file watchers elsewhere).
      if (serialized === lastSavedJsonRef.current) return;

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        fetch("/api/timeline/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stem, timeline: snapshot }),
        })
          .then((r) => {
            if (r.ok) lastSavedJsonRef.current = serialized;
          })
          .catch(() => {
            // Sidecar down; retry on next mutation
          });
      }, SAVE_DEBOUNCE_MS);
    });

    return () => {
      unsub();
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  // ---- Manual flush: call on ⌘S (wired by useKeyboardShortcuts) ----
  const flush = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const stem = currentStemRef.current;
    if (!stem) return;
    const state = useEditorStore.getState();
    const snapshot: OnDiskTimeline = {
      version: 1,
      stem,
      fps: state.fps,
      compositionDuration: state.compositionDuration,
      elements: state.elements,
    };
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSavedJsonRef.current) return;
    void fetch("/api/timeline/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stem, timeline: snapshot }),
    }).then((r) => {
      if (r.ok) lastSavedJsonRef.current = serialized;
    });
  };

  return { flush };
};
