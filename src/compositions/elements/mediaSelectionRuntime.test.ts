import { describe, expect, it } from "vitest";
import { selectTriggeredMedia } from "./mediaSelectionRuntime";

describe("mediaSelectionRuntime", () => {
  it("keeps the first item selected and anchor at zero before the first trigger", () => {
    expect(
      selectTriggeredMedia({
        items: ["a", "b"],
        triggerTimes: [0.5, 1],
        tSec: 0.2,
        everyN: 1,
      }),
    ).toEqual({
      anchorSec: 0,
      currentIdx: 0,
      currentItem: "a",
      prevIdx: -1,
      prevItem: null,
      timeSinceAnchorSec: 0.2,
    });
  });

  it("advances immediately on an exact qualifying trigger and tracks the previous item", () => {
    expect(
      selectTriggeredMedia({
        items: ["a", "b", "c"],
        triggerTimes: [0.1, 0.2, 0.3],
        tSec: 0.2,
        everyN: 1,
      }),
    ).toEqual({
      anchorSec: 0.2,
      currentIdx: 2,
      currentItem: "c",
      prevIdx: 1,
      prevItem: "b",
      timeSinceAnchorSec: 0,
    });
  });

  it("uses only everyNth qualifying trigger to advance selection", () => {
    const selection = selectTriggeredMedia({
      items: ["a", "b", "c"],
      triggerTimes: [0.1, 0.2, 0.3, 0.4, 0.5],
      tSec: 0.45,
      everyN: 2,
    });

    expect(selection).toMatchObject({
      anchorSec: 0.4,
      currentIdx: 2,
      currentItem: "c",
      prevIdx: 1,
      prevItem: "b",
    });
    expect(selection.timeSinceAnchorSec).toBeCloseTo(0.05, 9);
  });

  it("wraps around the collection while preserving previous selection", () => {
    expect(
      selectTriggeredMedia({
        items: ["a", "b"],
        triggerTimes: [0.1, 0.2, 0.3],
        tSec: 0.3,
        everyN: 1,
      }),
    ).toEqual({
      anchorSec: 0.3,
      currentIdx: 1,
      currentItem: "b",
      prevIdx: 0,
      prevItem: "a",
      timeSinceAnchorSec: 0,
    });
  });

  it("returns null items when the collection is empty", () => {
    expect(
      selectTriggeredMedia({
        items: [],
        triggerTimes: [0.1, 0.2],
        tSec: 0.2,
        everyN: 1,
      }),
    ).toEqual({
      anchorSec: 0.2,
      currentIdx: 0,
      currentItem: null,
      prevIdx: -1,
      prevItem: null,
      timeSinceAnchorSec: 0,
    });
  });

  it("supports seeded-random selection while staying deterministic for the same step", () => {
    const first = selectTriggeredMedia({
      items: ["a", "b", "c", "d"],
      triggerTimes: [0.1, 0.2, 0.3, 0.4],
      tSec: 0.4,
      everyN: 1,
      selectionMode: "seeded-random",
      seed: "drop-bank",
    });
    const second = selectTriggeredMedia({
      items: ["a", "b", "c", "d"],
      triggerTimes: [0.1, 0.2, 0.3, 0.4],
      tSec: 0.4,
      everyN: 1,
      selectionMode: "seeded-random",
      seed: "drop-bank",
    });

    expect(first).toEqual(second);
    expect(first.prevIdx).toBeGreaterThanOrEqual(0);
  });

  it("supports deterministic weighted-random collection selection", () => {
    const selection = selectTriggeredMedia({
      items: ["quiet", "hero", "accent"],
      triggerTimes: [0.1, 0.2, 0.3],
      tSec: 0.3,
      everyN: 1,
      selectionMode: "weighted-random",
      seed: "chorus",
      weights: [1, 20, 1],
    });

    expect(selection.currentItem).toBe("hero");
    expect(selection.prevItem).toBeTruthy();
  });

  it("falls back to seeded-random selection when weights are invalid or zero", () => {
    const weighted = selectTriggeredMedia({
      items: ["a", "b", "c", "d"],
      triggerTimes: [0.1, 0.2, 0.3, 0.4],
      tSec: 0.4,
      everyN: 1,
      selectionMode: "weighted-random",
      seed: "fallback-seed",
      weights: [Number.NaN, 0, -1],
    });
    const seeded = selectTriggeredMedia({
      items: ["a", "b", "c", "d"],
      triggerTimes: [0.1, 0.2, 0.3, 0.4],
      tSec: 0.4,
      everyN: 1,
      selectionMode: "seeded-random",
      seed: "fallback-seed",
    });

    expect(weighted.currentIdx).toBe(seeded.currentIdx);
    expect(weighted.prevIdx).toBe(seeded.prevIdx);
    expect(weighted.currentItem).toBe(seeded.currentItem);
    expect(weighted.prevItem).toBe(seeded.prevItem);
  });

  it("treats missing weights as zero and keeps positive defined weights eligible", () => {
    const selection = selectTriggeredMedia({
      items: ["first", "second", "third"],
      triggerTimes: [0.1, 0.2, 0.3],
      tSec: 0.3,
      everyN: 1,
      selectionMode: "weighted-random",
      seed: "short-weights",
      weights: [0, 5],
    });

    expect(selection.currentItem).toBe("second");
    expect(selection.prevItem).toBe("second");
  });
});
