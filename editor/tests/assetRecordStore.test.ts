import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as assetRecordStore from "../src/lib/assetRecordStore";
import {
  enrichAssetRecord,
  ensureAssetRecord,
  findAssetById,
  findAssetByPath,
  loadAssetRegistry,
  reconcileAssetRegistry,
  resolveAssetPath,
  saveAssetRegistry,
} from "../src/lib/assetRecordStore";
import { useEditorStore } from "../src/store";
import {
  type AssetRecord,
  type AssetRegistryFile,
  AssetRegistryFileSchema,
  type AssetRegistryFileV2,
  createAssetRecord,
  generateAssetId,
  generateCanonicalAssetId,
  isAssetId,
  isValidAssetId,
  normalizeAssetRecordV2,
  upgradeLegacyAssetId,
} from "../src/types/assetRecord";

const makeRecord = (overrides: Partial<AssetRecord> = {}): AssetRecord => ({
  id: overrides.id ?? generateCanonicalAssetId(),
  path: overrides.path ?? "projects/test/images/logo.png",
  pathHistory: overrides.pathHistory ?? [],
  kind: overrides.kind ?? "image",
  scope: overrides.scope ?? "project",
  stem: overrides.stem ?? "test-stem",
  status: overrides.status ?? "active",
  sizeBytes: overrides.sizeBytes ?? 1024,
  mtimeMs: overrides.mtimeMs ?? 1_700_000_000_000,
  createdAt: overrides.createdAt ?? 1_700_000_000_000,
  updatedAt: overrides.updatedAt ?? 1_700_000_000_000,
  metadata: overrides.metadata ?? { width: 1920, height: 1080 },
  ...(overrides.aliases ? { aliases: overrides.aliases } : {}),
  ...(overrides.missingSince !== undefined ? { missingSince: overrides.missingSince } : {}),
  ...(overrides.deletedAt !== undefined ? { deletedAt: overrides.deletedAt } : {}),
  ...(overrides.contentHash !== undefined ? { contentHash: overrides.contentHash } : {}),
  ...(overrides.hashVersion !== undefined ? { hashVersion: overrides.hashVersion } : {}),
  ...(overrides.label !== undefined ? { label: overrides.label } : {}),
  ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
  ...(overrides.notes !== undefined ? { notes: overrides.notes } : {}),
});

type EnsureAssetRecordInput = Parameters<typeof assetRecordStore.ensureAssetRecord>[1];
type EnrichAssetRecordInput = Parameters<typeof assetRecordStore.enrichAssetRecord>[1];

