// src/store.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { EditorState } from "./types";

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
      audioSrc: "love-in-traffic.mp3",
      beatsSrc: "love-in-traffic-beats.json",
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
      // (loopPlayback dropped entirely — the button was useless).
      version: 4,
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") return persisted as any;
        const p = persisted as Record<string, unknown>;
        if (version < 4) {
          // Old shape carried snapToBeat (bool) and loopPlayback (bool).
          // Map snapToBeat → snapMode, drop loopPlayback.
          const prev = p.snapToBeat;
          const snapMode = prev === false ? "off" : "beat";
          const { snapToBeat: _drop1, loopPlayback: _drop2, ...rest } = p;
          return { ...rest, snapMode };
        }
        return p as any;
      },
    },
  ),
);
