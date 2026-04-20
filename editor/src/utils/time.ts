// src/utils/time.ts
import type { BeatData, SnapMode } from "../types";

export const secToFrame = (sec: number, fps: number) => Math.round(sec * fps);
export const frameToSec = (frame: number, fps: number) => frame / fps;

// Snap `sec` to the nearest value in `candidates` within `threshold` seconds.
// Returns `sec` unchanged if nothing is close enough. `candidates` is assumed
// sorted ascending (short-circuit once we're past the window).
const snapToNearest = (sec: number, candidates: number[], threshold = 0.1): number => {
  let nearest = sec;
  let minDist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - sec);
    if (d < minDist) {
      minDist = d;
      nearest = c;
    }
    if (c > sec + threshold) break;
  }
  return nearest;
};

// Back-compat wrapper kept for any legacy import sites.
export const snapToBeat = (sec: number, beats: number[], threshold = 0.1): number =>
  snapToNearest(sec, beats, threshold);

// Derive half-beat targets as the midpoint between each adjacent pair of beats.
// Cheap; recomputed per drag-frame but `beats` is typically ~hundreds of entries.
const halfBeats = (beats: number[]): number[] => {
  if (beats.length < 2) return [];
  const out: number[] = [];
  for (let i = 0; i < beats.length - 1; i++) {
    out.push((beats[i] + beats[i + 1]) / 2);
  }
  return out;
};

// Derive downbeats from BeatData: use the analyzer's `downbeats` array if
// present and non-empty, otherwise assume 4/4 and take every 4th beat.
const downbeatsOf = (beatData: BeatData | null): number[] => {
  if (!beatData) return [];
  if (beatData.downbeats && beatData.downbeats.length > 0) {
    return beatData.downbeats;
  }
  const beats = beatData.beats ?? [];
  return beats.filter((_, i) => i % 4 === 0);
};

// Snap `sec` according to the current mode. `shiftInvert === true` flips the
// behavior for a single drag: snap-off + shift → snap to beat; snap-on + shift
// → no snap. Returns `sec` verbatim when snapping is disabled or no candidates
// exist.
export const snapTime = (
  sec: number,
  mode: SnapMode,
  beatData: BeatData | null,
  shiftInvert = false,
  threshold = 0.1,
): number => {
  const effectiveMode: SnapMode = shiftInvert ? (mode === "off" ? "beat" : "off") : mode;

  if (effectiveMode === "off") return sec;
  const beats = beatData?.beats ?? [];
  if (beats.length === 0) return sec;

  if (effectiveMode === "beat") return snapToNearest(sec, beats, threshold);
  if (effectiveMode === "half-beat") {
    // Allow snapping to both beats and half-beats (i.e. every 1/8 note grid
    // point in 4/4). Merge and sort; lists are small.
    const merged = [...beats, ...halfBeats(beats)].sort((a, b) => a - b);
    return snapToNearest(sec, merged, threshold);
  }
  if (effectiveMode === "downbeat") {
    const down = downbeatsOf(beatData);
    if (down.length === 0) return sec;
    // Downbeats are sparser — widen the threshold so the magnet still catches.
    return snapToNearest(sec, down, Math.max(threshold, 0.3));
  }
  return sec;
};
