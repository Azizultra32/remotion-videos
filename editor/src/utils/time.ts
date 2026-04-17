// src/utils/time.ts
export const secToFrame = (sec: number, fps: number) => Math.round(sec * fps);
export const frameToSec = (frame: number, fps: number) => frame / fps;

export const snapToBeat = (sec: number, beats: number[], threshold = 0.1): number => {
  let nearest = sec;
  let minDist = threshold;
  for (const b of beats) {
    const d = Math.abs(b - sec);
    if (d < minDist) { minDist = d; nearest = b; }
    if (b > sec + threshold) break; // beats are sorted
  }
  return nearest;
};
