// localStorage peaks cache. First load decodes the audio and extracts peaks
// (~1–2s for 8MB mp3); subsequent loads restore the cached Float32Array
// from base64-encoded bytes and skip the whole decode path.
//
// Key: "peaks:v1:<audioUrl>"  |  Value: JSON({ duration, peaks: b64 })

const STORAGE_PREFIX = "peaks:v1:";

export const cachedPeaksKey = (audioUrl: string): string => STORAGE_PREFIX + audioUrl;

// btoa/atob choke on very large strings if built via spread; chunk to stay
// under the argument-count cap.
const BTOA_CHUNK = 0x8000;

export const encodePeaks = (peaks: Float32Array): string => {
  if (peaks.length === 0) return "";
  const bytes = new Uint8Array(peaks.buffer, peaks.byteOffset, peaks.byteLength);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += BTOA_CHUNK) {
    parts.push(
      String.fromCharCode.apply(null, bytes.subarray(i, i + BTOA_CHUNK) as unknown as number[]),
    );
  }
  return btoa(parts.join(""));
};

export const decodePeaks = (b64: string): Float32Array => {
  if (!b64) return new Float32Array(0);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const buf = bytes.buffer.slice(0);
  return new Float32Array(buf);
};

type CachedEntry = { duration: number; peaks: string };

export const loadCachedPeaks = (
  audioUrl: string,
): { peaks: Float32Array; duration: number } | null => {
  try {
    const raw = localStorage.getItem(cachedPeaksKey(audioUrl));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedEntry;
    if (typeof entry.duration !== "number" || typeof entry.peaks !== "string") {
      return null;
    }
    return { peaks: decodePeaks(entry.peaks), duration: entry.duration };
  } catch {
    return null;
  }
};

export const saveCachedPeaks = (audioUrl: string, peaks: Float32Array, duration: number): void => {
  try {
    const entry: CachedEntry = { duration, peaks: encodePeaks(peaks) };
    localStorage.setItem(cachedPeaksKey(audioUrl), JSON.stringify(entry));
  } catch {
    // quota exceeded — cache is a perf hint, not correctness
  }
};