describe("asset id helpers", () => {
  it("keeps legacy path-hash ids stable", () => {
    const id1 = generateAssetId("assets/logo.png");
    const id2 = generateAssetId("assets/logo.png");

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^ast_[0-9a-f]{16}$/);
  });

  it("generates opaque canonical ids", () => {
    const id = generateCanonicalAssetId();

    expect(id).toMatch(/^ast_[0-9a-f]{32}$/);
    expect(id).not.toBe(generateCanonicalAssetId());
  });

  it("accepts both legacy and canonical ids", () => {
    expect(isAssetId("ast_0123456789abcdef")).toBe(true);
    expect(isAssetId("ast_0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isValidAssetId("ast_0123456789abcdef")).toBe(true);
    expect(isValidAssetId("ast_0123456789abcdef0123456789abcdef")).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(isAssetId("assets/logo.png")).toBe(false);
    expect(isAssetId("ast_123")).toBe(false);
    expect(isAssetId("ast_0123456789abcdeg")).toBe(false);
  });

  it("upgrades a legacy id into a canonical alias-preserving id", () => {
    const legacyId = generateAssetId("assets/logo.png");
    const upgraded = upgradeLegacyAssetId(legacyId);

    expect(upgraded).toMatch(/^ast_[0-9a-f]{32}$/);
    expect(upgraded).not.toBe(legacyId);
  });
});

describe("registry schema and normalization", () => {
  it("accepts both v1 and v2 registry files", () => {
    const legacyRecord = makeRecord({
      id: generateAssetId("assets/logo.png"),
      path: "assets/logo.png",
    });
    const canonicalRecord = normalizeAssetRecordV2(legacyRecord);

    const v1: AssetRegistryFile = { version: 1, records: [legacyRecord] };
    const v2: AssetRegistryFileV2 = { version: 2, records: [canonicalRecord] };

    expect(AssetRegistryFileSchema.safeParse(v1).success).toBe(true);
    expect(AssetRegistryFileSchema.safeParse(v2).success).toBe(true);
  });

  it("normalizes a legacy record into the v2 shape", () => {
    const legacyId = generateAssetId("assets/logo.png");
    const record = makeRecord({
      id: legacyId,
      path: "assets/logo.png",
      pathHistory: ["assets/old-logo.png", "assets/logo.png"],
      tags: ["branding"],
      notes: "legacy",
    });

    const normalized = normalizeAssetRecordV2(record);

    expect(normalized.id).toBe(upgradeLegacyAssetId(legacyId));
    expect(normalized.aliases).toEqual([legacyId]);
    expect(normalized.path).toBe("assets/logo.png");
    expect(normalized.pathHistory).toEqual(["assets/old-logo.png"]);
    expect(normalized.status).toBe("active");
    expect(normalized.tags).toEqual(["branding"]);
    expect(normalized.notes).toBe("legacy");
  });

  it("keeps canonical records canonical and dedupes aliases/history", () => {
    const canonicalId = generateCanonicalAssetId();
    const legacyAlias = generateAssetId("assets/logo.png");

    const normalized = normalizeAssetRecordV2(
      makeRecord({
        id: canonicalId,
        path: "projects/test/images/logo.png",
        pathHistory: [
          "projects/test/images/logo.png",
          "projects/test/assets/logo.png",
          "projects/test/assets/logo.png",
        ],
        aliases: [legacyAlias, legacyAlias],
        status: "missing",
        missingSince: 123,
      }),
    );

    expect(normalized.id).toBe(canonicalId);
    expect(normalized.aliases).toEqual([legacyAlias]);
    expect(normalized.pathHistory).toEqual(["projects/test/assets/logo.png"]);
    expect(normalized.status).toBe("missing");
    expect(normalized.missingSince).toBe(123);
  });

  it("createAssetRecord emits a canonical v2 record", () => {
    const record = createAssetRecord({
      path: "projects/test/videos/intro.mp4",
      kind: "video",
      scope: "project",
      stem: "test",
      sizeBytes: 2048,
      mtimeMs: 10,
      createdAt: 11,
      updatedAt: 12,
      metadata: { width: 1920, height: 1080, durationSec: 4.2 },
    });

    expect(record.id).toMatch(/^ast_[0-9a-f]{32}$/);
    expect(record.aliases?.[0]).toBe(generateAssetId("projects/test/videos/intro.mp4"));
    expect(record.pathHistory).toEqual([]);
    expect(record.status).toBe("active");
  });
});

describe("loadAssetRegistry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty registry for 404", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(loadAssetRegistry("test-stem")).resolves.toEqual([]);
  });

  it("normalizes v1 records when loading", async () => {
    const legacyRecord = makeRecord({
      id: generateAssetId("assets/logo.png"),
      path: "assets/logo.png",
      status: "active",
    });
    const responseBody: AssetRegistryFile = {
      version: 1,
      records: [legacyRecord],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => responseBody,
    });

    const records = await loadAssetRegistry("test-stem");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: upgradeLegacyAssetId(legacyRecord.id),
      path: "assets/logo.png",
      aliases: [legacyRecord.id],
      status: "active",
    });
  });

  it("preserves v2 records when loading", async () => {
    const canonicalRecord = makeRecord({
      id: generateCanonicalAssetId(),
      path: "projects/test/images/banner.png",
      aliases: [generateAssetId("assets/banner.png")],
      pathHistory: ["assets/banner.png"],
      status: "missing",
      missingSince: 99,
    });
    const responseBody: AssetRegistryFileV2 = {
      version: 2,
      records: [canonicalRecord],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => responseBody,
    });

    const records = await loadAssetRegistry("test-stem");

    expect(records).toEqual([canonicalRecord]);
  });

  it("throws on malformed registry payloads", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ version: 1 }),
    });

    await expect(loadAssetRegistry("test-stem")).rejects.toThrow("Invalid asset registry payload");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
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

  it("writes a normalized v2 registry payload", async () => {
    const legacyRecord = makeRecord({
      id: generateAssetId("assets/logo.png"),
      path: "assets/logo.png",
      pathHistory: ["assets/old-logo.png"],
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    await saveAssetRegistry("test-stem", [legacyRecord]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe("/api/assets/registry/test-stem");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(options.body as string) as AssetRegistryFileV2;
    expect(body.version).toBe(2);
    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({
      id: upgradeLegacyAssetId(legacyRecord.id),
      path: "assets/logo.png",
      aliases: [legacyRecord.id],
      pathHistory: ["assets/old-logo.png"],
      status: "active",
    });
  });

  it("throws on HTTP errors", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });

    await expect(saveAssetRegistry("test-stem", [])).rejects.toThrow(
      "Failed to save asset registry: Bad Request",
    );
  });
});

