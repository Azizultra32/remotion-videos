import { getTriggerState } from "./triggerRuntime";

export type MediaSelectionMode = "sequence" | "seeded-random" | "weighted-random";

export type TriggeredMediaSelection<T> = {
  currentIdx: number;
  prevIdx: number;
  currentItem: T | null;
  prevItem: T | null;
  anchorSec: number;
  timeSinceAnchorSec: number;
};

const hashString32 = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const getSeededUnit = (seed: string, step: number): number => {
  const hash = hashString32(`${seed}:${step}`);
  return hash / 0xffffffff;
};

const getWeightedIndex = ({
  unit,
  itemCount,
  weights,
}: {
  unit: number;
  itemCount: number;
  weights: readonly number[];
}): number => {
  const normalized = Array.from({ length: itemCount }, (_, idx) => {
    const raw = weights[idx];
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  });
  const total = normalized.reduce((sum, weight) => sum + weight, 0);

  if (total <= 0) {
    return Math.min(itemCount - 1, Math.floor(unit * itemCount));
  }

  let threshold = unit * total;
  for (let idx = 0; idx < normalized.length; idx += 1) {
    threshold -= normalized[idx] ?? 0;
    if (threshold <= 0) return idx;
  }

  return Math.max(0, itemCount - 1);
};

const getSelectionIndex = ({
  itemCount,
  stepCount,
  selectionMode,
  seed,
  weights,
}: {
  itemCount: number;
  stepCount: number;
  selectionMode: MediaSelectionMode;
  seed: string;
  weights: readonly number[];
}): number => {
  if (itemCount <= 0 || stepCount <= 0) return 0;
  if (selectionMode === "sequence") return stepCount % itemCount;

  const unit = getSeededUnit(seed, stepCount);
  if (selectionMode === "seeded-random") {
    return Math.min(itemCount - 1, Math.floor(unit * itemCount));
  }

  return getWeightedIndex({
    unit,
    itemCount,
    weights,
  });
};

export const selectTriggeredMedia = <T>({
  items,
  triggerTimes,
  tSec,
  everyN,
  selectionMode = "sequence",
  seed = "",
  weights = [],
}: {
  items: readonly T[];
  triggerTimes: readonly number[];
  tSec: number;
  everyN: number;
  selectionMode?: MediaSelectionMode;
  seed?: string;
  weights?: readonly number[];
}): TriggeredMediaSelection<T> => {
  const state = getTriggerState({
    triggerTimes,
    tSec,
    everyN,
    itemCount: items.length,
  });
  const currentIdx = getSelectionIndex({
    itemCount: items.length,
    stepCount: state.stepCount,
    selectionMode,
    seed,
    weights,
  });
  const prevIdx =
    items.length > 0 && state.stepCount > 0
      ? getSelectionIndex({
          itemCount: items.length,
          stepCount: state.stepCount - 1,
          selectionMode,
          seed,
          weights,
        })
      : -1;

  return {
    currentIdx,
    prevIdx,
    currentItem: items[currentIdx] ?? null,
    prevItem: prevIdx >= 0 ? (items[prevIdx] ?? null) : null,
    anchorSec: state.anchorSec,
    timeSinceAnchorSec: state.timeSinceAnchorSec,
  };
};
