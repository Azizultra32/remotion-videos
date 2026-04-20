// Named time-event primitives for compositions. Mirrors the editor-side
// resolver in editor/src/utils/eventsFile.ts but stays inside src/ so
// Remotion's bundler can reach it without crossing the editor boundary.
//
// The authoring surface (parse/serialize/upsert/rename etc.) lives with
// the editor; render-time code only needs resolution.

export type EventMark = {
  name: string;
  timeSec: number;
};

export const resolveEvent = (
  events: EventMark[] | undefined,
  name: string,
  defaultSec: number,
): number => {
  if (!events) return defaultSec;
  const hit = events.find((e) => e.name === name);
  return hit ? hit.timeSec : defaultSec;
};

export const resolveEventFrame = (
  events: EventMark[] | undefined,
  name: string,
  defaultSec: number,
  fps: number,
): number => Math.round(resolveEvent(events, name, defaultSec) * fps);
