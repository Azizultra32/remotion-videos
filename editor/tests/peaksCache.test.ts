import { describe, it, expect, beforeEach } from "vitest";
import {
  encodePeaks,
  decodePeaks,
  saveCachedPeaks,
  loadCachedPeaks,
  cachedPeaksKey,
} from "../src/utils/peaksCache";

beforeEach(() => {
  const bag: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (k: string) => bag[k] ?? null,
    setItem: (k: string, v: string) => {
      bag[k] = String(v);
    },
    removeItem: (k: string) => {
      delete bag[k];
    },
    clear: () => {
      for (const k of Object.keys(bag)) delete bag[k];
    },
    key: (i: number) => Object.keys(bag)[i] ?? null,
    get length() {
      return Object.keys(bag).length;
    },
  } as Storage;
});

describe("cachedPeaksKey", () => {
  it("prefixes the URL with the versioned namespace", () => {
    expect(cachedPeaksKey("/api/projects/foo/audio.mp3")).toBe(
      "peaks:v1:/api/projects/foo/audio.mp3",
    );
  });
});

describe("encodePeaks / decodePeaks", () => {
  it("round-trips a small Float32Array byte-for-byte", () => {
    const input = new Float32Array([0, 0.25, -0.5, 0.75, -1, 1]);
    const b64 = encodePeaks(input);
    expect(typeof b64).toBe("string");
    const output = decodePeaks(b64);
    expect(output.length).toBe(input.length);
    for (let i = 0; i < input.length; i++) {
      expect(output[i]).toBe(input[i]);
    }
  });

  it("round-trips a realistic-size array (8192 entries)", () => {
    const input = new Float32Array(8192);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin(i) * 0.75;
    }
    const out = decodePeaks(encodePeaks(input));
    expect(out.length).toBe(input.length);
    for (let i = 0; i < input.length; i++) {
      expect(out[i]).toBe(input[i]);
    }
  });

  it("decodePeaks returns an empty array for an empty string", () => {
    const out = decodePeaks("");
    expect(out.length).toBe(0);
  });
});

describe("saveCachedPeaks / loadCachedPeaks", () => {
  it("returns null when nothing is cached for the url", () => {
    expect(loadCachedPeaks("/api/projects/foo/audio.mp3")).toBeNull();
  });

  it("round-trips peaks + duration through localStorage", () => {
    const peaks = new Float32Array([0.1, 0.25, -0.5, 0.75]);
    saveCachedPeaks("/api/projects/foo/audio.mp3", peaks, 42.5);
    const loaded = loadCachedPeaks("/api/projects/foo/audio.mp3");
    expect(loaded).not.toBeNull();
    if (!loaded) throw new Error("unreachable");
    expect(loaded.duration).toBe(42.5);
    expect(loaded.peaks.length).toBe(4);
    expect(Array.from(loaded.peaks)).toEqual([
      0.10000000149011612,
      0.25,
      -0.5,
      0.75,
    ]);
  });

  it("different urls have independent caches", () => {
    const a = new Float32Array([0.25]);
    const b = new Float32Array([-0.5]);
    saveCachedPeaks("/a.mp3", a, 1);
    saveCachedPeaks("/b.mp3", b, 2);
    expect(loadCachedPeaks("/a.mp3")?.duration).toBe(1);
    expect(loadCachedPeaks("/b.mp3")?.duration).toBe(2);
  });

  it("returns null when stored JSON is corrupt", () => {
    localStorage.setItem(cachedPeaksKey("/bad.mp3"), "{not json");
    expect(loadCachedPeaks("/bad.mp3")).toBeNull();
  });

  it("saveCachedPeaks swallows quota errors silently", () => {
    const originalSet = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() =>
      saveCachedPeaks("/x.mp3", new Float32Array([0.1]), 1),
    ).not.toThrow();
    localStorage.setItem = originalSet;
  });
});
