import { describe, expect, it } from "vitest";
import {
  EVENTS_FILE_VERSION,
  type EventMark,
  type EventsFile,
  findEvent,
  parseEventsFile,
  removeEventByName,
  renameEvent,
  resolveEvent,
  resolveEventFrame,
  serializeEventsFile,
  upsertEvent,
} from "../src/utils/eventsFile";

describe("parseEventsFile", () => {
  it("returns an empty v1 file when input is missing", () => {
    expect(parseEventsFile(undefined)).toEqual({
      version: EVENTS_FILE_VERSION,
      events: [],
    });
    expect(parseEventsFile(null)).toEqual({
      version: EVENTS_FILE_VERSION,
      events: [],
    });
  });

  it("accepts a well-formed v1 payload", () => {
    const input = { version: 1, events: [{ name: "drop", timeSec: 42 }] };
    expect(parseEventsFile(input)).toEqual(input);
  });

  it("drops malformed event entries silently", () => {
    const input = {
      version: 1,
      events: [
        { name: "good", timeSec: 10 },
        { name: "", timeSec: 20 },
        { name: "bad-time", timeSec: "xyz" },
        { timeSec: 30 },
        null,
      ],
    };
    expect(parseEventsFile(input)).toEqual({
      version: 1,
      events: [{ name: "good", timeSec: 10 }],
    });
  });

  it("coerces unknown version to EVENTS_FILE_VERSION and keeps valid events", () => {
    const input = { version: 99, events: [{ name: "x", timeSec: 1 }] };
    expect(parseEventsFile(input).version).toBe(EVENTS_FILE_VERSION);
    expect(parseEventsFile(input).events).toEqual([{ name: "x", timeSec: 1 }]);
  });

  it("returns empty when events is not an array", () => {
    expect(parseEventsFile({ version: 1, events: "nope" })).toEqual({
      version: EVENTS_FILE_VERSION,
      events: [],
    });
  });

  it("rejects negative times", () => {
    expect(parseEventsFile({ version: 1, events: [{ name: "x", timeSec: -1 }] }).events).toEqual(
      [],
    );
  });
});

describe("serializeEventsFile", () => {
  it("round-trips with parseEventsFile", () => {
    const events: EventMark[] = [
      { name: "b", timeSec: 20 },
      { name: "a", timeSec: 10 },
    ];
    const serialized = serializeEventsFile(events);
    const parsed: EventsFile = parseEventsFile(JSON.parse(serialized));
    expect(parsed.events.map((e) => e.name)).toEqual(["a", "b"]); // sorted by time
  });

  it("ends with a trailing newline so diffs stay clean", () => {
    expect(serializeEventsFile([])).toMatch(/\n$/);
  });
});

describe("upsertEvent", () => {
  it("appends a new event by name", () => {
    const result = upsertEvent([], "drop1", 12);
    expect(result).toEqual([{ name: "drop1", timeSec: 12 }]);
  });

  it("updates time if the name already exists", () => {
    const result = upsertEvent([{ name: "drop1", timeSec: 5 }], "drop1", 30);
    expect(result).toEqual([{ name: "drop1", timeSec: 30 }]);
  });

  it("keeps other events untouched when updating one", () => {
    const result = upsertEvent(
      [
        { name: "a", timeSec: 1 },
        { name: "b", timeSec: 2 },
      ],
      "a",
      99,
    );
    expect(result).toEqual([
      { name: "a", timeSec: 99 },
      { name: "b", timeSec: 2 },
    ]);
  });
});

describe("removeEventByName", () => {
  it("drops a matching event", () => {
    expect(removeEventByName([{ name: "x", timeSec: 1 }], "x")).toEqual([]);
  });

  it("returns input untouched when name is absent", () => {
    const input = [{ name: "x", timeSec: 1 }];
    expect(removeEventByName(input, "other")).toEqual(input);
  });
});

describe("renameEvent", () => {
  it("renames an existing event", () => {
    const result = renameEvent([{ name: "old", timeSec: 1 }], "old", "new");
    expect(result).toEqual([{ name: "new", timeSec: 1 }]);
  });

  it("no-ops if old name is absent", () => {
    const input = [{ name: "x", timeSec: 1 }];
    expect(renameEvent(input, "missing", "new")).toEqual(input);
  });

  it("no-ops if new name already exists (prevents name collision)", () => {
    const input = [
      { name: "a", timeSec: 1 },
      { name: "b", timeSec: 2 },
    ];
    expect(renameEvent(input, "a", "b")).toEqual(input);
  });
});

describe("findEvent", () => {
  it("returns the event when present", () => {
    expect(findEvent([{ name: "x", timeSec: 5 }], "x")).toEqual({ name: "x", timeSec: 5 });
  });

  it("returns null when absent", () => {
    expect(findEvent([{ name: "x", timeSec: 5 }], "y")).toBeNull();
  });
});

describe("resolveEvent", () => {
  it("returns the event time when named event exists", () => {
    expect(resolveEvent([{ name: "drop", timeSec: 30 }], "drop", 0)).toBe(30);
  });

  it("falls back to defaultSec when name is absent", () => {
    expect(resolveEvent([], "drop", 12.5)).toBe(12.5);
  });

  it("falls back when events array is undefined", () => {
    expect(resolveEvent(undefined, "drop", 7)).toBe(7);
  });
});

describe("resolveEventFrame", () => {
  it("converts resolved seconds to frames at the given fps", () => {
    expect(resolveEventFrame([{ name: "drop", timeSec: 2 }], "drop", 0, 30)).toBe(60);
  });

  it("uses defaultSec * fps when name is absent", () => {
    expect(resolveEventFrame([], "missing", 1.5, 24)).toBe(36);
  });

  it("rounds non-integer frame results", () => {
    // 2.033s * 30fps = 60.99 → 61
    expect(resolveEventFrame([{ name: "x", timeSec: 2.033 }], "x", 0, 30)).toBe(61);
  });
});
