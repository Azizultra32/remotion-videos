// src/store.ts
import { create } from "zustand";
import type { EditorState } from "./types";

export const useEditorStore = create<EditorState>((set) => ({
  elements: [],
  currentTimeSec: 0,
  isPlaying: false,
  selectedElementId: null,
  beatData: null,
  compositionDuration: 90,
  fps: 24,
  snapToBeat: true,
  loopPlayback: false,
  setCurrentTime: (t) => set((s) => ({ currentTimeSec: typeof t === "function" ? t(s.currentTimeSec) : t })),
  setPlaying: (p) => set({ isPlaying: p }),
  addElement: (el) => set((s) => ({ elements: [...s.elements, el] })),
  updateElement: (id, partial) =>
    set((s) => ({
      elements: s.elements.map((e) => (e.id === id ? { ...e, ...partial } : e)),
    })),
  removeElement: (id) =>
    set((s) => ({ elements: s.elements.filter((e) => e.id !== id) })),
  selectElement: (id) => set({ selectedElementId: id }),
  setBeatData: (d) => set({ beatData: d }),
  setSnapToBeat: (s) => set({ snapToBeat: s }),
  setLoopPlayback: (l) => set({ loopPlayback: l }),
}));
