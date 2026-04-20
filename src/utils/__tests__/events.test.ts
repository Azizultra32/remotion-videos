import { describe, it, expect } from "vitest";
import {
  resolveEvent,
  resolveEventFrame,
  type EventMark,
} from "../events";

describe("resolveEvent", () => {
  it("returns the event's timeSec when the name matches", () => {
    const events: EventMark[] = [{ name: "drop", timeSec: 30 }];
    expect(resolveEvent(events, "drop", 0)).toBe(30);
  });

  it("returns the defaultSec when the name is absent", () => {
    expect(resolveEvent([], "missing", 12.5)).toBe(12.5);
  });

  it("returns the defaultSec when events is undefined", () => {
    expect(resolveEvent(undefined, "drop", 7)).toBe(7);
  });

  it("matches the first event by name (first-wins on duplicates)", () => {
    const events: EventMark[] = [
      { name: "drop", timeSec: 10 },
      { name: "drop", timeSec: 30 },
    ];
    expect(resolveEvent(events, "drop", 0)).toBe(10);
  });
});

describe("resolveEventFrame", () => {
  it("rounds timeSec * fps to the nearest frame", () => {
    const events: EventMark[] = [{ name: "drop", timeSec: 2 }];
    expect(resolveEventFrame(events, "drop", 0, 30)).toBe(60);
  });

  it("rounds non-integer results", () => {
    // 2.033 * 30 = 60.99 → 61
    const events: EventMark[] = [{ name: "x", timeSec: 2.033 }];
    expect(resolveEventFrame(events, "x", 0, 30)).toBe(61);
  });

  it("uses defaultSec when event is missing", () => {
    expect(resolveEventFrame([], "none", 1.5, 24)).toBe(36);
  });
});
