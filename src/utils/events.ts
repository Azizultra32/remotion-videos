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

// Effective start-time for a timeline element. If the element has a
// startEvent pointing at a known named event, that wins; otherwise the
// element's own startSec applies. A startEvent naming a missing event
// silently falls back to startSec so events.json deletes never hide the
// element at render time.
export const resolveStartSec = (
  el: { startSec: number; startEvent?: string },
  events: EventMark[] | undefined,
): number => {
  if (el.startEvent) return resolveEvent(events, el.startEvent, el.startSec);
  return el.startSec;
};
