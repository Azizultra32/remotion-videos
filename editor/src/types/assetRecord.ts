import { z } from "zod";

const LEGACY_ASSET_ID_REGEX = /^ast_[0-9a-f]{16}$/;
const CANONICAL_ASSET_ID_REGEX = /^ast_[0-9a-f]{32}$/;
const ANY_ASSET_ID_REGEX = /^ast_(?:[0-9a-f]{16}|[0-9a-f]{32})$/;

export type LegacyAssetId = `ast_${string}`;
export type CanonicalAssetId = `ast_${string}`;
export type AssetId = LegacyAssetId | CanonicalAssetId;

export type AssetKind = "image" | "video" | "gif";
export type AssetScope = "global" | "project";
export type AssetLifecycleStatus = "active" | "missing" | "tombstoned";

/**
 * Metadata for an asset, cached at record creation time.
 * Avoids re-scanning on every render.
 */
export type AssetMetadata = {
  width?: number;
  height?: number;
  durationSec?: number;
  hasAlpha?: boolean;
  fps?: number;
  codec?: string;
};

type AssetRecordBase = {
  path: string;
  kind: AssetKind;
  scope: AssetScope;
  stem: string | null;
  sizeBytes: number;
  mtimeMs: number;
  createdAt: number;
  updatedAt: number;
  metadata: AssetMetadata;
  label?: string;
  tags?: string[];
  notes?: string;
};

/**
 * Strict legacy v1 record shape.
 */
export type AssetRecordV1 = AssetRecordBase & {
  id: LegacyAssetId;
};

/**
 * Strict canonical v2 record shape.
 */
export type AssetRecordV2 = AssetRecordBase & {
  id: CanonicalAssetId;
  aliases?: LegacyAssetId[];
  pathHistory: string[];
  status: AssetLifecycleStatus;
  missingSince?: number | null;
  deletedAt?: number | null;
  contentHash?: string | null;
  hashVersion?: "sha256" | null;
};

/**
 * Transitional compatibility shape used by the current codebase while the v2
 * contract rolls out. Runtime helpers normalize this into AssetRecordV2.
 */
export type AssetRecord = AssetRecordBase & {
  id: AssetId;
  aliases?: LegacyAssetId[];
  pathHistory?: string[];
  status?: AssetLifecycleStatus;
  missingSince?: number | null;
  deletedAt?: number | null;
  contentHash?: string | null;
  hashVersion?: "sha256" | null;
};

export type AssetRegistryFileV1 = {
  version: 1;
  records: AssetRecord[];
};

export type AssetRegistryFileV2 = {
  version: 2;
  records: AssetRecordV2[];
};

/**
 * Compatibility registry file type accepted during the cutover window.
 */
export type AssetRegistryFile = {
  version: 1 | 2;
  records: AssetRecord[];
};

// ---------------------------------------------------------------------------
// Zod schemas for runtime validation
// ---------------------------------------------------------------------------

export const LegacyAssetIdSchema = z
  .string()
  .regex(LEGACY_ASSET_ID_REGEX, "Invalid legacy asset ID format")
  .transform((value) => value as LegacyAssetId);

export const CanonicalAssetIdSchema = z
  .string()
  .regex(CANONICAL_ASSET_ID_REGEX, "Invalid canonical asset ID format")
  .transform((value) => value as CanonicalAssetId);

export const AssetIdSchema = z
  .string()
  .regex(ANY_ASSET_ID_REGEX, "Invalid asset ID format")
  .transform((value) => value as AssetId);

export const AssetMetadataSchema = z.object({
  width: z.number().optional(),
  height: z.number().optional(),
  durationSec: z.number().optional(),
  hasAlpha: z.boolean().optional(),
  fps: z.number().optional(),
  codec: z.string().optional(),
});

export const AssetLifecycleStatusSchema = z.enum(["active", "missing", "tombstoned"]);

