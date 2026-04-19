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
  // Provenance + mutation guard. Absent fields mean origin="user" + unlocked,
  // which is the correct default for everything created via the Sidebar.
  // Pipeline-injected placeholders (Sub-project 2) set origin="pipeline" and
  // locked=true so they resist accidental delete/drag.
  origin?: "pipeline" | "user";
  locked?: boolean;
};

// Canonical shape after useBeatData normalizes the JSON. Missing legacy
// fields from newer analysis files (e.g. only `events` / `phase1_events_sec`
// present) are back-filled with empty arrays so every consumer can assume
// these are safe to .map / .length / .filter.
export type BeatData = {
  duration: number;
  bpm_global: number;       // 0 when the pipeline didn't produce one
  beats: number[];
  downbeats: number[];
  drops: number[];
  breakdowns: { start: number; end: number }[];
  energy: { t: number; db: number }[];
  // New pipeline's output (phase-1 / phase-2 event detector). Optional —
  // older analysis files won't have these.
  events?: unknown[];
  phase1_events_sec?: number[];
  phase2_events_sec?: number[];
};

// Snap quantization modes for drag/resize operations.
//   off       — no snapping
//   beat      — snap to the nearest detected beat
//   half-beat — snap to nearest half-beat (midpoint between adjacent beats)
//   downbeat  — snap to nearest downbeat (BeatData.downbeats, or every 4th beat)
export type SnapMode = "off" | "beat" | "half-beat" | "downbeat";

// Named time events — MC-style (waitUntil('name')) persistence lifted into
// projects/<stem>/events.json. Kept in-memory in the store; useEventsSync
// hydrates + persists to disk via /api/events/:stem.
export type EventMark = {
  name: string;
  timeSec: number;
};

export type EditorState = {
  elements: TimelineElement[];
  currentTimeSec: number;
  isPlaying: boolean;
  selectedElementId: string | null;
  beatData: BeatData | null;
  events: EventMark[];
  compositionDuration: number; // seconds
  fps: number;
  snapMode: SnapMode;
  audioSrc: string | null;
  beatsSrc: string | null;
  // Actions
  setCurrentTime: (t: number | ((prev: number) => number)) => void;
  setPlaying: (p: boolean) => void;
  addElement: (el: TimelineElement) => void;
  updateElement: (id: string, partial: Partial<TimelineElement>) => void;
  setElementLocked: (id: string, locked: boolean) => void;
  replacePipelineElements: (stem: string, events: number[]) => void;
  removeElement: (id: string) => void;
  selectElement: (id: string | null) => void;
  setBeatData: (d: BeatData) => void;
  setSnapMode: (m: SnapMode) => void;
  setAudioSrc: (s: string | null) => void;
  setBeatsSrc: (s: string | null) => void;
  setTrack: (audioSrc: string, beatsSrc: string) => void;
  // Named events
  setEvents: (events: EventMark[]) => void;
  upsertEventMark: (name: string, timeSec: number) => void;
  removeEventMark: (name: string) => void;
  renameEventMark: (oldName: string, newName: string) => void;
};
