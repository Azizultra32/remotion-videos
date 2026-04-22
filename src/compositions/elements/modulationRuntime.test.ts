import { describe, expect, it } from "vitest";
import { getExponentialTriggerDecay, getLinearTriggerDecay } from "./modulationRuntime";

describe("modulationRuntime", () => {
  it("returns zero for linear decay when there is no trigger or the envelope has expired", () => {
    expect(
      getLinearTriggerDecay({
        lastTriggerAt: null,
        tSec: 1,
        durationSec: 0.2,
        peak: 0.8,
      }),
    ).toBe(0);
    expect(
      getLinearTriggerDecay({
        lastTriggerAt: 0.2,
        tSec: 0.45,
        durationSec: 0.2,
        peak: 0.8,
      }),
    ).toBe(0);
  });

  it("returns the peak linear value on the exact trigger and interpolates down over time", () => {
    expect(
      getLinearTriggerDecay({
        lastTriggerAt: 0.5,
        tSec: 0.5,
        durationSec: 0.2,
        peak: 0.8,
      }),
    ).toBe(0.8);
    expect(
      getLinearTriggerDecay({
        lastTriggerAt: 0.5,
        tSec: 0.6,
        durationSec: 0.2,
        peak: 0.8,
      }),
    ).toBeCloseTo(0.4, 9);
  });

  it("returns exponential decay with optional baseline", () => {
    expect(
      getExponentialTriggerDecay({
        lastTriggerAt: null,
        tSec: 1,
        decay: 5,
        amplitude: 2,
        baseline: 1,
      }),
    ).toBe(1);

    expect(
      getExponentialTriggerDecay({
        lastTriggerAt: 0.5,
        tSec: 0.5,
        decay: 5,
        amplitude: 2,
        baseline: 1,
      }),
    ).toBe(3);

    expect(
      getExponentialTriggerDecay({
        lastTriggerAt: 0.5,
        tSec: 0.7,
        decay: 5,
        amplitude: 2,
        baseline: 1,
      }),
    ).toBeCloseTo(1 + 2 * Math.exp(-1), 9);
  });
});