const AssetRecordBaseSchema = z.object({
  id: AssetIdSchema,
  path: z.string().min(1),
  kind: z.enum(["image", "video", "gif"]),
  scope: z.enum(["global", "project"]),
  stem: z.string().nullable(),
  sizeBytes: z.number().min(0),
  mtimeMs: z.number().min(0),
  createdAt: z.number().min(0),
  updatedAt: z.number().min(0),
  metadata: AssetMetadataSchema,
  label: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const AssetRecordV1Schema = AssetRecordBaseSchema.extend({
  id: LegacyAssetIdSchema,
});

export const AssetRecordV2Schema = AssetRecordBaseSchema.extend({
  id: CanonicalAssetIdSchema,
  aliases: z.array(LegacyAssetIdSchema).optional(),
  pathHistory: z.array(z.string().min(1)),
  status: AssetLifecycleStatusSchema,
  missingSince: z.number().min(0).nullable().optional(),
  deletedAt: z.number().min(0).nullable().optional(),
  contentHash: z.string().min(1).nullable().optional(),
  hashVersion: z.enum(["sha256"]).nullable().optional(),
});

export const AssetRecordSchema = AssetRecordBaseSchema.extend({
  aliases: z.array(LegacyAssetIdSchema).optional(),
  pathHistory: z.array(z.string().min(1)).optional(),
  status: AssetLifecycleStatusSchema.optional(),
  missingSince: z.number().min(0).nullable().optional(),
  deletedAt: z.number().min(0).nullable().optional(),
  contentHash: z.string().min(1).nullable().optional(),
  hashVersion: z.enum(["sha256"]).nullable().optional(),
});

export const AssetRegistryFileV1Schema = z.object({
  version: z.literal(1),
  records: z.array(AssetRecordSchema),
});

export const AssetRegistryFileV2Schema = z.object({
  version: z.literal(2),
  records: z.array(AssetRecordV2Schema),
});

export const AssetRegistryFileSchema = z.union([
  AssetRegistryFileV1Schema,
  AssetRegistryFileV2Schema,
]);

function getCrypto(): {
  getRandomValues: (array: Uint8Array) => Uint8Array;
} | null {
  const cryptoApi = globalThis.crypto as
    | {
        getRandomValues?: (array: Uint8Array) => Uint8Array;
      }
    | undefined;

  if (!cryptoApi?.getRandomValues) {
    return null;
  }

  return {
    getRandomValues: (array) => cryptoApi.getRandomValues?.(array) ?? array,
  };
}

function randomHex(bytes: number): string {
  const cryptoApi = getCrypto();
  const buffer = new Uint8Array(bytes);

  if (cryptoApi) {
    cryptoApi.getRandomValues(buffer);
  } else {
    for (let i = 0; i < buffer.length; i += 1) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(buffer, (value) => value.toString(16).padStart(2, "0")).join("");
}

function dedupeStrings(values: readonly string[], exclude?: string): string[] {
  const next: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (!value || value === exclude || seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }

  return next;
}

function dedupeLegacyAliases(values: readonly string[]): LegacyAssetId[] {
  return dedupeStrings(values)
    .filter(isLegacyAssetId)
    .map((value) => value as LegacyAssetId);
}

function fnv1a64Hex(
  input: string,
  seed: bigint = 0xcbf29ce484222325n,
): string {
  let hash = seed;
  const prime = 0x100000001b3n;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }

  return hash.toString(16).padStart(16, "0");
}

function normalizeNullableNumber(value: number | null | undefined): number | null {
  return value == null ? null : value;
}

export function isLegacyAssetId(id: string): id is LegacyAssetId {
  return LEGACY_ASSET_ID_REGEX.test(id);
}

export function isCanonicalAssetId(id: string): id is CanonicalAssetId {
  return CANONICAL_ASSET_ID_REGEX.test(id);
}

export function isAssetId(id: string): id is AssetId {
  return ANY_ASSET_ID_REGEX.test(id);
}

export function isValidAssetId(id: string): id is AssetId {
  return isAssetId(id);
}

/**
 * Legacy compatibility helper: generate the deterministic v1 path-hash ID.
 */
export function generateAssetId(path: string): LegacyAssetId {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < path.length; i += 1) {
    hash ^= BigInt(path.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }

  const hashHex = hash.toString(16).padStart(16, "0");
  return `ast_${hashHex}` as LegacyAssetId;
}

export const generateLegacyAssetId = generateAssetId;

/**
 * Generate an opaque canonical asset ID for v2 records.
 */
export function generateCanonicalAssetId(): CanonicalAssetId {
  return `ast_${randomHex(16)}` as CanonicalAssetId;
}

export const generateOpaqueAssetId = generateCanonicalAssetId;

/**
 * Deterministically upgrade a legacy path-hash ID to a canonical v2 ID.
 * This is only for legacy-record normalization; brand-new records should use
 * generateCanonicalAssetId().
 */
export function upgradeLegacyAssetId(legacyId: LegacyAssetId): CanonicalAssetId {
  const low = fnv1a64Hex(`asset-v2:${legacyId}`, 0xcbf29ce484222325n);
  const high = fnv1a64Hex(`asset-v2:${legacyId}`, 0x84222325cbf29ce4n);
  return `ast_${low}${high}` as CanonicalAssetId;
}

export function isAssetRecordV2(record: AssetRecord): record is AssetRecordV2 {
  return (
    isCanonicalAssetId(record.id) &&
    Array.isArray(record.pathHistory) &&
    typeof record.status === "string"
  );
}

/**
 * Upgrade a legacy or transitional record into the strict v2 shape.
 */
export function normalizeAssetRecordV2(record: AssetRecord): AssetRecordV2 {
  const canonicalId = isCanonicalAssetId(record.id)
    ? record.id
    : upgradeLegacyAssetId(record.id as LegacyAssetId);
  const legacyId = isLegacyAssetId(record.id) ? record.id : null;
  const aliases = dedupeLegacyAliases([...(record.aliases ?? []), ...(legacyId ? [legacyId] : [])]);
  const status = record.status ?? "active";

  return {
    id: canonicalId,
    ...(aliases.length > 0 ? { aliases } : {}),
    path: record.path,
    pathHistory: dedupeStrings(record.pathHistory ?? [], record.path),
    kind: record.kind,
    scope: record.scope,
    stem: record.stem,
    status,
    ...(record.missingSince !== undefined || status === "missing"
      ? { missingSince: normalizeNullableNumber(record.missingSince) }
      : {}),
    ...(record.deletedAt !== undefined || status === "tombstoned"
      ? { deletedAt: normalizeNullableNumber(record.deletedAt) }
      : {}),
    sizeBytes: record.sizeBytes,
    mtimeMs: record.mtimeMs,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    metadata: record.metadata,
    ...(record.contentHash !== undefined ? { contentHash: record.contentHash } : {}),
    ...(record.hashVersion !== undefined ? { hashVersion: record.hashVersion } : {}),
    ...(record.label !== undefined ? { label: record.label } : {}),
    ...(record.tags !== undefined ? { tags: [...record.tags] } : {}),
    ...(record.notes !== undefined ? { notes: record.notes } : {}),
  };
}

export function normalizeAssetRecord(record: AssetRecord): AssetRecordV2 {
  return normalizeAssetRecordV2(record);
}

/**
 * Upgrade a legacy or transitional registry into the strict v2 shape.
 */
export function normalizeAssetRegistryFileV2(file: AssetRegistryFile): AssetRegistryFileV2 {
  return {
    version: 2,
    records: file.records.map((record) => normalizeAssetRecordV2(record)),
  };
}

export function normalizeAssetRegistryFile(file: AssetRegistryFile): AssetRegistryFileV2 {
  return normalizeAssetRegistryFileV2(file);
}

type CreateAssetRecordInput = Omit<
  AssetRecordV2,
  "id" | "aliases" | "pathHistory" | "status"
> & {
  aliases?: LegacyAssetId[];
  pathHistory?: string[];
  status?: AssetLifecycleStatus;
  missingSince?: number | null;
  deletedAt?: number | null;
};

export function createAssetRecord(input: CreateAssetRecordInput): AssetRecordV2 {
  const canonicalId = generateCanonicalAssetId();
  const legacyAlias = generateLegacyAssetId(input.path);
  const aliases = dedupeLegacyAliases([legacyAlias, ...(input.aliases ?? [])]);
  const status = input.status ?? "active";

  return {
    id: canonicalId,
    ...(aliases.length > 0 ? { aliases } : {}),
    path: input.path,
    pathHistory: dedupeStrings(input.pathHistory ?? [], input.path),
    kind: input.kind,
    scope: input.scope,
    stem: input.stem,
    status,
    ...(input.missingSince !== undefined || status === "missing"
      ? { missingSince: normalizeNullableNumber(input.missingSince) }
      : {}),
    ...(input.deletedAt !== undefined || status === "tombstoned"
      ? { deletedAt: normalizeNullableNumber(input.deletedAt) }
      : {}),
    sizeBytes: input.sizeBytes,
    mtimeMs: input.mtimeMs,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    metadata: input.metadata,
    ...(input.contentHash !== undefined ? { contentHash: input.contentHash } : {}),
    ...(input.hashVersion !== undefined ? { hashVersion: input.hashVersion } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.tags !== undefined ? { tags: [...input.tags] } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
}
