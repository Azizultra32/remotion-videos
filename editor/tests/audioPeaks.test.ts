import { describe, it, expect } from "vitest";
import {
  extractPeaks,
  normalizePeaks,
  peakAbsMax,
} from "../src/utils/audioPeaks";

describe("extractPeaks", () => {
  it("returns an empty array for an empty channel", () => {
    const result = extractPeaks(new Float32Array(0), 256);
    expect(result.length).toBe(0);
  });

  // Float32Array values must be exactly representable in IEEE-754 32-bit;
  // powers-of-2 fractions are safe (0.25, 0.5, 0.75, ...) but decimals like
  // 0.1, 0.3 are lossy. Using exactly-representable inputs keeps assertions
  // honest without needing toBeCloseTo's tolerance.
  it("returns [min, max] per bucket for exactly one bucket", () => {
    const channel = new Float32Array([0.25, 0.5, -0.75, 0.5]);
    const result = extractPeaks(channel, 4);
    expect(Array.from(result)).toEqual([-0.75, 0.5]);
  });

  it("handles negative min and positive max", () => {
    const channel = new Float32Array([-0.875, -0.25, 0.25, 0.75]);
    const result = extractPeaks(channel, 4);
    expect(Array.from(result)).toEqual([-0.875, 0.75]);
  });

  it("produces interleaved [min,max,min,max,...] across multiple buckets", () => {
    const channel = new Float32Array([
      0.25, 0.5, // bucket 0
      -0.5, 0.75, // bucket 1
      -0.25, 0.875, // bucket 2
    ]);
    const result = extractPeaks(channel, 2);
    expect(Array.from(result)).toEqual([0.25, 0.5, -0.5, 0.75, -0.25, 0.875]);
  });

  it("drops a trailing partial bucket (truncates to whole buckets)", () => {
    // 5 samples, bucket=2 → 2 full buckets, drop the 5th sample
    const channel = new Float32Array([0.25, 0.5, 0.125, 0.375, 0.9375]);
    const result = extractPeaks(channel, 2);
    expect(Array.from(result)).toEqual([0.25, 0.5, 0.125, 0.375]);
  });

  it("throws on bucketSize <= 0", () => {
    expect(() => extractPeaks(new Float32Array(4), 0)).toThrow();
    expect(() => extractPeaks(new Float32Array(4), -1)).toThrow();
  });
});

describe("peakAbsMax", () => {
  it("returns the largest absolute value across interleaved peaks", () => {
    const peaks = new Float32Array([-0.5, 0.25, -0.875, 0.75]);
    expect(peakAbsMax(peaks)).toBe(0.875);
  });

  it("returns 0 for an empty array", () => {
    expect(peakAbsMax(new Float32Array(0))).toBe(0);
  });
});

describe("normalizePeaks", () => {
  it("scales so the largest absolute value is 1", () => {
    const peaks = new Float32Array([-0.25, 0.5]);
    const result = normalizePeaks(peaks);
    expect(Array.from(result)).toEqual([-0.5, 1]);
  });

  it("is a no-op when the peaks are already normalized", () => {
    const peaks = new Float32Array([-1, 1]);
    const result = normalizePeaks(peaks);
    expect(Array.from(result)).toEqual([-1, 1]);
  });

  it("returns input unchanged when peaks are all zero (avoids divide-by-zero)", () => {
    const peaks = new Float32Array([0, 0, 0, 0]);
    const result = normalizePeaks(peaks);
    expect(Array.from(result)).toEqual([0, 0, 0, 0]);
  });
});
