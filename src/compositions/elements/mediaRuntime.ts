import type { CSSProperties } from "react";
import { clamp01 } from "./_helpers";

type FadeOpacityOptions = {
  localSec: number;
  durationSec: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  baseOpacity?: number;
  preventFadeOverlap?: boolean;
};

type PercentBoxStyleOptions = {
  x: number;
  y: number;
  widthPct: number;
  heightPct: number;
  pointerEventsNone?: boolean;
  overflowHidden?: boolean;
  opacity?: number;
};

export const getElementFadeOpacity = ({
  localSec,
  durationSec,
  fadeInSec = 0,
  fadeOutSec = 0,
  baseOpacity = 1,
  preventFadeOverlap = false,
}: FadeOpacityOptions): number => {
  const safeFadeInSec = Math.max(0, fadeInSec);
  const safeFadeOutSec = Math.max(0, fadeOutSec);
  const safeDurationSec = Math.max(0, durationSec);

  const fadeInOpacity =
    safeFadeInSec <= 0
      ? 1
      : clamp01(localSec / Math.max(0.0001, safeFadeInSec));

  const rawFadeOutStartSec = Math.max(0, safeDurationSec - safeFadeOutSec);
  const fadeOutStartSec = preventFadeOverlap
    ? Math.max(safeFadeInSec, rawFadeOutStartSec)
    : rawFadeOutStartSec;

  let fadeOutOpacity = 1;
  if (safeFadeOutSec > 0) {
    if (localSec >= safeDurationSec) {
      fadeOutOpacity = 0;
    } else if (localSec > fadeOutStartSec) {
      const fadeOutSpanSec = Math.max(0.0001, safeDurationSec - fadeOutStartSec);
      fadeOutOpacity = clamp01(
        1 - (localSec - fadeOutStartSec) / fadeOutSpanSec,
      );
    }
  }

  return clamp01(fadeInOpacity * fadeOutOpacity * clamp01(baseOpacity));
};

export const getPercentBoxStyle = ({
  x,
  y,
  widthPct,
  heightPct,
  pointerEventsNone = true,
  overflowHidden = false,
  opacity,
}: PercentBoxStyleOptions): CSSProperties => ({
  position: "absolute",
  left: `${x - widthPct / 2}%`,
  top: `${y - heightPct / 2}%`,
  width: `${widthPct}%`,
  height: `${heightPct}%`,
  ...(pointerEventsNone ? { pointerEvents: "none" } : {}),
  ...(overflowHidden ? { overflow: "hidden" } : {}),
  ...(opacity == null ? {} : { opacity }),
});

export const getFillMediaStyle = (
  objectFit?: CSSProperties["objectFit"],
): CSSProperties => ({
  width: "100%",
  height: "100%",
  ...(objectFit ? { objectFit } : {}),
});

export const secondsToStartFrame = (seconds: number, fps: number): number =>
  Math.max(0, Math.round(seconds * fps));
