// src/store.ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { EditorState } from "./types";
import {
  removeEventByName as removeEventMarkPure,
  renameEvent as renameEventMarkPure,
  upsertEvent as upsertEventMarkPure,
} from "./utils/eventsFile";
import { mergePipelineElements } from "./utils/pipelineElements";

export const useEditorStore = create<EditorState>()(
  persist(
    (set) => ({
      elements: [],
      currentTimeSec: 0,
      isPlaying: false,
      selectedElementId: null,
      beatData: null,
      events: [],
      scenes: [],
      compositionDuration: 90,
      fps: 24,
      snapMode: "beat",
      audioSrc: "projects/love-in-traffic/audio.mp3",
      beatsSrc: "projects/love-in-traffic/analysis.json",
      setCurrentTime: (t) =>
        set((s) => ({
          currentTimeSec: typeof t === "function" ? t(s.currentTimeSec) : t,
        })),
      setPlaying: (p) => set({ isPlaying: p }),
      addElement: (el) => set((s) => ({ elements: [...s.elements, el] })),
      updateElement: (id, partial) =>
        set((s) => ({
          elements: s.elements.map((e) => (e.id === id ? { ...e, ...partial } : e)),
        })),
      setElementLocked: (id, locked) =>
        set((s) => ({
          elements: s.elements.map((e) => (e.id === id ? { ...e, locked } : e)),
        })),
      replacePipelineElements: (stem, events) =>
        set((s) => ({
          elements: mergePipelineElements(s.elements, stem, events, s.beatData?.beats ?? []),
        })),
      removeElement: (id) =>
        set((s) => ({
          elements: s.elements.filter((e) => e.id !== id),
          selectedElementId: s.selectedElementId === id ? null : s.selectedElementId,
        })),
      selectElement: (id) => set({ selectedElementId: id }),
      setBeatData: (d) => set({ beatData: d }),
      setSnapMode: (m) => set({ snapMode: m }),
      setAudioSrc: (s) => set({ audioSrc: s }),
      setBeatsSrc: (s) => set({ beatsSrc: s }),
      // Convenience: switch tracks atomically. Clears timeline elements
      // (they're tied to beats/drops of the previous track) and resets the
      // playhead so we don't seek past the new track's unknown duration.
      // beatData is nulled so Scrubber's beat overlay doesn't flash the old
      // track's markers over the new waveform during the re-fetch.
      setTrack: (audioSrc, beatsSrc) =>
        set({
          audioSrc,
          beatsSrc,
          elements: [],
          currentTimeSec: 0,
          isPlaying: false,
          selectedElementId: null,
          beatData: null,
          events: [],
          scenes: [],
        }),
      // Named time events — in-memory; persisted to disk by useEventsSync.
      setEvents: (events) => set({ events }),
      upsertEventMark: (name, timeSec) =>
        set((s) => ({ events: upsertEventMarkPure(s.events, name, timeSec) })),
      removeEventMark: (name) => set((s) => ({ events: removeEventMarkPure(s.events, name) })),
      renameEventMark: (oldName, newName) =>
        set((s) => ({
          events: renameEventMarkPure(s.events, oldName, newName),
        })),
      setScenes: (scenes) => set({ scenes }),
      addScene: (scene) => set((s) => ({ scenes: [...s.scenes, scene] })),
      updateScene: (id, patch) =>
        set((s) => ({
          scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)),
        })),
      removeScene: (id) => set((s) => ({ scenes: s.scenes.filter((sc) => sc.id !== id) })),
      linkSceneElement: (sceneId, elementId) =>
        set((s) => ({
          scenes: s.scenes.map((sc) =>
            sc.id === sceneId && !sc.linkedElementIds.includes(elementId)
              ? { ...sc, linkedElementIds: [...sc.linkedElementIds, elementId] }
              : sc,
          ),
        })),
      unlinkSceneElement: (sceneId, elementId) =>
        set((s) => ({
          scenes: s.scenes.map((sc) =>
            sc.id === sceneId
              ? { ...sc, linkedElementIds: sc.linkedElementIds.filter((eid) => eid !== elementId) }
              : sc,
          ),
        })),
      linkSceneEvent: (sceneId, eventName) =>
        set((s) => ({
          scenes: s.scenes.map((sc) => {
            if (sc.id !== sceneId) return sc;
            const current = sc.linkedEventNames ?? [];
            return current.includes(eventName)
              ? sc
              : { ...sc, linkedEventNames: [...current, eventName] };
          }),
        })),
      unlinkSceneEvent: (sceneId, eventName) =>
        set((s) => ({
          scenes: s.scenes.map((sc) => {
            if (sc.id !== sceneId) return sc;
            const current = sc.linkedEventNames ?? [];
            return { ...sc, linkedEventNames: current.filter((n) => n !== eventName) };
          }),
        })),
    }),
    {
      name: "music-video-editor",
      storage: createJSONStorage(() => localStorage),
      // Persist only user-editable fields — exclude transient playback state.
      // compositionDuration is intentionally NOT persisted: it's derived from
      // whatever audio is currently loaded, and a stale value (e.g. 90s held
      // over from an earlier session) silently clamps seeks past that bound.
      partialize: (s) => ({
        elements: s.elements,
        fps: s.fps,
        snapMode: s.snapMode,
        audioSrc: s.audioSrc,
        beatsSrc: s.beatsSrc,
      }),
      // v4: snapToBeat:boolean + loopPlayback:boolean → snapMode:SnapMode
      // v5: bare-filename audioSrc/beatsSrc → projects/<stem>/... paths
      //     Legacy values are nulled so the initial-state defaults (which
      //     point at projects/love-in-traffic/...) win on next load.
      // v6: TimelineElement gained optional origin + locked fields. No-op
      //     migrate — absent fields read as origin="user", locked=false,
      //     which is the correct default for existing persisted elements.
      version: 6,
      // Zustand migrate must return EditorState; persisted may be an OLDER
      // shape (keys renamed/removed across versions). We migrate field-by-field
      // then cast via unknown so the older runtime shape is accepted as the
      // current typed shape — zustand will re-merge actions after hydrate.
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") return persisted as EditorState;
        let p = persisted as Record<string, unknown>;
        if (version < 4) {
          const prev = p.snapToBeat;
          const snapMode = prev === false ? "off" : "beat";
          const { snapToBeat: _drop1, loopPlayback: _drop2, ...rest } = p;
          p = { ...rest, snapMode };
        }
        if (version < 5) {
          const audioSrc = typeof p.audioSrc === "string" ? p.audioSrc : null;
          const beatsSrc = typeof p.beatsSrc === "string" ? p.beatsSrc : null;
          const needsReset =
            (audioSrc && !audioSrc.startsWith("projects/")) ||
            (beatsSrc && !beatsSrc.startsWith("projects/"));
          if (needsReset) {
            // Drop the stale values; initial-state defaults kick in. SongPicker
            // will then surface the right track after the user clicks.
            p = { ...p, audioSrc: null, beatsSrc: null };
          }
        }
        if (version < 6) {
          // Pipeline-origin/locked fields added. Existing persisted elements are
          // user-origin unlocked by default; no mutation needed.
        }
        return p as unknown as EditorState;
      },
    },
  ),
);
