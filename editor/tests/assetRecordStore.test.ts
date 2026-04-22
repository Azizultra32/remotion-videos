// editor/tests/assetRecordStore.test.ts
//
// Unit tests for the asset registry persistence layer (Phase 1).
// Covers ID generation, registry read/write, lookup helpers, and dual-mode
// resolver. Mocks fetch calls to avoid sidecar dependency.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateAssetId, isValidAssetId } from "../src/types/assetRecord";
import type { AssetRecord, AssetRegistryFile } from "../src/types/assetRecord";
import {
  loadAssetRegistry,
  saveAssetRegistry,
  findAssetByPath,
  findAssetById,
  resolveAssetPath,
} from "../src/lib/assetRecordStore";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mkRecord = (overrides: Partial<AssetRecord> = {}): AssetRecord => ({
  id: overrides.id ?? generateAssetId("default/path.png"),
  path: overrides.path ?? "default/path.png",
  kind: overrides.kind ?? "image",
  scope: overrides.scope ?? "project",
  stem: overrides.stem ?? "test-stem",
  sizeBytes: overrides.sizeBytes ?? 1024,
  mtimeMs: overrides.mtimeMs ?? Date.now(),
  createdAt: overrides.createdAt ?? Date.now(),
  updatedAt: overrides.updatedAt ?? Date.now(),
  metadata: overrides.metadata ?? {},
  label: overrides.label,
  tags: overrides.tags,
  notes: overrides.notes,
});

// ---------------------------------------------------------------------------
// 1. ID Generation
// ---------------------------------------------------------------------------

describe("generateAssetId", () => {
  it("generates deterministic IDs for the same path", () => {
    const id1 = generateAssetId("assets/logo.png");
    const id2 = generateAssetId("assets/logo.png");
    expect(id1).toBe(id2);
  });

  it("generates different IDs for different paths", () => {
    const id1 = generateAssetId("assets/logo.png");
    const id2 = generateAssetId("assets/banner.png");
    expect(id1).not.toBe(id2);
  });

  it("generates IDs in the correct format (ast_[0-9a-f]{16})", () => {
    const id = generateAssetId("some/path.jpg");
    expect(id).toMatch(/^ast_[0-9a-f]{16}$/);
  });

  it("prefix is always 'ast_'", () => {
    const id = generateAssetId("any/file.gif");
    expect(id.startsWith("ast_")).toBe(true);
  });

  it("hash portion is exactly 16 characters", () => {
    const id = generateAssetId("test.png");
    const hashPart = id.slice(4); // strip "ast_"
    expect(hashPart.length).toBe(16);
    expect(/^[0-9a-f]{16}$/.test(hashPart)).toBe(true);
  });
});

describe("isValidAssetId", () => {
  it("returns true for valid asset IDs", () => {
    expect(isValidAssetId("ast_0123456789abcdef")).toBe(true);
    expect(isValidAssetId("ast_fedcba9876543210")).toBe(true);
  });

  it("returns false for IDs with invalid prefix", () => {
    expect(isValidAssetId("img_0123456789abcdef")).toBe(false);
    expect(isValidAssetId("0123456789abcdef")).toBe(false);
  });

  it("returns false for IDs with invalid hash length", () => {
    expect(isValidAssetId("ast_123")).toBe(false);
    expect(isValidAssetId("ast_0123456789abcdef0")).toBe(false);
  });

  it("returns false for IDs with non-hex characters", () => {
    expect(isValidAssetId("ast_0123456789abcdeg")).toBe(false);
    expect(isValidAssetId("ast_0123456789ABCDEF")).toBe(false); // uppercase not allowed
  });

  it("returns false for arbitrary strings", () => {
    expect(isValidAssetId("assets/logo.png")).toBe(false);
    expect(isValidAssetId("")).toBe(false);
    expect(isValidAssetId("ast_")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Registry Read/Write
// ---------------------------------------------------------------------------

describe("loadAssetRegistry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads empty registry when file doesn't exist (404)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const records = await loadAssetRegistry("test-stem");
    expect(records).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith("/api/assets/registry/test-stem");
  });

  it("loads and parses registry with records", async () => {
    const record1 = mkRecord({ id: generateAssetId("a.png"), path: "a.png" });
    const record2 = mkRecord({ id: generateAssetId("b.jpg"), path: "b.jpg" });
    const registry: AssetRegistryFile = {
      version: 1,
      records: [record1, record2],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => registry,
    });

    const records = await loadAssetRegistry("test-stem");
    expect(records).toHaveLength(2);
    expect(records[0].id).toBe(record1.id);
    expect(records[1].id).toBe(record2.id);
  });

  it("returns empty array on network error", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("network timeout"));

    const records = await loadAssetRegistry("test-stem");
    expect(records).toEqual([]);
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load asset registry"),
      expect.any(Error)
    );

    consoleWarn.mockRestore();
  });

  it("returns empty array and warns on non-404 HTTP errors", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const records = await loadAssetRegistry("test-stem");
    expect(records).toEqual([]);
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load asset registry"),
      expect.any(Error)
    );

    consoleWarn.mockRestore();
  });

  it("handles registry with no records field gracefully", async () => {
    // Malformed response: version present but records missing
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ version: 1 }),
    });

    const records = await loadAssetRegistry("test-stem");
    expect(records).toEqual([]);
  });
});

