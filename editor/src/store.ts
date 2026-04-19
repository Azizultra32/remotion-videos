// src/store.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { EditorState } from "./types";
import { mergePipelineElements } from "./utils/pipelineElements";

export const useEditorStore = create<EditorState>()(
  persist(
    (set) => ({
      elements: [],
      currentTimeSec: 0,
      isPlaying: false,
      selectedElementId: null,
      beatData: null,
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
          elements: s.elements.map((e) =>
            e.id === id ? { ...e, locked } : e,
          ),
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
        }),
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
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") return persisted as any;
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
        return p as any;
      },
    },
  ),
);
