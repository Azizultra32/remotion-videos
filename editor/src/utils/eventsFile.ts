// Pure helpers for projects/<stem>/events.json.
// Schema lifted from Motion Canvas's EditableTimeEvents pattern (MIT) but adapted
// to a standalone, per-project JSON file (vs MC's per-scene .meta sidecar).

export const EVENTS_FILE_VERSION = 1 as const;

export type EventMark = {
  name: string;
  timeSec: number;
};

export type EventsFile = {
  version: typeof EVENTS_FILE_VERSION;
  events: EventMark[];
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const validateEvent = (raw: unknown): EventMark | null => {
  if (!isObject(raw)) return null;
  const { name, timeSec } = raw;
  if (typeof name !== "string" || name.length === 0) return null;
  if (typeof timeSec !== "number" || !Number.isFinite(timeSec) || timeSec < 0) {
    return null;
  }
  return { name, timeSec };
};

export const parseEventsFile = (raw: unknown): EventsFile => {
  if (!isObject(raw)) return { version: EVENTS_FILE_VERSION, events: [] };
  const rawEvents = Array.isArray(raw.events) ? raw.events : [];
  const events: EventMark[] = [];
  for (const e of rawEvents) {
    const v = validateEvent(e);
    if (v) events.push(v);
  }
  return { version: EVENTS_FILE_VERSION, events };
};

// Sort events by time before serializing so diffs reflect semantic changes,
// not insertion order.
export const serializeEventsFile = (events: EventMark[]): string => {
  const sorted = [...events].sort((a, b) => a.timeSec - b.timeSec);
  const payload: EventsFile = {
    version: EVENTS_FILE_VERSION,
    events: sorted,
  };
  return JSON.stringify(payload, null, 2) + "\n";
};

export const findEvent = (events: EventMark[], name: string): EventMark | null =>
  events.find((e) => e.name === name) ?? null;

export const upsertEvent = (
  events: EventMark[],
  name: string,
  timeSec: number,
): EventMark[] => {
  const existing = events.findIndex((e) => e.name === name);
  if (existing === -1) return [...events, { name, timeSec }];
  const next = [...events];
  next[existing] = { name, timeSec };
  return next;
};

export const removeEventByName = (
  events: EventMark[],
  name: string,
): EventMark[] => events.filter((e) => e.name !== name);

// Resolve a named event to its time in seconds; returns defaultSec if not
// present. This is the pure core of the MC-style `waitUntil('name')` pattern —
// compositions pass their events list + name + fallback frame (in seconds),
// and get back a time-addressed value that survives the user renaming or
// dragging the event in the editor.
export const resolveEvent = (
  events: EventMark[] | undefined,
  name: string,
  defaultSec: number,
): number => {
  if (!events) return defaultSec;
  const hit = findEvent(events, name);
  return hit ? hit.timeSec : defaultSec;
};

export const resolveEventFrame = (
  events: EventMark[] | undefined,
  name: string,
  defaultSec: number,
  fps: number,
): number => Math.round(resolveEvent(events, name, defaultSec) * fps);

export const renameEvent = (
  events: EventMark[],
  oldName: string,
  newName: string,
): EventMark[] => {
  if (oldName === newName) return events;
  if (events.some((e) => e.name === newName)) return events; // collision
  const idx = events.findIndex((e) => e.name === oldName);
  if (idx === -1) return events;
  const next = [...events];
  next[idx] = { name: newName, timeSec: next[idx].timeSec };
  return next;
};
