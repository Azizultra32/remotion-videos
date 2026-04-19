// Pure math for a zoom/pan timeline viewport. Lifted from the coordinate
// model in motion-canvas/packages/ui/src/components/timeline/Timeline.tsx —
// their point-anchored zoom keeps the time under the cursor fixed as
// zoom changes, which is the "feels right" UX.

export const pixelsToSeconds = (
  px: number,
  offsetSec: number,
  secPerPx: number,
): number => offsetSec + px * secPerPx;

export const secondsToPixels = (
  sec: number,
  offsetSec: number,
  secPerPx: number,
): number => (sec - offsetSec) / secPerPx;

type AnchoredZoomArgs = {
  currentSecPerPx: number;
  currentOffsetSec: number;
  zoomFactor: number; // > 1 zooms IN (smaller sec/px); < 1 zooms OUT
  anchorPx: number;
  minSecPerPx?: number;
  maxSecPerPx?: number;
};

export const anchoredZoom = ({
  currentSecPerPx,
  currentOffsetSec,
  zoomFactor,
  anchorPx,
  minSecPerPx,
  maxSecPerPx,
}: AnchoredZoomArgs): { secPerPx: number; offsetSec: number } => {
  const anchorSec = currentOffsetSec + anchorPx * currentSecPerPx;
  let secPerPx = currentSecPerPx / zoomFactor;
  if (minSecPerPx !== undefined) secPerPx = Math.max(secPerPx, minSecPerPx);
  if (maxSecPerPx !== undefined) secPerPx = Math.min(secPerPx, maxSecPerPx);
  const offsetSec = anchorSec - anchorPx * secPerPx;
  return { secPerPx, offsetSec };
};

type ClampArgs = {
  offsetSec: number;
  secPerPx: number;
  containerPx: number;
  totalSec: number;
};

export const clampViewport = ({
  offsetSec,
  secPerPx,
  containerPx,
  totalSec,
}: ClampArgs): number => {
  const visibleSec = containerPx * secPerPx;
  if (visibleSec >= totalSec) return 0;
  const maxOffset = totalSec - visibleSec;
  return Math.max(0, Math.min(maxOffset, offsetSec));
};
