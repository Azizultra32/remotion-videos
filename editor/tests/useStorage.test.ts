import { describe, it, expect, beforeEach } from "vitest";
import { storageGet, storageSet, storageClear } from "../src/hooks/useStorage";

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

describe("useStorage · pure helpers", () => {
  it("storageGet returns fallback when key is absent", () => {
    expect(storageGet("zoom", 1)).toBe(1);
  });

  it("storageSet → storageGet round-trips a number", () => {
    storageSet("zoom", 2.5);
    expect(storageGet("zoom", 1)).toBe(2.5);
  });

  it("storageSet → storageGet round-trips an object", () => {
    storageSet("panel", { collapsed: true, width: 320 });
    expect(storageGet("panel", { collapsed: false, width: 0 })).toEqual({
      collapsed: true,
      width: 320,
    });
  });

  it("scope prefixes the key so different projects do not collide", () => {
    storageSet("zoom", 2, "track-a");
    storageSet("zoom", 5, "track-b");
    expect(storageGet("zoom", 1, "track-a")).toBe(2);
    expect(storageGet("zoom", 1, "track-b")).toBe(5);
  });

  it("storageGet returns fallback when stored JSON is corrupt", () => {
    localStorage.setItem("zoom", "{not json");
    expect(storageGet("zoom", 99)).toBe(99);
  });

  it("storageClear removes a scoped key", () => {
    storageSet("zoom", 3, "track-a");
    storageClear("zoom", "track-a");
    expect(storageGet("zoom", 1, "track-a")).toBe(1);
  });
});
