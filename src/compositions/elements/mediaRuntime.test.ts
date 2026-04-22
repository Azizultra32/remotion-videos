import { describe, expect, it } from "vitest";
import {
  getElementFadeOpacity,
  getFillMediaStyle,
  getPercentBoxStyle,
  secondsToStartFrame,
} from "./mediaRuntime";

describe("mediaRuntime", () => {
  describe("getElementFadeOpacity", () => {
    it("returns base opacity when no fades are configured", () => {
      expect(
        getElementFadeOpacity({
          localSec: 0.5,
          durationSec: 2,
          baseOpacity: 0.7,
        }),
      ).toBeCloseTo(0.7);
    });

    it("applies overlapping fade-in and fade-out envelopes by default", () => {
      expect(
        getElementFadeOpacity({
          localSec: 0.2,
          durationSec: 1,
          fadeInSec: 0.4,
          fadeOutSec: 0.4,
        }),
      ).toBeCloseTo(0.5);

      expect(
        getElementFadeOpacity({
          localSec: 0.8,
          durationSec: 1,
          fadeInSec: 0.4,
          fadeOutSec: 0.4,
        }),
      ).toBeCloseTo(0.5);
    });

    it("can preserve non-overlapping fades for legacy callers", () => {
      expect(
        getElementFadeOpacity({
          localSec: 0.2,
          durationSec: 0.5,
          fadeInSec: 0.4,
          fadeOutSec: 0.4,
        }),
      ).toBeCloseTo(0.375);

      expect(
        getElementFadeOpacity({
          localSec: 0.2,
          durationSec: 0.5,
          fadeInSec: 0.4,
          fadeOutSec: 0.4,
          preventFadeOverlap: true,
        }),
      ).toBeCloseTo(0.5);
    });

    it("clamps after the element ends", () => {
      expect(
        getElementFadeOpacity({
          localSec: 1.5,
          durationSec: 1,
          fadeOutSec: 0.25,
          baseOpacity: 0.9,
        }),
      ).toBe(0);
    });

    it("treats negative fade windows as disabled and clamps base opacity", () => {
      expect(
        getElementFadeOpacity({
          localSec: 0.25,
          durationSec: 1,
          fadeInSec: -1,
          fadeOutSec: -1,
          baseOpacity: 1.5,
        }),
      ).toBe(1);

      expect(
        getElementFadeOpacity({
          localSec: 0.25,
          durationSec: 1,
          baseOpacity: -0.2,
        }),
      ).toBe(0);
    });

    it("stays fully transparent before the element begins when fading in", () => {
      expect(
        getElementFadeOpacity({
          localSec: -0.1,
          durationSec: 2,
          fadeInSec: 0.5,
          fadeOutSec: 0.5,
          baseOpacity: 0.8,
        }),
      ).toBe(0);
    });
  });

  describe("getPercentBoxStyle", () => {
    it("builds the default centered percent box", () => {
      expect(
        getPercentBoxStyle({
          x: 50,
          y: 40,
          widthPct: 80,
          heightPct: 20,
        }),
      ).toEqual({
        position: "absolute",
        left: "10%",
        top: "30%",
        width: "80%",
        height: "20%",
        pointerEvents: "none",
      });
    });

    it("supports overflow and opacity options", () => {
      expect(
        getPercentBoxStyle({
          x: 20,
          y: 75,
          widthPct: 40,
          heightPct: 10,
          overflowHidden: true,
          opacity: 0.35,
        }),
      ).toEqual({
        position: "absolute",
        left: "0%",
        top: "70%",
        width: "40%",
        height: "10%",
        pointerEvents: "none",
        overflow: "hidden",
        opacity: 0.35,
      });
    });

    it("omits pointer-events when callers opt out of the default behavior", () => {
      expect(
        getPercentBoxStyle({
          x: 50,
          y: 50,
          widthPct: 60,
          heightPct: 30,
          pointerEventsNone: false,
        }),
      ).toEqual({
        position: "absolute",
        left: "20%",
        top: "35%",
        width: "60%",
        height: "30%",
      });
    });
  });

  describe("getFillMediaStyle", () => {
    it("returns a fill style with optional objectFit", () => {
      expect(getFillMediaStyle()).toEqual({
        width: "100%",
        height: "100%",
      });

      expect(getFillMediaStyle("cover")).toEqual({
        width: "100%",
        height: "100%",
        objectFit: "cover",
      });
    });
  });

  describe("secondsToStartFrame", () => {
    it("rounds to the nearest frame and clamps negatives", () => {
      expect(secondsToStartFrame(1.24, 30)).toBe(37);
      expect(secondsToStartFrame(1.26, 30)).toBe(38);
      expect(secondsToStartFrame(1 / 60, 30)).toBe(1);
      expect(secondsToStartFrame(-1, 30)).toBe(0);
    });
  });
});