describe("lookup helpers", () => {
  it("finds by path and by canonical or legacy id", () => {
    const path = "projects/test/images/logo.png";
    const legacyId = generateAssetId(path);
    const canonicalId = generateCanonicalAssetId();
    const record = makeRecord({
      id: canonicalId,
      path,
      aliases: [legacyId],
    });

    expect(findAssetByPath([record], path)).toBe(record);
    expect(findAssetById([record], canonicalId)).toBe(record);
    expect(findAssetById([record], legacyId)).toBe(record);
  });

  it("returns null for missing entries", () => {
    const record = makeRecord();
    const unknownId = generateCanonicalAssetId();

    expect(findAssetByPath([record], "missing.png")).toBeNull();
    expect(findAssetById([record], unknownId)).toBeNull();
  });
});

describe("resolveAssetPath", () => {
  it("resolves canonical ids, legacy aliases, and passes through raw paths", () => {
    const path = "projects/test/videos/intro.mp4";
    const legacyId = generateAssetId(path);
    const canonicalId = generateCanonicalAssetId();
    const record = makeRecord({
      id: canonicalId,
      path,
      aliases: [legacyId],
    });

    expect(resolveAssetPath([record], canonicalId)).toBe(path);
    expect(resolveAssetPath([record], legacyId)).toBe(path);
    expect(resolveAssetPath([record], "assets/legacy/path.mp4")).toBe("assets/legacy/path.mp4");
  });

  it("returns null for unknown asset ids", () => {
    expect(resolveAssetPath([], generateCanonicalAssetId())).toBeNull();
  });
});

const describeEnsureAssetRecord = ensureAssetRecord ? describe : describe.skip;
const describeEnrichAssetRecord = enrichAssetRecord ? describe : describe.skip;

