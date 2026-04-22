export const getLinearTriggerDecay = ({
  lastTriggerAt,
  tSec,
  durationSec,
  peak = 1,
}: {
  lastTriggerAt: number | null;
  tSec: number;
  durationSec: number;
  peak?: number;
}): number => {
  if (lastTriggerAt == null || durationSec <= 0) return 0;
  const ageSec = tSec - lastTriggerAt;
  if (ageSec < 0 || ageSec >= durationSec) return 0;
  return peak * (1 - ageSec / durationSec);
};

export const getExponentialTriggerDecay = ({
  lastTriggerAt,
  tSec,
  decay,
  amplitude = 1,
  baseline = 0,
}: {
  lastTriggerAt: number | null;
  tSec: number;
  decay: number;
  amplitude?: number;
  baseline?: number;
}): number => {
  if (lastTriggerAt == null) return baseline;
  const ageSec = Math.max(0, tSec - lastTriggerAt);
  return baseline + amplitude * Math.exp(-decay * ageSec);
};
