// src/types.ts
// ElementType is an opaque string — the canonical values are the ids exported
// by element modules in src/compositions/elements/**/registry.ts.
// Legacy values ("text", "image", "effect", "beat-flash") may still appear in
// older localStorage state and are silently ignored by MusicVideo at render time.
export type ElementType = string;

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
  // Optional: emitted by the adaptive detector (analyze-audio.sh). Older
  // JSONs predating that detector don't have it — consumers must check.
  buildups?: { start: number; end: number }[];
  // energy shape changed with the adaptive detector. Old: {t, db} absolute
  // dB. New: {t, rel} percentile in [0,1]. Either may be present.
  energy: ({ t: number; db?: number; rel?: number })[];
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
  audioSrc: string | null;
  beatsSrc: string | null;
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
  setAudioSrc: (s: string | null) => void;
  setBeatsSrc: (s: string | null) => void;
};
