// src/hooks/useStoryboardSync.ts
//
// Binds store.scenes to projects/<stem>/storyboard.json. Mirrors
// useTimelineSync's three-phase pattern:
//
//   1. Hydrate — on stem change, GET /api/storyboard/<stem>; apply to store.
//      404 → store stays empty (new project; no storyboard yet).
//   2. Autosave — subscribe to scenes mutations; 500ms debounce; POST
//      /api/storyboard/save with {stem, storyboard}.
//   3. No SSE — storyboard isn't something external tools currently edit, so
//      a file-watcher is skipped. Easy to add later if needed.

import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import type { Scene } from "../types";
import { stemFromAudioSrc } from "../utils/url";

type OnDiskStoryboard = {
  version: 1;
  stem: string;
  scenes: Scene[];
};

const SAVE_DEBOUNCE_MS = 500;

export const useStoryboardSync = () => {
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const scenes = useEditorStore((s) => s.scenes);
  const setScenes = useEditorStore((s) => s.setScenes);

  const currentStemRef = useRef<string | null>(null);
  const lastSavedRef = useRef<string>("");
  const saveTimerRef = useRef<number | null>(null);
  // Suppress autosave for one render cycle after we hydrate — otherwise
  // setScenes fires the change listener which fires a POST of the same data.
  const hydratingRef = useRef(false);

  // ---- Hydrate on stem change ----
  useEffect(() => {
    const stem = stemFromAudioSrc(audioSrc);
    if (!stem) {
      currentStemRef.current = null;
      return;
    }
    if (stem === currentStemRef.current) return;
    currentStemRef.current = stem;

    let cancelled = false;
    hydratingRef.current = true;
    void fetch(`/api/storyboard/${encodeURIComponent(stem)}`)
      .then(async (r) => {
        if (!r.ok) {
          // 404 is normal — project just hasn't been storyboarded yet.
          if (!cancelled) {
            setScenes([]);
            lastSavedRef.current = JSON.stringify([]);
          }
          return;
        }
        const payload = (await r.json()) as Partial<OnDiskStoryboard>;
        if (cancelled) return;
        const rawLoaded = Array.isArray(payload.scenes) ? payload.scenes : [];
        // Back-compat: v1 scenes were persisted without linkedEventNames.
        // Default missing arrays to [] so link actions are always safe.
        const loaded = rawLoaded.map((sc) => ({
          ...sc,
          linkedEventNames: Array.isArray(sc.linkedEventNames) ? sc.linkedEventNames : [],
        }));
        setScenes(loaded);
        lastSavedRef.current = JSON.stringify(loaded);
      })
      .catch(() => {
        if (!cancelled) {
          setScenes([]);
          lastSavedRef.current = JSON.stringify([]);
        }
      })
      .finally(() => {
        // One microtask later, allow autosave to resume. The setScenes above
        // triggered the change listener already; clearing the flag here means
        // the next mutation (a real user edit) will save.
        queueMicrotask(() => { hydratingRef.current = false; });
      });

    return () => {
      cancelled = true;
    };
  }, [audioSrc, setScenes]);

  // ---- Autosave on scenes change ----
  useEffect(() => {
    if (hydratingRef.current) return;
    const stem = currentStemRef.current;
    if (!stem) return;
    const serialized = JSON.stringify(scenes);
    if (serialized === lastSavedRef.current) return;

    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const storyboard: OnDiskStoryboard = { version: 1, stem, scenes };
      void fetch("/api/storyboard/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stem, storyboard }),
      })
        .then((r) => { if (r.ok) lastSavedRef.current = serialized; })
        .catch(() => { /* will retry on next mutation */ });
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [scenes]);
};
