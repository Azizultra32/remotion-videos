import { describe, expect, it } from "vitest";
import { EASING_NAMES, EASINGS, resolveEasing } from "../easing";

const EPSILON = 1e-9;

describe("easing registry", () => {
  it("exposes at least the common Penner set", () => {
    const required = [
      "linear",
      "easeInSine",
      "easeOutSine",
      "easeInOutSine",
      "easeInQuad",
      "easeOutQuad",
      "easeInOutQuad",
      "easeInCubic",
      "easeOutCubic",
      "easeInOutCubic",
      "easeInQuart",
      "easeOutQuart",
      "easeInOutQuart",
      "easeInQuint",
      "easeOutQuint",
      "easeInOutQuint",
      "easeInExpo",
      "easeOutExpo",
      "easeInOutExpo",
      "easeInCirc",
      "easeOutCirc",
      "easeInOutCirc",
      "easeInBack",
      "easeOutBack",
      "easeInOutBack",
      "easeInElastic",
      "easeOutElastic",
      "easeInOutElastic",
      "easeInBounce",
      "easeOutBounce",
      "easeInOutBounce",
    ];
    for (const name of required) {
      expect(EASINGS[name], `missing easing: ${name}`).toBeTypeOf("function");
    }
  });

  it("EASING_NAMES is a non-empty list of the registry keys", () => {
    expect(EASING_NAMES.length).toBeGreaterThan(0);
    expect(new Set(EASING_NAMES)).toEqual(new Set(Object.keys(EASINGS)));
  });

  describe("endpoint invariants", () => {
    for (const name of Object.keys(EASINGS)) {
      it(`${name}: f(0) ≈ 0 and f(1) ≈ 1`, () => {
        const fn = EASINGS[name];
        expect(Math.abs(fn(0))).toBeLessThan(1e-6);
        expect(Math.abs(fn(1) - 1)).toBeLessThan(1e-6);
      });
    }
  });

  describe("known-value spot checks", () => {
    it("linear is identity", () => {
      expect(EASINGS.linear(0.25)).toBeCloseTo(0.25, 9);
      expect(EASINGS.linear(0.5)).toBeCloseTo(0.5, 9);
      expect(EASINGS.linear(0.75)).toBeCloseTo(0.75, 9);
    });

    it("easeInQuad(0.5) = 0.25", () => {
      expect(EASINGS.easeInQuad(0.5)).toBeCloseTo(0.25, 9);
    });

    it("easeOutQuad(0.5) = 0.75", () => {
      expect(EASINGS.easeOutQuad(0.5)).toBeCloseTo(0.75, 9);
    });

    it("easeInCubic(0.5) = 0.125", () => {
      expect(EASINGS.easeInCubic(0.5)).toBeCloseTo(0.125, 9);
    });

    it("easeOutCubic(0.5) = 0.875", () => {
      expect(EASINGS.easeOutCubic(0.5)).toBeCloseTo(0.875, 9);
    });

    it("easeInOutQuad has symmetry about t=0.5", () => {
      const v = EASINGS.easeInOutQuad(0.5);
      expect(v).toBeCloseTo(0.5, EPSILON);
    });
  });

  describe("resolveEasing", () => {
    it("returns the named easing when it exists", () => {
      const fn = resolveEasing("easeOutCubic");
      expect(fn(0.5)).toBeCloseTo(0.875, 9);
    });

    it("falls back to linear on an unknown name", () => {
      const fn = resolveEasing("notARealEasing");
      expect(fn(0.25)).toBeCloseTo(0.25, 9);
      expect(fn(0.75)).toBeCloseTo(0.75, 9);
    });

    it("falls back to linear on undefined input", () => {
      const fn = resolveEasing(undefined);
      expect(fn(0.42)).toBeCloseTo(0.42, 9);
    });
  });
});
