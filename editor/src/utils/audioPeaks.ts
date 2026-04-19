// Pre-computed-peaks helpers for the MC-style canvas waveform. Lifted from
// packages/core/src/media/AudioResourceManager.ts (MIT).
//
// Output layout: [min0, max0, min1, max1, ...] — one (min, max) pair per
// bucket of bucketSize samples from the source channel. Trailing partial
// buckets are discarded so every pair corresponds to bucketSize real samples.

export const extractPeaks = (
  channel: Float32Array,
  bucketSize: number,
): Float32Array => {
  if (bucketSize <= 0) {
    throw new Error(`extractPeaks: bucketSize must be > 0, got ${bucketSize}`);
  }
  const bucketCount = Math.floor(channel.length / bucketSize);
  const out = new Float32Array(bucketCount * 2);
  for (let b = 0; b < bucketCount; b++) {
    let min = Infinity;
    let max = -Infinity;
    const start = b * bucketSize;
    for (let i = 0; i < bucketSize; i++) {
      const v = channel[start + i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
};

export const peakAbsMax = (peaks: Float32Array): number => {
  let m = 0;
  for (let i = 0; i < peaks.length; i++) {
    const a = Math.abs(peaks[i]);
    if (a > m) m = a;
  }
  return m;
};

export const normalizePeaks = (peaks: Float32Array): Float32Array => {
  const m = peakAbsMax(peaks);
  if (m === 0 || m === 1) {
    // Already normalized or all-zero; return a copy with identical values
    // so callers can safely treat the result as independent.
    return new Float32Array(peaks);
  }
  const out = new Float32Array(peaks.length);
  const scale = 1 / m;
  for (let i = 0; i < peaks.length; i++) out[i] = peaks[i] * scale;
  return out;
};
