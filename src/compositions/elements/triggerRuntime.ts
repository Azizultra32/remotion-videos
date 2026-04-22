export type TriggerOn = "beats" | "downbeats" | "drops";

export type TriggerCollections = {
  beats: readonly number[];
  downbeats: readonly number[];
  drops: readonly number[];
};

type TriggerStateOptions = {
  triggerTimes: readonly number[];
  tSec: number;
  everyN: number;
  itemCount: number;
};

export type TriggerState = {
  passedTriggers: number;
  stepCount: number;
  lastNthTriggerAt: number | null;
  anchorSec: number;
  timeSinceAnchorSec: number;
  currentIdx: number;
  prevIdx: number;
};

export const selectTriggerTimes = (
  collections: TriggerCollections,
  triggerOn: TriggerOn,
): readonly number[] => {
  if (triggerOn === "beats") return collections.beats;
  if (triggerOn === "downbeats") return collections.downbeats;
  return collections.drops;
};

export const getTriggerState = ({
  triggerTimes,
  tSec,
  everyN,
  itemCount,
}: TriggerStateOptions): TriggerState => {
  let passedTriggers = 0;
  let lastNthTriggerAt: number | null = null;

  for (const triggerTime of triggerTimes) {
    if (triggerTime > tSec) break;
    passedTriggers += 1;
    if (passedTriggers % everyN === 0) {
      lastNthTriggerAt = triggerTime;
    }
  }

  const stepCount = Math.floor(passedTriggers / everyN);
  const anchorSec = lastNthTriggerAt ?? 0;

  return {
    passedTriggers,
    stepCount,
    lastNthTriggerAt,
    anchorSec,
    timeSinceAnchorSec: tSec - anchorSec,
    currentIdx: itemCount > 0 ? stepCount % itemCount : 0,
    prevIdx: itemCount > 0 && stepCount > 0 ? (stepCount - 1) % itemCount : -1,
  };
};

export const findLatestTriggerWithinTrail = ({
  triggerTimes,
  tSec,
  trailSec,
}: {
  triggerTimes: readonly number[];
  tSec: number;
  trailSec: number;
}): number | null => {
  let latestTrigger: number | null = null;

  for (const triggerTime of triggerTimes) {
    if (triggerTime > tSec) break;
    if (tSec - triggerTime <= trailSec) {
      latestTrigger = triggerTime;
    }
  }

  return latestTrigger;
};

export const collectRecentTriggerAges = ({
  triggerTimes,
  tSec,
  trailSec,
  limit,
}: {
  triggerTimes: readonly number[];
  tSec: number;
  trailSec: number;
  limit: number;
}): number[] => {
  const ages: number[] = [];

  for (const triggerTime of triggerTimes) {
    if (triggerTime > tSec) break;
    const age = tSec - triggerTime;
    if (age > trailSec) continue;
    ages.push(age);
    if (ages.length >= limit) break;
  }

  return ages;
};