describe("saveAssetRegistry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes empty registry successfully", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    await saveAssetRegistry("test-stem", []);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assets/registry/test-stem",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, records: [] }),
      })
    );
  });

  it("writes registry with records", async () => {
    const record = mkRecord({ id: generateAssetId("test.png"), path: "test.png" });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    await saveAssetRegistry("test-stem", [record]);

    const calls = fetchMock.mock.calls;
    expect(calls).toHaveLength(1);
    const [url, options] = calls[0];
    expect(url).toBe("/api/assets/registry/test-stem");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.version).toBe(1);
    expect(body.records).toHaveLength(1);
    expect(body.records[0].id).toBe(record.id);
  });

  it("throws on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });

    await expect(saveAssetRegistry("test-stem", [])).rejects.toThrow(
      "Failed to save asset registry: Bad Request"
    );
  });

  it("preserves all record fields in round-trip", async () => {
    const record = mkRecord({
      id: generateAssetId("full.png"),
      path: "full.png",
      kind: "image",
      scope: "global",
      stem: "test-stem",
      sizeBytes: 2048,
      mtimeMs: 1234567890,
      createdAt: 1111111111,
      updatedAt: 2222222222,
      metadata: { width: 1920, height: 1080 },
      label: "Test Image",
      tags: ["tag1", "tag2"],
      notes: "Important asset",
    });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    await saveAssetRegistry("test-stem", [record]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const savedRecord = body.records[0];

    expect(savedRecord.id).toBe(record.id);
    expect(savedRecord.path).toBe(record.path);
    expect(savedRecord.kind).toBe(record.kind);
    expect(savedRecord.scope).toBe(record.scope);
    expect(savedRecord.stem).toBe(record.stem);
    expect(savedRecord.sizeBytes).toBe(record.sizeBytes);
    expect(savedRecord.mtimeMs).toBe(record.mtimeMs);
    expect(savedRecord.createdAt).toBe(record.createdAt);
    expect(savedRecord.updatedAt).toBe(record.updatedAt);
    expect(savedRecord.metadata).toEqual(record.metadata);
    expect(savedRecord.label).toBe(record.label);
    expect(savedRecord.tags).toEqual(record.tags);
    expect(savedRecord.notes).toBe(record.notes);
  });
});

// ---------------------------------------------------------------------------
// 3. Lookup Helpers
// ---------------------------------------------------------------------------

