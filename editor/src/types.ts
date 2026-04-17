// src/types.ts
export type ElementType = "text" | "image" | "effect" | "beat-flash";

export type TimelineElement = {
  id: string;
  type: ElementType;
  trackIndex: number;
  startSec: number;
  durationSec: number;
  label: string;
  props: Record<string, unknown>; // element-specific (words, font, color, spring config, etc.)
};

export type BeatData = {
  duration: number;
  bpm_global: number;
  beats: number[];
  downbeats: number[];
  drops: number[];
  breakdowns: { start: number; end: number }[];
  energy: { t: number; db: number }[];
};

export type EditorState = {
  elements: TimelineElement[];
  currentTimeSec: number;
  isPlaying: boolean;
  selectedElementId: string | null;
  beatData: BeatData | null;
  compositionDuration: number; // seconds
  fps: number;
  snapToBeat: boolean;
  loopPlayback: boolean;
  // Actions
  setCurrentTime: (t: number | ((prev: number) => number)) => void;
  setPlaying: (p: boolean) => void;
  addElement: (el: TimelineElement) => void;
  updateElement: (id: string, partial: Partial<TimelineElement>) => void;
  removeElement: (id: string) => void;
  selectElement: (id: string | null) => void;
  setBeatData: (d: BeatData) => void;
  setSnapToBeat: (s: boolean) => void;
  setLoopPlayback: (l: boolean) => void;
};