describeEnsureAssetRecord("ensureAssetRecord", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useEditorStore.setState({
      assetRecords: [],
      audioSrc: "projects/test-stem/audio.mp3",
      beatsSrc: "projects/test-stem/analysis.json",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the ensure endpoint and returns a normalized v2 record", async () => {
    const stem = "test-stem";
    const input: EnsureAssetRecordInput = {
      path: "projects/test/images/logo.png",
      kind: "image",
      label: "Logo",
    };

    const ensuredRecord = makeRecord({
      id: generateCanonicalAssetId(),
      path: input.path,
      pathHistory: ["projects/test/images/logo-old.png"],
      aliases: [generateAssetId(input.path)],
      metadata: {},
      label: input.label,
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        record: ensuredRecord,
        changed: true,
        count: 1,
      }),
    });

    const result = await ensureAssetRecord(stem, input);

    const ensureCall = fetchMock.mock.calls.find(([url]) =>
      /^\/api\/assets\/ensure\/test-stem\/?$/.test(String(url)),
    );
    expect(ensureCall).toBeDefined();
    const [url, options] = ensureCall!;
    expect(url).toMatch(/^\/api\/assets\/ensure\/test-stem\/?$/);
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toEqual(input);

    expect(result).toEqual(normalizeAssetRecordV2(ensuredRecord));
    expect(result.id).toMatch(/^ast_[0-9a-f]{32}$/);
    expect(result.aliases).toEqual([generateAssetId(input.path)]);
    expect(result.pathHistory).toEqual(ensuredRecord.pathHistory);
    expect(result.metadata).toEqual({});
    expect(useEditorStore.getState().assetRecords).toEqual([result]);
  });

  it("refreshes an existing cached record even when ensure is unchanged", async () => {
    const stem = "test-stem";
    const path = "projects/test/images/logo.png";
    const cachedRecord = makeRecord({
      id: generateCanonicalAssetId(),
      path,
      metadata: {},
      label: "Stale label",
      updatedAt: 10,
    });
    const ensuredRecord = makeRecord({
      ...cachedRecord,
      pathHistory: ["projects/test/images/logo-old.png"],
      metadata: {},
      label: "Fresh label",
      updatedAt: 20,
    });

    useEditorStore.getState().setAssetRecords([cachedRecord]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        record: ensuredRecord,
        changed: false,
        count: 1,
      }),
    });

    const result = await ensureAssetRecord(stem, { path, kind: "image", label: "Fresh label" });

    expect(result).toEqual(normalizeAssetRecordV2(ensuredRecord));
    expect(result.metadata).toEqual({});
    expect(useEditorStore.getState().assetRecords).toEqual([result]);
  });

  it("does not upsert into the store after the user switches to a different stem", async () => {
    const stem = "test-stem";
    const input: EnsureAssetRecordInput = {
      path: "projects/test/images/logo.png",
      kind: "image",
      label: "Logo",
    };
    const ensuredRecord = makeRecord({
      id: generateCanonicalAssetId(),
      path: input.path,
      aliases: [generateAssetId(input.path)],
      metadata: {},
      label: input.label,
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        record: ensuredRecord,
        changed: true,
        count: 1,
      }),
    });

    useEditorStore.setState({
      audioSrc: "projects/other-stem/audio.mp3",
      beatsSrc: "projects/other-stem/analysis.json",
    });

    const result = await ensureAssetRecord(stem, input);

    expect(result).toEqual(normalizeAssetRecordV2(ensuredRecord));
    expect(useEditorStore.getState().assetRecords).toEqual([]);
  });
});

describeEnrichAssetRecord("enrichAssetRecord", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useEditorStore.setState({
      assetRecords: [],
      audioSrc: "projects/test-stem/audio.mp3",
      beatsSrc: "projects/test-stem/analysis.json",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the enrich endpoint and upserts the returned record", async () => {
    const stem = "test-stem";
    const input: EnrichAssetRecordInput = {
      id: generateCanonicalAssetId(),
    };

    const enrichedRecord = makeRecord({
      id: input.id,
      path: "projects/test/videos/scene.mp4",
      kind: "video",
      metadata: { width: 1920, height: 1080, durationSec: 4.2, fps: 24, codec: "h264" },
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        records: [enrichedRecord],
        changed: true,
        enrichedCount: 1,
        missingIds: [],
        count: 1,
      }),
    });

    const result = await enrichAssetRecord(stem, input);

    const enrichCall = fetchMock.mock.calls.find(([url]) =>
      /^\/api\/assets\/enrich\/test-stem\/?$/.test(String(url)),
    );
    expect(enrichCall).toBeDefined();
    const [url, options] = enrichCall!;
    expect(url).toMatch(/^\/api\/assets\/enrich\/test-stem\/?$/);
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toEqual(input);

    expect(result).toEqual(normalizeAssetRecordV2(enrichedRecord));
    expect(useEditorStore.getState().assetRecords).toEqual([result]);
  });

  it("refreshes a cached record with enriched metadata without duplicating it", async () => {
    const stem = "test-stem";
    const cachedRecord = makeRecord({
      id: generateCanonicalAssetId(),
      path: "projects/test/videos/scene.mp4",
      kind: "video",
      metadata: {},
      updatedAt: 10,
    });
    const enrichedRecord = makeRecord({
      ...cachedRecord,
      metadata: { width: 1920, height: 1080, durationSec: 4.2, fps: 24, codec: "h264" },
      updatedAt: 20,
    });

    useEditorStore.getState().setAssetRecords([cachedRecord]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        records: [enrichedRecord],
        changed: false,
        enrichedCount: 1,
        missingIds: [],
        count: 1,
      }),
    });

    const result = await enrichAssetRecord(stem, { id: cachedRecord.id });

    expect(result).toEqual(normalizeAssetRecordV2(enrichedRecord));
    expect(useEditorStore.getState().assetRecords).toEqual([result]);
  });

  it("does not upsert enriched records into the store after the user switches stems", async () => {
    const stem = "test-stem";
    const enrichedRecord = makeRecord({
      id: generateCanonicalAssetId(),
      path: "projects/test/videos/scene.mp4",
      kind: "video",
      metadata: { width: 1920, height: 1080 },
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        record: enrichedRecord,
        records: [enrichedRecord],
        changed: true,
        enriched: true,
        enrichedCount: 1,
        missingIds: [],
        count: 1,
      }),
    });

    useEditorStore.setState({
      audioSrc: "projects/other-stem/audio.mp3",
      beatsSrc: "projects/other-stem/analysis.json",
    });

    const result = await enrichAssetRecord(stem, { id: enrichedRecord.id });

    expect(result).toEqual(normalizeAssetRecordV2(enrichedRecord));
    expect(useEditorStore.getState().assetRecords).toEqual([]);
  });
});

