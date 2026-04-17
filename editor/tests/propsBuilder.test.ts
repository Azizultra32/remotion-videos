import { describe, it, expect } from "vitest";
import { buildProps } from "../src/utils/propsBuilder";
import type { TimelineElement } from "../src/types";

const el = (overrides: Partial<TimelineElement>): TimelineElement => ({
  id: overrides.id ?? "1",
  type: overrides.type ?? "text",
  trackIndex: overrides.trackIndex ?? 0,
  startSec: overrides.startSec ?? 0,
  durationSec: overrides.durationSec ?? 2,
  label: overrides.label ?? "",
  props: overrides.props ?? {},
});

describe("buildProps", () => {
  it("returns defaults when elements is empty", () => {
    const defaults = { ahuraPeak: 0, dubfireIn: 0, omegaIn: 0 };
    expect(buildProps([], defaults)).toEqual(defaults);
  });

  it("maps AHURA label to ahuraPeak (midpoint) and ahuraSigma (quarter)", () => {
    const out = buildProps(
      [el({ label: "AHURA", startSec: 10, durationSec: 4 })],
      { ahuraPeak: 0, ahuraSigma: 0 },
    );
    expect(out.ahuraPeak).toBe(12); // 10 + 4/2
    expect(out.ahuraSigma).toBe(1); // 4/4
  });

  it("maps DUBFIRE label to dubfireIn and respects durationOverride", () => {
    const out = buildProps(
      [
        el({
          label: "DUBFIRE",
          startSec: 50,
          durationSec: 8,
          props: { durationOverride: 12 },
        }),
      ],
      { dubfireIn: 0, dubfireDur: 0 },
    );
    expect(out.dubfireIn).toBe(50);
    expect(out.dubfireDur).toBe(12);
  });

  it("generic mapTo writes startSec to the named prop", () => {
    const out = buildProps(
      [el({ startSec: 33.5, props: { mapTo: "customStart" } })],
      { customStart: 0 },
    );
    expect(out.customStart).toBe(33.5);
  });

  it("generic mapToDuration writes durationSec to the named prop", () => {
    const out = buildProps(
      [el({ durationSec: 7, props: { mapToDuration: "customDur" } })],
      { customDur: 0 },
    );
    expect(out.customDur).toBe(7);
  });

  it("later elements override earlier ones on the same mapped prop", () => {
    const out = buildProps(
      [
        el({ id: "a", startSec: 10, props: { mapTo: "x" } }),
        el({ id: "b", startSec: 20, props: { mapTo: "x" } }),
      ],
      { x: 0 },
    );
    expect(out.x).toBe(20);
  });

  it("T-MINUS-12:12 stagger produces three offsets", () => {
    const out = buildProps(
      [el({ label: "T-MINUS-12:12", startSec: 100 })],
      { tIn: 0, minusIn: 0, twelveIn: 0 },
    );
    expect(out.tIn).toBe(100);
    expect(out.minusIn).toBeCloseTo(100.3, 5);
    expect(out.twelveIn).toBeCloseTo(100.6, 5);
  });
});
