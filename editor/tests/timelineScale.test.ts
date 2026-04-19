import { describe, it, expect } from "vitest";
import {
  pixelsToSeconds,
  secondsToPixels,
  anchoredZoom,
  clampViewport,
} from "../src/utils/timelineScale";

describe("pixelsToSeconds", () => {
  it("is the identity when offset=0, secPerPx=1", () => {
    expect(pixelsToSeconds(0, 0, 1)).toBe(0);
    expect(pixelsToSeconds(100, 0, 1)).toBe(100);
  });

  it("scales by secPerPx", () => {
    expect(pixelsToSeconds(100, 0, 0.5)).toBe(50);
  });

  it("adds the offset", () => {
    expect(pixelsToSeconds(20, 5, 0.5)).toBe(15);
  });
});

describe("secondsToPixels", () => {
  it("is the inverse of pixelsToSeconds", () => {
    for (const secPerPx of [0.01, 0.1, 0.5, 1, 10]) {
      for (const offset of [0, 5.5, 120]) {
        for (const px of [0, 50, 1000]) {
          const sec = pixelsToSeconds(px, offset, secPerPx);
          expect(secondsToPixels(sec, offset, secPerPx)).toBeCloseTo(px, 9);
        }
      }
    }
  });
});

describe("anchoredZoom", () => {
  it("zooms in by a factor while keeping anchor time under the cursor", () => {
    const before = { currentSecPerPx: 1, currentOffsetSec: 10, zoomFactor: 2, anchorPx: 100 };
    const anchorSec = before.currentOffsetSec + before.anchorPx * before.currentSecPerPx;
    const { secPerPx, offsetSec } = anchoredZoom(before);
    expect(secPerPx).toBe(0.5);
    // After zoom, pixel 100 should still map to anchorSec
    expect(offsetSec + 100 * secPerPx).toBeCloseTo(anchorSec, 9);
  });

  it("zooms out (zoomFactor < 1) while keeping anchor under cursor", () => {
    const before = { currentSecPerPx: 0.1, currentOffsetSec: 20, zoomFactor: 0.5, anchorPx: 50 };
    const anchorSec = before.currentOffsetSec + before.anchorPx * before.currentSecPerPx;
    const { secPerPx, offsetSec } = anchoredZoom(before);
    expect(secPerPx).toBe(0.2);
    expect(offsetSec + 50 * secPerPx).toBeCloseTo(anchorSec, 9);
  });

  it("clamps secPerPx to minSecPerPx when provided", () => {
    const { secPerPx } = anchoredZoom({
      currentSecPerPx: 0.1,
      currentOffsetSec: 0,
      zoomFactor: 100, // would want 0.001, clamp stops it
      anchorPx: 0,
      minSecPerPx: 0.01,
    });
    expect(secPerPx).toBe(0.01);
  });

  it("clamps secPerPx to maxSecPerPx when provided", () => {
    const { secPerPx } = anchoredZoom({
      currentSecPerPx: 1,
      currentOffsetSec: 0,
      zoomFactor: 0.1, // would want 10, clamp stops it
      anchorPx: 0,
      maxSecPerPx: 2,
    });
    expect(secPerPx).toBe(2);
  });
});

describe("clampViewport", () => {
  it("no-op when viewport fits entirely within [0, totalSec]", () => {
    expect(clampViewport({ offsetSec: 5, secPerPx: 0.1, containerPx: 100, totalSec: 60 })).toBe(5);
  });

  it("clamps negative offset to 0", () => {
    expect(clampViewport({ offsetSec: -3, secPerPx: 0.1, containerPx: 100, totalSec: 60 })).toBe(0);
  });

  it("clamps offset so the right edge sits at totalSec", () => {
    // visible range = containerPx * secPerPx = 10s. totalSec = 60. max offset = 50.
    expect(clampViewport({ offsetSec: 999, secPerPx: 0.1, containerPx: 100, totalSec: 60 })).toBe(50);
  });

  it("when visible range exceeds totalSec, offset is 0", () => {
    expect(clampViewport({ offsetSec: 999, secPerPx: 10, containerPx: 100, totalSec: 60 })).toBe(0);
  });
});
