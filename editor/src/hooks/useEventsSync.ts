// src/hooks/useEventsSync.ts
//
// Binds the editor's named-time-events store slice to
// projects/<stem>/events.json on disk, mirroring useTimelineSync's shape.
//
// Responsibilities:
//   1. Hydrate — on mount + on project switch, GET /api/events/:stem and
//                push the file into the store via setEvents.
//   2. Autosave — debounced POST /api/events/:stem when the events slice
//                 mutates in memory. 500ms window.
//
// Simpler than useTimelineSync because events.json has no SSE watcher (yet)
// and no external-session coordination — the editor is the sole writer.

import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import { stemFromAudioSrc } from "../utils/url";
import { parseEventsFile } from "../utils/eventsFile";

const SAVE_DEBOUNCE_MS = 500;

export const useEventsSync = () => {
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedJsonRef = useRef<string>("");
  const currentStemRef = useRef<string | null>(null);

  // ---- (1) Hydrate on stem change + bootstrap on mount ----
  useEffect(() => {
    let cancelled = false;
    const hydrate = async (stem: string) => {
      try {
        const resp = await fetch(`/api/events/${stem}`);
        if (!resp.ok) {
          // 404 means no events.json yet — start with an empty list.
          if (!cancelled) useEditorStore.getState().setEvents([]);
          lastSavedJsonRef.current = "";
          return;
        }
        const raw = await resp.json();
        if (cancelled) return;
        const parsed = parseEventsFile(raw);
        useEditorStore.getState().setEvents(parsed.events);
        lastSavedJsonRef.current = JSON.stringify(parsed.events);
      } catch {
        // sidecar down / offline — keep whatever's in the store
      }
    };

    const unsubSwitch = useEditorStore.subscribe((state, prev) => {
      const nextStem = stemFromAudioSrc(state.audioSrc);
      const prevStem = stemFromAudioSrc(prev.audioSrc);
      if (nextStem && nextStem !== prevStem) {
        currentStemRef.current = nextStem;
        void hydrate(nextStem);
      }
    });

    const initialStem = stemFromAudioSrc(
      useEditorStore.getState().audioSrc,
    );
    if (initialStem) {
      currentStemRef.current = initialStem;
      void hydrate(initialStem);
    }

    return () => {
      cancelled = true;
      unsubSwitch();
    };
  }, []);

  // ---- (2) Debounced autosave on events mutation ----
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.events === prev.events) return;
      const stem = currentStemRef.current;
      if (!stem) return;

      const serialized = JSON.stringify(state.events);
      if (serialized === lastSavedJsonRef.current) return;

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        fetch(`/api/events/${stem}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: 1, events: state.events }),
        })
          .then((r) => {
            if (r.ok) lastSavedJsonRef.current = serialized;
          })
          .catch(() => {
            // sidecar down — next mutation will retry
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

  const flush = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const stem = currentStemRef.current;
    if (!stem) return;
    const events = useEditorStore.getState().events;
    const serialized = JSON.stringify(events);
    if (serialized === lastSavedJsonRef.current) return;
    void fetch(`/api/events/${stem}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, events }),
    }).then((r) => {
      if (r.ok) lastSavedJsonRef.current = serialized;
    });
  };

  return { flush };
};
