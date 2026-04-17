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
      snapToBeat: true,
      loopPlayback: false,
      audioSrc: "dubfire-sake-audio.mp3",
      beatsSrc: "dubfire-beats.json",
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
      setSnapToBeat: (s) => set({ snapToBeat: s }),
      setLoopPlayback: (l) => set({ loopPlayback: l }),
      setAudioSrc: (s) => set({ audioSrc: s }),
      setBeatsSrc: (s) => set({ beatsSrc: s }),
    }),
    {
      name: "music-video-editor",
      storage: createJSONStorage(() => localStorage),
      // Persist only user-editable fields — exclude transient playback state
      partialize: (s) => ({
        elements: s.elements,
        compositionDuration: s.compositionDuration,
        fps: s.fps,
        snapToBeat: s.snapToBeat,
        loopPlayback: s.loopPlayback,
        audioSrc: s.audioSrc,
        beatsSrc: s.beatsSrc,
      }),
      version: 2,
    },
  ),
);
