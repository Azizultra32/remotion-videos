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

  // Long-lived EventSource that notifies us when projects/<stem>/timeline.json
  // is changed by something other than our own autosave (e.g. Claude Code's
  // Edit tool, or vim). Closed and re-opened on every stem change.
  const watchRef = useRef<EventSource | null>(null);

  // Parallel EventSource for projects/<stem>/analysis.json. Pushes the full
  // file contents on connect and on every change so the store can reconcile
  // pipeline-origin placeholders against the latest confirmed event list.
  const eventsRef = useRef<EventSource | null>(null);

  const openWatcher = (stem: string, onRemoteChange: () => void) => {
    if (watchRef.current) {
      watchRef.current.close();
      watchRef.current = null;
    }
    try {
      const es = new EventSource(`/api/timeline/watch/${stem}`);
      es.addEventListener("change", () => onRemoteChange());
      es.addEventListener("error", () => {
        // Browser auto-reconnects on transient drops (3s default backoff);
        // nothing to do here.
      });
      watchRef.current = es;
    } catch {
      // EventSource unavailable (very old browser) — autosave still works;
      // only live-reload from external edits is lost.
    }
  };

  const openEventsWatcher = (stem: string) => {
    if (eventsRef.current) {
      eventsRef.current.close();
      eventsRef.current = null;
    }
    try {
      const es = new EventSource(`/api/analyze/events/${stem}`);
      es.addEventListener("events", (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data) as {
            phase2_events_sec?: number[];
            phase1_events_sec?: number[];
            beats?: number[];
            downbeats?: number[];
            bpm_global?: number;
            duration?: number;
            duration_sec?: number;
          };
          const clean = (xs: unknown): number[] =>
            Array.isArray(xs)
              ? xs.filter(
                  (n): n is number => typeof n === "number" && Number.isFinite(n),
                )
              : [];
          const p1 = clean(parsed.phase1_events_sec);
          const p2 = clean(parsed.phase2_events_sec);
          const events = p2.length ? p2 : p1;

          // Refresh ALL beatData fields from the SSE payload — not just
          // phase events. The sidecar emits the full analysis.json, so
          // this is the one point where beats/downbeats/bpm/duration can
          // propagate after a mid-session change (e.g. mv:seed-beats
          // backfilling beats on an old project). Without this, the
          // store's `beats` stays stale at whatever useBeatData's one-
          // shot fetch loaded on stem change — snap-to-beat would remain
          // silently dead until the user switched tracks and back.
          //
          // Defensive: only overwrite a field when the payload actually
          // carries it, so partial payloads (legacy phase2-events.json
          // shape) don't clobber state with empty arrays.
          const store = useEditorStore.getState();
          const current = store.beatData ?? {
            duration: 0,
            bpm_global: 0,
            beats: [],
            downbeats: [],
            drops: [],
            breakdowns: [],
            energy: [],
          };
          const nextBeats = Array.isArray(parsed.beats)
            ? clean(parsed.beats)
            : current.beats;
          const nextDownbeats = Array.isArray(parsed.downbeats)
            ? clean(parsed.downbeats)
            : current.downbeats;
          const nextBpm =
            typeof parsed.bpm_global === "number" && Number.isFinite(parsed.bpm_global)
              ? parsed.bpm_global
              : current.bpm_global;
          const nextDuration =
            typeof parsed.duration_sec === "number" && Number.isFinite(parsed.duration_sec)
              ? parsed.duration_sec
              : typeof parsed.duration === "number" && Number.isFinite(parsed.duration)
              ? parsed.duration
              : current.duration;
          store.setBeatData({
            ...current,
            beats: nextBeats,
            downbeats: nextDownbeats,
            bpm_global: nextBpm,
            duration: nextDuration,
            phase1_events_sec: p1,
            phase2_events_sec: p2,
          });
          // replacePipelineElements reads s.beatData.beats inside the
          // set() callback, so it sees the beats we just wrote above.
          store.replacePipelineElements(stem, events);
        } catch {
          /* malformed payload — ignore */
        }
      });
      es.addEventListener("error", () => {
        /* browser auto-reconnects */
      });
      eventsRef.current = es;
    } catch {
      /* EventSource unsupported — skip silently */
    }
  };

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
        const fromFile = Array.isArray(data.elements) ? data.elements : [];
        // Preserve any pipeline-origin elements already pushed by the SSE
        // EventSource — if SSE won the race, replacing wholesale would
        // clobber those placeholders until the next external mutation.
        // The file is authoritative for user-origin elements; SSE is
        // authoritative for pipeline-origin. Merge accordingly.
        const fileHasPipeline = fromFile.some(
          (e) => e.origin === "pipeline",
        );
        const currentPipeline = fileHasPipeline
          ? []
          : useEditorStore
              .getState()
              .elements.filter((e) => e.origin === "pipeline");
        const mergedElements = fileHasPipeline
          ? fromFile
          : [...fromFile, ...currentPipeline].sort(
              (a, b) => a.startSec - b.startSec,
            );
        useEditorStore.setState({
          elements: mergedElements,
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
        openWatcher(nextStem, () => void hydrate(nextStem));
        openEventsWatcher(nextStem);
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
      openWatcher(initialStem, () => void hydrate(initialStem));
      openEventsWatcher(initialStem);
    }

    return () => {
      cancelled = true;
      unsubSwitch();
      if (watchRef.current) {
        watchRef.current.close();
        watchRef.current = null;
      }
      if (eventsRef.current) {
        eventsRef.current.close();
        eventsRef.current = null;
      }
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