describe("reconcileAssetRegistry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useEditorStore.setState({
      assetRecords: [],
      assetRegistryError: "stale error",
      audioSrc: "projects/test-stem/audio.mp3",
      beatsSrc: "projects/test-stem/analysis.json",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the reconcile endpoint and replaces the current stem registry when records are returned", async () => {
    const stem = "test-stem";
    const missingRecord = makeRecord({
      id: generateCanonicalAssetId(),
      path: "projects/test-stem/images/missing.png",
      pathHistory: [],
      status: "missing",
      missingSince: 123,
      metadata: {},
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        changed: true,
        count: 1,
        registry: {
          version: 2,
          records: [missingRecord],
        },
      }),
    });

    const result = await reconcileAssetRegistry(stem);

    expect(fetchMock).toHaveBeenCalledWith("/api/assets/reconcile/test-stem", {
      method: "POST",
    });
    expect(result).toEqual([normalizeAssetRecordV2(missingRecord)]);
    expect(useEditorStore.getState().assetRecords).toEqual(result);
    expect(useEditorStore.getState().assetRegistryError).toBeNull();
  });

  it("returns an empty list when reconcile succeeds without inline records", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        changed: false,
        count: 0,
      }),
    });

    await expect(reconcileAssetRegistry("test-stem")).resolves.toEqual([]);
    expect(useEditorStore.getState().assetRecords).toEqual([]);
    expect(useEditorStore.getState().assetRegistryError).toBe("stale error");
  });

  it("clears stale registry errors when reconcile returns an empty inline registry", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        changed: false,
        count: 0,
        registry: {
          version: 2,
          records: [],
        },
      }),
    });

    await expect(reconcileAssetRegistry("test-stem")).resolves.toEqual([]);
    expect(useEditorStore.getState().assetRecords).toEqual([]);
    expect(useEditorStore.getState().assetRegistryError).toBeNull();
  });

  it("does not overwrite the store after the user switches to a different stem", async () => {
    const stem = "test-stem";
    const missingRecord = makeRecord({
      id: generateCanonicalAssetId(),
      path: "projects/test-stem/images/missing.png",
      pathHistory: [],
      status: "missing",
      missingSince: 456,
      metadata: {},
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        records: [missingRecord],
      }),
    });

    useEditorStore.setState({
      audioSrc: "projects/other-stem/audio.mp3",
      beatsSrc: "projects/other-stem/analysis.json",
    });

    const result = await reconcileAssetRegistry(stem);

    expect(result).toEqual([normalizeAssetRecordV2(missingRecord)]);
    expect(useEditorStore.getState().assetRecords).toEqual([]);
    expect(useEditorStore.getState().assetRegistryError).toBe("stale error");
  });
});