describe("findAssetByPath", () => {
  const record1 = mkRecord({ path: "assets/logo.png" });
  const record2 = mkRecord({ path: "assets/banner.jpg" });
  const records = [record1, record2];

  it("finds existing asset by path", () => {
    const result = findAssetByPath(records, "assets/logo.png");
    expect(result).toBe(record1);
  });

  it("returns null for missing path", () => {
    const result = findAssetByPath(records, "assets/missing.png");
    expect(result).toBeNull();
  });

  it("returns null for empty registry", () => {
    const result = findAssetByPath([], "any/path.png");
    expect(result).toBeNull();
  });

  it("matches exact path only (case-sensitive)", () => {
    const result = findAssetByPath(records, "assets/LOGO.png");
    expect(result).toBeNull();
  });

  it("returns first match when duplicates exist", () => {
    const dup1 = mkRecord({ path: "dup.png", id: generateAssetId("dup1") });
    const dup2 = mkRecord({ path: "dup.png", id: generateAssetId("dup2") });
    const result = findAssetByPath([dup1, dup2], "dup.png");
    expect(result).toBe(dup1);
  });
});

describe("findAssetById", () => {
  const id1 = generateAssetId("a.png");
  const id2 = generateAssetId("b.jpg");
  const record1 = mkRecord({ id: id1, path: "a.png" });
  const record2 = mkRecord({ id: id2, path: "b.jpg" });
  const records = [record1, record2];

  it("finds existing asset by ID", () => {
    const result = findAssetById(records, id1);
    expect(result).toBe(record1);
  });

  it("returns null for unknown ID", () => {
    const unknownId = generateAssetId("unknown.png");
    const result = findAssetById(records, unknownId);
    expect(result).toBeNull();
  });

  it("returns null for empty registry", () => {
    const result = findAssetById([], id1);
    expect(result).toBeNull();
  });

  it("returns null for malformed ID", () => {
    // TypeScript allows passing any string to the function at runtime
    const result = findAssetById(records, "not-an-id" as any);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Dual-Mode Resolver
// ---------------------------------------------------------------------------

describe("resolveAssetPath", () => {
  const path1 = "assets/logo.png";
  const path2 = "assets/banner.jpg";
  const id1 = generateAssetId(path1);
  const id2 = generateAssetId(path2);
  const record1 = mkRecord({ id: id1, path: path1 });
  const record2 = mkRecord({ id: id2, path: path2 });
  const records = [record1, record2];

  it("resolves asset ID to path", () => {
    const result = resolveAssetPath(records, id1);
    expect(result).toBe(path1);
  });

  it("passes through legacy path string unchanged", () => {
    const legacyPath = "old/path/image.png";
    const result = resolveAssetPath(records, legacyPath);
    expect(result).toBe(legacyPath);
  });

  it("returns null for unknown asset ID", () => {
    const unknownId = generateAssetId("unknown.png");
    const result = resolveAssetPath(records, unknownId);
    expect(result).toBeNull();
  });

  it("passes through empty string as legacy path", () => {
    const result = resolveAssetPath(records, "");
    expect(result).toBe("");
  });

  it("passes through relative paths as legacy paths", () => {
    const result = resolveAssetPath(records, "../somewhere/file.png");
    expect(result).toBe("../somewhere/file.png");
  });

  it("passes through absolute paths as legacy paths", () => {
    const result = resolveAssetPath(records, "/absolute/path.png");
    expect(result).toBe("/absolute/path.png");
  });

  it("resolves multiple asset IDs correctly", () => {
    expect(resolveAssetPath(records, id1)).toBe(path1);
    expect(resolveAssetPath(records, id2)).toBe(path2);
  });

  it("handles mixed ID and path lookups", () => {
    const legacyPath = "legacy/file.gif";
    expect(resolveAssetPath(records, id1)).toBe(path1);
    expect(resolveAssetPath(records, legacyPath)).toBe(legacyPath);
    expect(resolveAssetPath(records, id2)).toBe(path2);
  });

  it("distinguishes between asset ID and path that looks similar", () => {
    // A path that happens to start with "ast_" but isn't a valid ID
    const fakePath = "ast_not_a_valid_hash/file.png";
    const result = resolveAssetPath(records, fakePath);
    expect(result).toBe(fakePath); // passed through as legacy path
  });

  it("handles empty registry gracefully", () => {
    const unknownId = generateAssetId("test.png");
    expect(resolveAssetPath([], unknownId)).toBeNull();
    expect(resolveAssetPath([], "legacy/path.png")).toBe("legacy/path.png");
  });
});

// ---------------------------------------------------------------------------
// 7. End-to-End Render-Path Resolution
// ---------------------------------------------------------------------------
//
// Simulates the full chain: element prop contains asset ID → registry lookup
// → resolve to path → staticFile() call. This is the same logic performed
// by resolveStatic() in src/compositions/elements/_helpers.ts.

describe("end-to-end render-path resolution", () => {
  const path1 = "projects/test-stem/images/hero.png";
  const path2 = "projects/test-stem/videos/intro.mp4";
  const path3 = "assets/global/bg.jpg";
  const id1 = generateAssetId(path1);
  const id2 = generateAssetId(path2);
  const id3 = generateAssetId(path3);

  const records: AssetRecord[] = [
    mkRecord({ id: id1, path: path1, kind: "image" }),
    mkRecord({ id: id2, path: path2, kind: "video" }),
    mkRecord({ id: id3, path: path3, kind: "image", scope: "global", stem: null }),
  ];

  const mockStaticFile = (s: string) => `/static/${s}`;

  const resolveStatic = (
    src: string,
    sf: (s: string) => string,
    registry: Array<{ id: string; path: string }> | null | undefined,
  ): string => {
    if (src.startsWith("http") || src.startsWith("/")) return src;
    if (/^ast_[0-9a-f]{16}$/.test(src)) {
      if (!registry || registry.length === 0) return src;
      const record = registry.find((r) => r.id === src);
      if (!record) return src;
      return sf(record.path);
    }
    return sf(src);
  };

  it("resolves asset ID to staticFile URL via registry", () => {
    const result = resolveStatic(id1, mockStaticFile, records);
    expect(result).toBe(`/static/${path1}`);
  });

  it("resolves multiple asset IDs in sequence", () => {
    expect(resolveStatic(id1, mockStaticFile, records)).toBe(`/static/${path1}`);
    expect(resolveStatic(id2, mockStaticFile, records)).toBe(`/static/${path2}`);
    expect(resolveStatic(id3, mockStaticFile, records)).toBe(`/static/${path3}`);
  });

  it("passes through HTTP URLs without registry lookup", () => {
    expect(resolveStatic("https://cdn.example.com/img.png", mockStaticFile, records))
      .toBe("https://cdn.example.com/img.png");
  });

  it("passes through absolute paths without registry lookup", () => {
    expect(resolveStatic("/absolute/path.png", mockStaticFile, records))
      .toBe("/absolute/path.png");
  });

  it("falls back to staticFile for legacy relative paths", () => {
    expect(resolveStatic("assets/old-style.png", mockStaticFile, records))
      .toBe("/static/assets/old-style.png");
  });

  it("returns raw ID when registry is null", () => {
    expect(resolveStatic(id1, mockStaticFile, null)).toBe(id1);
  });

  it("returns raw ID when registry is empty", () => {
    expect(resolveStatic(id1, mockStaticFile, [])).toBe(id1);
  });

  it("returns raw ID when record not found in registry", () => {
    const unknownId = generateAssetId("nonexistent.png");
    expect(resolveStatic(unknownId, mockStaticFile, records)).toBe(unknownId);
  });

  it("handles multi-field element with mixed IDs and paths", () => {
    const elementProps = {
      imageSrc: id1,
      videos: [id2, "assets/legacy-clip.mp4"],
      label: "Test Element",
    };

    const resolved = {
      imageSrc: resolveStatic(elementProps.imageSrc, mockStaticFile, records),
      videos: elementProps.videos.map((v: string) => resolveStatic(v, mockStaticFile, records)),
      label: elementProps.label,
    };

    expect(resolved.imageSrc).toBe(`/static/${path1}`);
    expect(resolved.videos[0]).toBe(`/static/${path2}`);
    expect(resolved.videos[1]).toBe("/static/assets/legacy-clip.mp4");
    expect(resolved.label).toBe("Test Element");
  });
});
