#!/usr/bin/env tsx
// scripts/cli/migrate-timeline-assets.ts
//
// One-time migration CLI: convert legacy timeline.json asset references to
// canonical opaque asset IDs and upgrade the registry to v2.

import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type {
  AssetMetadata,
  AssetRegistryFile,
} from "../../editor/src/types/assetRecord";
import {
  AssetRegistryFileSchema,
  isCanonicalAssetId,
  isLegacyAssetId,
  upgradeLegacyAssetId,
} from "../../editor/src/types/assetRecord";
import { getElementModule } from "../../src/compositions/elements/registry";
import type { MediaFieldDefinition } from "../../src/compositions/elements/types";
import { resolveProjectDir, resolveProjectsDir } from "./paths";
import { probeAsset } from "./probe-media";

const repoRoot = resolve(__dirname, "..", "..");

type Args = {
  project?: string;
  dryRun?: boolean;
};

type TimelineElement = {
  id: string;
  type: string;
  trackIndex: number;
  startSec: number;
  durationSec: number;
  label: string;
  props: Record<string, unknown>;
  origin?: "pipeline" | "user";
  locked?: boolean;
  startEvent?: string;
};

type TimelineFile = {
  version: 1;
  stem: string;
  fps: number;
  compositionDuration: number;
  elements: TimelineElement[];
  _migrated?: boolean;
};

type AssetScope = "global" | "project";
type AssetKind = "image" | "video" | "gif";
type AssetStatus = "active" | "missing" | "tombstoned";
type AssetRecordV2 = {
  id: `ast_${string}`;
  aliases?: `ast_${string}`[];
  path: string;
  pathHistory: string[];
  kind: AssetKind;
  scope: AssetScope;
  stem: string | null;
  status: AssetStatus;
  missingSince?: number | null;
  deletedAt?: number | null;
  sizeBytes: number;
  mtimeMs: number;
  createdAt: number;
  updatedAt: number;
  metadata: AssetMetadata;
  contentHash?: string | null;
  hashVersion?: "sha256" | null;
  label?: string;
  tags?: string[];
  notes?: string;
};

type RegistryFileV2 = {
  version: 2;
  records: AssetRecordV2[];
};

type RawRegistryFile = {
  version?: number;
  records?: unknown;
};

const MEDIA_EXT = /\.(png|jpe?g|webp|avif|bmp|svg|gif|mp4|webm|mov|mkv|avi)$/i;
const LEGACY_ID_RE = /^ast_[0-9a-f]{16}$/;
const CANONICAL_ID_RE = /^ast_[0-9a-f]{32}$/;
const REMOTE_URL_RE = /^[a-z]+:\/\//i;
const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;

const parseArgs = (): Args => {
  const a: Args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const tok = process.argv[i];
    const next = process.argv[i + 1];
    if (tok === "--project" && next) {
      a.project = next;
      i++;
    } else if (tok === "--dry-run") {
      a.dryRun = true;
    }
  }
  return a;
};

const kindFromPath = (path: string): AssetKind | null => {
  if (/\.gif$/i.test(path)) return "gif";
  if (/\.(png|jpe?g|webp|avif|bmp|svg)$/i.test(path)) return "image";
  if (/\.(mp4|webm|mov|mkv|avi)$/i.test(path)) return "video";
  return null;
};

const scopeFromPath = (path: string): AssetScope => (path.startsWith("assets/") ? "global" : "project");

const stemFromPath = (path: string, currentStem: string): string | null => {
  if (path.startsWith("projects/")) {
    return path.split("/")[1] ?? currentStem;
  }
  return path.startsWith("assets/") ? null : currentStem;
};

const normalizeLocalAssetRef = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (REMOTE_URL_RE.test(trimmed) || trimmed.startsWith("//") || WINDOWS_ABS_RE.test(trimmed)) {
    return null;
  }
  if (trimmed.startsWith("/assets/") || trimmed.startsWith("/projects/")) {
    return trimmed.slice(1);
  }
  if (trimmed.startsWith("/")) {
    return null;
  }
  return trimmed.replace(/^\.\//, "");
};

const hasUnsafePathSegments = (path: string): boolean =>
  path.split("/").some((segment) => segment === "." || segment === "..");

