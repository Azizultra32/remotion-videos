import { useEffect, useMemo, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

export type BeatsJSON = {
  beats?: number[];
  downbeats?: number[];
  drops?: number[];
  breakdowns?: Array<[number, number] | { start: number; end: number }>;
  bpm?: number;
};

export type BeatsAPI = {
  beats: number[];
  downbeats: number[];
  drops: number[];
  breakdowns: Array<{ start: number; end: number }>;
  bpm: number | null;
  lastBeatBefore: (t: number) => number | null;
  nextBeatAfter: (t: number) => number | null;
  beatsInRange: (a: number, b: number) => number[];
  beatIndexAt: (t: number) => number;
};

const lowerBound = (arr: number[], target: number): number => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export const makeBeatsAPI = (data: BeatsJSON | null): BeatsAPI => {
  const beats = (data?.beats ?? []).slice().sort((a, b) => a - b);
  const downbeats = (data?.downbeats ?? []).slice().sort((a, b) => a - b);
  const drops = (data?.drops ?? []).slice().sort((a, b) => a - b);
  const breakdowns = (data?.breakdowns ?? []).map((b) =>
    Array.isArray(b) ? { start: b[0], end: b[1] } : b,
  );
  const bpm = data?.bpm ?? null;

  return {
    beats,
    downbeats,
    drops,
    breakdowns,
    bpm,
    lastBeatBefore: (t) => {
      if (beats.length === 0) return null;
      const i = lowerBound(beats, t);
      return i === 0 ? null : beats[i - 1];
    },
    nextBeatAfter: (t) => {
      if (beats.length === 0) return null;
      const i = lowerBound(beats, t);
      return i < beats.length ? beats[i] : null;
    },
    beatsInRange: (a, b) => {
      const lo = lowerBound(beats, a);
      const hi = lowerBound(beats, b);
      return beats.slice(lo, hi);
    },
    beatIndexAt: (t) => {
      const i = lowerBound(beats, t);
      return Math.max(0, i - 1);
    },
  };
};

export const useBeats = (src: string | null | undefined): BeatsAPI => {
  const [data, setData] = useState<BeatsJSON | null>(null);

  useEffect(() => {
    if (!src) {
      setData(null);
      return;
    }
    const handle = delayRender(`useBeats:${src}`);
    // `projects/` paths resolve through `public/projects` (the sidecar and
    // `scripts/cli/paths.ts` keep that symlinked at MV_PROJECTS_DIR), which
    // means staticFile() works identically in the editor AND in production
    // `npx remotion render` (where no /api/ server exists). An earlier revision
    // rewrote projects/ -> /api/projects/ which silently 404'd on render and
    // produced beat-less videos with no error.
    const url =
      src.startsWith("http") || src.startsWith("/") ? src : staticFile(src);
    fetch(url)
      .then((r) => r.json())
      .then((j: BeatsJSON) => {
        setData(j);
        continueRender(handle);
      })
      .catch((err) => {
        console.error("useBeats fetch failed", err);
        continueRender(handle);
      });
  }, [src]);

  return useMemo(() => makeBeatsAPI(data), [data]);
};
