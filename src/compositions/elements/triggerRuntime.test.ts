import { describe, expect, it } from "vitest";
import {
  collectRecentTriggerAges,
  findLatestTriggerWithinTrail,
  getTriggerState,
  selectTriggerTimes,
  type TriggerCollections,
} from "./triggerRuntime";

const collections: TriggerCollections = {
  beats: [0.25, 0.5, 0.75, 1.0],
  downbeats: [0.5, 1.0],
  drops: [1.5],
};

describe("triggerRuntime", () => {
  describe("selectTriggerTimes", () => {
    it("returns the requested trigger collection", () => {
      expect(selectTriggerTimes(collections, "beats")).toEqual(collections.beats);
      expect(selectTriggerTimes(collections, "downbeats")).toEqual(collections.downbeats);
      expect(selectTriggerTimes(collections, "drops")).toEqual(collections.drops);
    });
  });

  describe("getTriggerState", () => {
    it("returns the pre-trigger baseline before the first qualifying trigger", () => {
      expect(
        getTriggerState({
          triggerTimes: collections.beats,
          tSec: 0.1,
          everyN: 2,
          itemCount: 3,
        }),
      ).toEqual({
        passedTriggers: 0,
        stepCount: 0,
        lastNthTriggerAt: null,
        anchorSec: 0,
        timeSinceAnchorSec: 0.1,
        currentIdx: 0,
        prevIdx: -1,
      });
    });

    it("keeps the anchor at zero until the first qualifying every-N trigger lands", () => {
      expect(
        getTriggerState({
          triggerTimes: collections.beats,
          tSec: 0.3,
          everyN: 2,
          itemCount: 3,
        }),
      ).toEqual({
        passedTriggers: 1,
        stepCount: 0,
        lastNthTriggerAt: null,
        anchorSec: 0,
        timeSinceAnchorSec: 0.3,
        currentIdx: 0,
        prevIdx: -1,
      });
    });

    it("tracks every-N stepping and current/previous indices", () => {
      const state = getTriggerState({
        triggerTimes: collections.beats,
        tSec: 0.55,
        everyN: 2,
        itemCount: 3,
      });

      expect(state).toMatchObject({
        passedTriggers: 2,
        stepCount: 1,
        lastNthTriggerAt: 0.5,
        anchorSec: 0.5,
        currentIdx: 1,
        prevIdx: 0,
      });
      expect(state.timeSinceAnchorSec).toBeCloseTo(0.05);
    });

    it("counts a trigger that lands exactly on tSec and resets age at the anchor", () => {
      expect(
        getTriggerState({
          triggerTimes: collections.beats,
          tSec: 0.5,
          everyN: 2,
          itemCount: 3,
        }),
      ).toEqual({
        passedTriggers: 2,
        stepCount: 1,
        lastNthTriggerAt: 0.5,
        anchorSec: 0.5,
        timeSinceAnchorSec: 0,
        currentIdx: 1,
        prevIdx: 0,
      });
    });

    it("wraps indices across the item list", () => {
      const state = getTriggerState({
        triggerTimes: collections.beats,
        tSec: 1.1,
        everyN: 1,
        itemCount: 3,
      });

      expect(state).toMatchObject({
        passedTriggers: 4,
        stepCount: 4,
        lastNthTriggerAt: 1,
        anchorSec: 1,
        currentIdx: 1,
        prevIdx: 0,
      });
      expect(state.timeSinceAnchorSec).toBeCloseTo(0.1);
    });

    it("keeps a null lastNthTriggerAt while preserving anchor-at-zero semantics", () => {
      const state = getTriggerState({
        triggerTimes: [],
        tSec: 0.8,
        everyN: 4,
        itemCount: 2,
      });

      expect(state.lastNthTriggerAt).toBeNull();
      expect(state.anchorSec).toBe(0);
      expect(state.timeSinceAnchorSec).toBe(0.8);
      expect(state.currentIdx).toBe(0);
      expect(state.prevIdx).toBe(-1);
    });

    it("returns zero indices when there is no item list", () => {
      expect(
        getTriggerState({
          triggerTimes: collections.beats,
          tSec: 0.8,
          everyN: 1,
          itemCount: 0,
        }),
      ).toMatchObject({
        currentIdx: 0,
        prevIdx: -1,
      });
    });
  });

  describe("findLatestTriggerWithinTrail", () => {
    it("returns null when no trigger falls within the trail window", () => {
      expect(
        findLatestTriggerWithinTrail({
          triggerTimes: collections.beats,
          tSec: 1.6,
          trailSec: 0.2,
        }),
      ).toBeNull();
    });

    it("returns the latest trigger at or before the current time within the trail", () => {
      expect(
        findLatestTriggerWithinTrail({
          triggerTimes: collections.beats,
          tSec: 0.8,
          trailSec: 0.2,
        }),
      ).toBe(0.75);
    });
  });

  describe("collectRecentTriggerAges", () => {
    it("collects trigger ages in ascending trigger order within the trail", () => {
      const ages = collectRecentTriggerAges({
        triggerTimes: collections.beats,
        tSec: 0.9,
        trailSec: 0.45,
        limit: 16,
      });

      expect(ages).toHaveLength(2);
      expect(ages[0]).toBeCloseTo(0.4);
      expect(ages[1]).toBeCloseTo(0.15);
    });

    it("respects the requested limit", () => {
      const ages = collectRecentTriggerAges({
        triggerTimes: collections.beats,
        tSec: 1.1,
        trailSec: 1,
        limit: 2,
      });

      expect(ages).toHaveLength(2);
      expect(ages[0]).toBeCloseTo(0.35);
      expect(ages[1]).toBeCloseTo(0.1);
    });

    it("returns an empty list when limit is zero", () => {
      expect(
        collectRecentTriggerAges({
          triggerTimes: collections.beats,
          tSec: 1.1,
          trailSec: 1,
          limit: 0,
        }),
      ).toEqual([]);
    });
  });
});