const canonicalizePath = (path: string, currentStem: string, scope: AssetScope): string => {
  const normalizedInput = normalizeLocalAssetRef(path);
  if (!normalizedInput || hasUnsafePathSegments(normalizedInput)) {
    throw new Error(`unsafe asset path: ${path}`);
  }
  const trimmed = normalizedInput;
  if (trimmed.startsWith("assets/") || trimmed.startsWith("projects/")) {
    return trimmed;
  }
  if (scope === "global") {
    return `assets/images/${basename(trimmed)}`;
  }
  return `projects/${currentStem}/${trimmed}`;
};

const isAssetId = (value: string): boolean => LEGACY_ID_RE.test(value) || CANONICAL_ID_RE.test(value);

const createOpaqueAssetId = (usedIds: Set<string>): `ast_${string}` => {
  // 128 bits gives us a clean break from path-derived 16-hex ids.
  // Keep retrying until we avoid the tiny chance of a collision.
  while (true) {
    const id = `ast_${randomBytes(16).toString("hex")}` as const;
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
};

const uniqueStrings = (values: unknown[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

const readJsonFile = (filePath: string): unknown | null => {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as unknown;
};

const writeJsonAtomic = (filePath: string, data: unknown): void => {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, filePath);
};

const computeContentHash = (fullPath: string): string | null => {
  try {
    const content = readFileSync(fullPath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
};

const resolveDiskPath = (repoProjectsDir: string, projectDir: string, recordPath: string): string => {
  const normalized = recordPath.replace(/^\/+/, "");
  if (normalized.startsWith("assets/")) {
    return join(repoRoot, "public", normalized);
  }
  if (normalized.startsWith("projects/")) {
    return join(repoProjectsDir, normalized.slice("projects/".length));
  }
  return join(projectDir, normalized);
};

const detectMissingState = (fullPath: string): { exists: boolean; stats?: ReturnType<typeof statSync> } => {
  try {
    const stats = statSync(fullPath);
    return { exists: stats.isFile(), stats };
  } catch {
    return { exists: false };
  }
};

const normalizeRecord = (
  raw: any,
  currentStem: string,
  usedIds: Set<string>,
  now: number,
): AssetRecordV2 | null => {
  if (!raw || typeof raw !== "object") return null;

  const rawId = typeof raw.id === "string" ? raw.id : null;
  const legacyId = rawId && isLegacyAssetId(rawId) ? rawId : null;
  const canonicalId = rawId && isCanonicalAssetId(rawId)
    ? rawId
    : legacyId
      ? upgradeLegacyAssetId(legacyId)
      : null;
  if (!canonicalId) {
    throw new Error(`Invalid asset record id during migration normalization`);
  }
  if (usedIds.has(canonicalId)) {
    throw new Error(`Duplicate canonical asset id during migration normalization: ${canonicalId}`);
  }
  usedIds.add(canonicalId);

  const rawPath = typeof raw.path === "string" ? raw.path : "";
  const inputScope: AssetScope =
    raw.scope === "global" || rawPath.startsWith("assets/") ? "global" : "project";
  const path = rawPath ? canonicalizePath(rawPath, currentStem, inputScope) : "";
  if (!path) return null;
  const scope = scopeFromPath(path);

  const kind = raw.kind === "video" || raw.kind === "gif" ? raw.kind : "image";
  const stem = typeof raw.stem === "string" || raw.stem === null ? raw.stem : stemFromPath(path, currentStem);
  const status: AssetStatus =
    raw.status === "missing" || raw.status === "tombstoned" ? raw.status : "active";
  const missingSince = typeof raw.missingSince === "number" ? raw.missingSince : null;
  const deletedAt = typeof raw.deletedAt === "number" ? raw.deletedAt : null;
  const aliases = uniqueStrings([
    ...(Array.isArray(raw.aliases) ? raw.aliases : []),
    ...(legacyId && legacyId !== canonicalId ? [legacyId] : []),
  ]).filter((value) => isAssetId(value)) as `ast_${string}`[];
  const pathHistory = uniqueStrings(Array.isArray(raw.pathHistory) ? raw.pathHistory : []);
  const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {};

  return {
    id: canonicalId,
    ...(aliases.length > 0 ? { aliases } : {}),
    path,
    pathHistory,
    kind,
    scope,
    stem,
    status,
    missingSince,
    deletedAt,
    sizeBytes: typeof raw.sizeBytes === "number" && Number.isFinite(raw.sizeBytes) ? raw.sizeBytes : 0,
    mtimeMs: typeof raw.mtimeMs === "number" && Number.isFinite(raw.mtimeMs) ? raw.mtimeMs : 0,
    createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    metadata,
    contentHash:
      typeof raw.contentHash === "string" && raw.contentHash.length > 0 ? raw.contentHash : null,
    hashVersion: raw.hashVersion === "sha256" ? "sha256" : null,
    ...(typeof raw.label === "string" ? { label: raw.label } : {}),
    ...(Array.isArray(raw.tags) ? { tags: raw.tags.filter((v: unknown): v is string => typeof v === "string") } : {}),
    ...(typeof raw.notes === "string" ? { notes: raw.notes } : {}),
  };
};

const normalizeRegistry = (raw: unknown, currentStem: string): RegistryFileV2 => {
  const now = Date.now();
  const usedIds = new Set<string>();
  if (raw == null) {
    return { version: 2, records: [] };
  }

  const parsed = AssetRegistryFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid assets.json: ${parsed.error.message}`);
  }

  const records: AssetRecordV2[] = [];
  const rawRecords = (parsed.data as AssetRegistryFile).records;

  for (const entry of rawRecords) {
    const normalized = normalizeRecord(entry, currentStem, usedIds, now);
    if (!normalized) continue;
    records.push(normalized);
  }

  return { version: 2, records };
};

const hydrateRegistryFromDisk = async (
  registry: RegistryFileV2,
  repoProjectsDir: string,
  projectDir: string,
): Promise<boolean> => {
  let changed = false;
  for (const record of registry.records) {
    if (record.status === "tombstoned") continue;
    const fullPath = resolveDiskPath(repoProjectsDir, projectDir, record.path);
    const probe = detectMissingState(fullPath);
    if (!probe.exists || !probe.stats) {
      if (record.status !== "missing") {
        record.status = "missing";
        record.missingSince = record.missingSince ?? Date.now();
        record.updatedAt = Date.now();
        changed = true;
      } else if (record.missingSince == null) {
        record.missingSince = Date.now();
        changed = true;
      }
      continue;
    }

    const hash = computeContentHash(fullPath);
    const metadata = await probeAsset(repoRoot, repoProjectsDir, record.path, record.kind);
    const nextMissingSince = record.status === "missing" ? null : record.missingSince ?? null;
    if (
      record.status !== "active" ||
      record.missingSince !== null ||
      record.sizeBytes !== probe.stats.size ||
      record.mtimeMs !== probe.stats.mtimeMs ||
      record.contentHash !== hash ||
      record.hashVersion !== (hash ? "sha256" : null) ||
      JSON.stringify(record.metadata) !== JSON.stringify(metadata)
    ) {
      record.status = "active";
      record.missingSince = nextMissingSince;
      record.deletedAt = null;
      record.sizeBytes = probe.stats.size;
      record.mtimeMs = probe.stats.mtimeMs;
      record.metadata = metadata;
      record.contentHash = hash;
      record.hashVersion = hash ? "sha256" : null;
      record.updatedAt = Date.now();
      changed = true;
    }
  }
  return changed;
};

const appendHistory = (record: AssetRecordV2, previousPath: string): void => {
  if (!previousPath || previousPath === record.path) return;
  if (record.pathHistory[record.pathHistory.length - 1] === previousPath) return;
  if (!record.pathHistory.includes(previousPath)) {
    record.pathHistory.push(previousPath);
  }
};

const buildIndexes = (registry: RegistryFileV2) => {
  const byId = new Map<string, AssetRecordV2>();
  const byAlias = new Map<string, AssetRecordV2>();
  const byPath = new Map<string, AssetRecordV2[]>();
  const byHistory = new Map<string, AssetRecordV2[]>();
  const byHash = new Map<string, AssetRecordV2[]>();

  for (const record of registry.records) {
    byId.set(record.id, record);
    for (const alias of record.aliases ?? []) {
      byAlias.set(alias, record);
    }
    if (!byPath.has(record.path)) byPath.set(record.path, []);
    byPath.get(record.path)?.push(record);
    for (const previous of record.pathHistory) {
      if (!byHistory.has(previous)) byHistory.set(previous, []);
      byHistory.get(previous)?.push(record);
    }
    if (record.contentHash) {
      if (!byHash.has(record.contentHash)) byHash.set(record.contentHash, []);
      byHash.get(record.contentHash)?.push(record);
    }
  }

  return { byId, byAlias, byPath, byHistory, byHash };
};

const uniqueRecordOrNull = (records: AssetRecordV2[] | undefined): AssetRecordV2 | null => {
  if (!records || records.length !== 1) return null;
  return records[0] ?? null;
};

const resolveCanonicalRecordForRef = (
  ref: string,
  indexes: ReturnType<typeof buildIndexes>,
): AssetRecordV2 | null => {
  if (CANONICAL_ID_RE.test(ref)) {
    return indexes.byId.get(ref) ?? indexes.byAlias.get(ref) ?? null;
  }
  if (LEGACY_ID_RE.test(ref)) {
    return indexes.byAlias.get(ref) ?? indexes.byId.get(ref) ?? null;
  }
  return uniqueRecordOrNull(indexes.byPath.get(ref)) ?? uniqueRecordOrNull(indexes.byHistory.get(ref));
};

const hasAmbiguousRecordForRef = (
  ref: string,
  indexes: ReturnType<typeof buildIndexes>,
): boolean => {
  if (CANONICAL_ID_RE.test(ref) || LEGACY_ID_RE.test(ref)) {
    return false;
  }
  const byPath = indexes.byPath.get(ref);
  if (byPath && byPath.length > 1) return true;
  const byHistory = indexes.byHistory.get(ref);
  return Boolean(byHistory && byHistory.length > 1);
};

const ensureRecordForPath = async (
  refPath: string,
  projectStem: string,
  repoProjectsDir: string,
  projectDir: string,
  registry: RegistryFileV2,
  indexes: ReturnType<typeof buildIndexes>,
): Promise<{ record: AssetRecordV2; created: boolean }> => {
  const normalizedRef = normalizeLocalAssetRef(refPath);
  if (!normalizedRef || hasUnsafePathSegments(normalizedRef)) {
    throw new Error(`unsafe asset path: ${refPath}`);
  }
  if (hasAmbiguousRecordForRef(normalizedRef, indexes)) {
    throw new Error(`ambiguous asset reference: ${refPath}`);
  }
  const existing = resolveCanonicalRecordForRef(normalizedRef, indexes);
  if (existing) {
    return { record: existing, created: false };
  }

  const kind = kindFromPath(normalizedRef);
  if (!kind) {
    throw new Error(`cannot determine media kind for path "${refPath}"`);
  }

  const canonicalPath = canonicalizePath(normalizedRef, projectStem, scopeFromPath(normalizedRef));
  const fullPath = resolveDiskPath(repoProjectsDir, projectDir, canonicalPath);
  const probe = detectMissingState(fullPath);
  const now = Date.now();
  const record: AssetRecordV2 = {
    id: createOpaqueAssetId(new Set(registry.records.map((r) => r.id))),
    path: canonicalPath,
    pathHistory: [],
    kind,
    scope: scopeFromPath(canonicalPath),
    stem: stemFromPath(canonicalPath, projectStem),
    status: probe.exists ? "active" : "missing",
    missingSince: probe.exists ? null : now,
    deletedAt: null,
    sizeBytes: probe.stats?.size ?? 0,
    mtimeMs: probe.stats?.mtimeMs ?? 0,
    createdAt: now,
    updatedAt: now,
    metadata: probe.exists ? await probeAsset(repoRoot, repoProjectsDir, canonicalPath, kind) : {},
    contentHash: probe.exists ? computeContentHash(fullPath) : null,
    hashVersion: probe.exists ? "sha256" : null,
    label: basename(canonicalPath),
  };
  registry.records.push(record);
  indexes.byId.set(record.id, record);
  indexes.byPath.set(record.path, [...(indexes.byPath.get(record.path) ?? []), record]);
  for (const alias of record.aliases ?? []) {
    indexes.byAlias.set(alias, record);
  }
  if (record.contentHash) {
    indexes.byHash.set(record.contentHash, [...(indexes.byHash.get(record.contentHash) ?? []), record]);
  }
  return { record, created: true };
};

const migrateMediaRef = async (
  value: string,
  projectStem: string,
  repoProjectsDir: string,
  projectDir: string,
  registry: RegistryFileV2,
  indexes: ReturnType<typeof buildIndexes>,
  stats: { createdRecords: number; rewrittenRefs: number; unresolvedRefs: number },
): Promise<string> => {
  const normalized = normalizeLocalAssetRef(value);
  if (!normalized || hasUnsafePathSegments(normalized)) {
    return value;
  }
  if (hasAmbiguousRecordForRef(normalized, indexes)) {
    stats.unresolvedRefs += 1;
    return value;
  }
  const canonical = resolveCanonicalRecordForRef(normalized, indexes);
  if (canonical) {
    if (canonical.id !== normalized) {
      stats.rewrittenRefs += 1;
      return canonical.id;
    }
    return value;
  }

  if (!MEDIA_EXT.test(normalized)) {
    return value;
  }

  const { record, created } = await ensureRecordForPath(
    normalized,
    projectStem,
    repoProjectsDir,
    projectDir,
    registry,
    indexes,
  );
  if (created) stats.createdRecords += 1;
  stats.rewrittenRefs += 1;
  return record.id;
};

const commitMigrationFiles = (
  assetsPath: string,
  timelinePath: string,
  nextRegistry: RegistryFileV2,
  nextTimeline: TimelineFile,
): void => {
  const originalAssets = existsSync(assetsPath) ? readFileSync(assetsPath, "utf8") : null;
  const originalTimeline = readFileSync(timelinePath, "utf8");

  try {
    writeJsonAtomic(assetsPath, nextRegistry);
    writeJsonAtomic(timelinePath, nextTimeline);
  } catch (error) {
    try {
      if (originalAssets == null) {
        rmSync(assetsPath, { force: true });
      } else {
        writeFileSync(`${assetsPath}.restore.tmp`, originalAssets, "utf8");
        renameSync(`${assetsPath}.restore.tmp`, assetsPath);
      }
    } catch (rollbackErr) {
      console.error(`[migration] failed to restore assets.json after write failure: ${String(rollbackErr)}`);
    }

    try {
      writeFileSync(`${timelinePath}.restore.tmp`, originalTimeline, "utf8");
      renameSync(`${timelinePath}.restore.tmp`, timelinePath);
    } catch (rollbackErr) {
      console.error(`[migration] failed to restore timeline.json after write failure: ${String(rollbackErr)}`);
    }

    throw error;
  }
};

const migrateDeclaredMediaFieldValue = async (
  value: unknown,
  field: MediaFieldDefinition,
  projectStem: string,
  repoProjectsDir: string,
  projectDir: string,
  registry: RegistryFileV2,
  indexes: ReturnType<typeof buildIndexes>,
  stats: { createdRecords: number; rewrittenRefs: number; unresolvedRefs: number },
): Promise<unknown> => {
  if (field.multi) {
    if (!Array.isArray(value)) return value;
    const next = [];
    for (const item of value) {
      next.push(
        typeof item === "string"
          ? await migrateMediaRef(
              item,
              projectStem,
              repoProjectsDir,
              projectDir,
              registry,
              indexes,
              stats,
            )
          : item,
      );
    }
    return next;
  }

  if (typeof value === "string") {
    return migrateMediaRef(
      value,
      projectStem,
      repoProjectsDir,
      projectDir,
      registry,
      indexes,
      stats,
    );
  }

  return value;
};

const migrateElementProps = async (
  element: TimelineElement,
  projectStem: string,
  repoProjectsDir: string,
  projectDir: string,
  registry: RegistryFileV2,
  indexes: ReturnType<typeof buildIndexes>,
  stats: { createdRecords: number; rewrittenRefs: number; unresolvedRefs: number },
): Promise<Record<string, unknown>> => {
  const nextProps: Record<string, unknown> = { ...(element.props ?? {}) };
  const mediaFields = getElementModule(element.type)?.mediaFields ?? [];
  if (mediaFields.length === 0) {
    return nextProps;
  }

  for (const field of mediaFields) {
    if (!(field.name in nextProps)) continue;
    nextProps[field.name] = await migrateDeclaredMediaFieldValue(
      nextProps[field.name],
      field,
      projectStem,
      repoProjectsDir,
      projectDir,
      registry,
      indexes,
      stats,
    );
  }

  return nextProps;
};

const migrateTimeline = async (
  timeline: TimelineFile,
  projectStem: string,
  repoProjectsDir: string,
  projectDir: string,
  registry: RegistryFileV2,
  indexes: ReturnType<typeof buildIndexes>,
): Promise<{ timeline: TimelineFile; rewrittenRefs: number; createdRecords: number; unresolvedRefs: number }> => {
  const stats = { createdRecords: 0, rewrittenRefs: 0, unresolvedRefs: 0 };
  const nextTimeline: TimelineFile = {
    ...timeline,
    elements: [],
  };

  for (const element of timeline.elements) {
    const nextElement: TimelineElement = {
      ...element,
      props: await migrateElementProps(
        element,
        projectStem,
        repoProjectsDir,
        projectDir,
        registry,
        indexes,
        stats,
      ),
    };
    nextTimeline.elements.push(nextElement);
  }

  nextTimeline._migrated = true;
  return {
    timeline: nextTimeline,
    rewrittenRefs: stats.rewrittenRefs,
    createdRecords: stats.createdRecords,
    unresolvedRefs: stats.unresolvedRefs,
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  if (!args.project) {
    console.error("usage: migrate:assets --project <stem> [--dry-run]");
    console.error("       migrates timeline.json raw paths + legacy IDs to opaque asset IDs");
    process.exit(1);
  }

  const stem = args.project;
  const repoProjectsDir = resolveProjectsDir(repoRoot);
  const projectDir = resolveProjectDir(repoRoot, stem);
  if (!existsSync(projectDir)) {
    console.error(`project not found: ${projectDir}`);
    process.exit(1);
  }

  const timelinePath = join(projectDir, "timeline.json");
  if (!existsSync(timelinePath)) {
    console.error(`timeline.json not found: ${timelinePath}`);
    console.error("  nothing to migrate — project has no timeline yet");
    process.exit(0);
  }

  const timelineRaw = readJsonFile(timelinePath);
  if (!timelineRaw || typeof timelineRaw !== "object") {
    console.error(`failed to parse timeline.json: invalid JSON`);
    process.exit(1);
  }
  const timeline = timelineRaw as TimelineFile;

  const assetsPath = join(projectDir, "assets.json");
  const rawRegistry = readJsonFile(assetsPath);
  const registry = normalizeRegistry(rawRegistry, stem);
  const registryBeforeHydration = JSON.stringify(registry);
  const hydratedChanged = await hydrateRegistryFromDisk(registry, repoProjectsDir, projectDir);
  const indexes = buildIndexes(registry);
  const migration = await migrateTimeline(timeline, stem, repoProjectsDir, projectDir, registry, indexes);
  const registryAfterMigration = JSON.stringify(registry);
  const timelineChanged = JSON.stringify(timeline) !== JSON.stringify(migration.timeline);
  const rawRegistryVersion =
    rawRegistry && typeof rawRegistry === "object" ? (rawRegistry as RawRegistryFile).version : undefined;
  const registryChanged =
    rawRegistry == null ||
    rawRegistryVersion !== 2 ||
    JSON.stringify(rawRegistry) !== registryBeforeHydration ||
    hydratedChanged ||
    registryBeforeHydration !== registryAfterMigration;

  if (!timelineChanged && !registryChanged && existsSync(join(projectDir, ".migrated"))) {
    console.log(`[migrate-timeline-assets] ${stem}`);
    console.log(`  ✓ already migrated`);
    process.exit(0);
  }

  if (args.dryRun) {
    console.log(`[migrate-timeline-assets] ${stem}`);
    console.log(`  dry-run: would rewrite ${migration.rewrittenRefs} media refs`);
    console.log(`  dry-run: would create ${migration.createdRecords} new asset records`);
    process.exit(0);
  }

  const backupPath = join(projectDir, `timeline.backup-${Date.now()}.json`);
  copyFileSync(timelinePath, backupPath);

  commitMigrationFiles(assetsPath, timelinePath, registry, migration.timeline);

  const migratedFlagPath = join(projectDir, ".migrated");
  if (!existsSync(migratedFlagPath)) {
    writeFileSync(migratedFlagPath, `${Date.now()}\n`, "utf8");
  }

  console.log(`[migrate-timeline-assets] ${stem}`);
  console.log(`  rewritten refs: ${migration.rewrittenRefs}`);
  console.log(`  new records: ${migration.createdRecords}`);
  console.log(`  registry: v2 opaque ids`);
  console.log(`  backup: ${backupPath}`);
};

void main().catch((error) => {
  console.error(`[migrate-timeline-assets] failed:`, error);
  process.exit(1);
});
