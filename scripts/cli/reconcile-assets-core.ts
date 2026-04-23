import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  promises as fs,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type {
  AssetKind,
  AssetMetadata,
  AssetScope,
  AssetRegistryFile,
} from "../../editor/src/types/assetRecord";
import {
  AssetRegistryFileSchema,
  isCanonicalAssetId,
  isLegacyAssetId,
  normalizeAssetRegistryFileV2,
  upgradeLegacyAssetId,
} from "../../editor/src/types/assetRecord";
import { resolveProjectDir, resolveProjectsDir } from "./paths";
import { probeAsset } from "./probe-media";

type AssetStatus = "active" | "missing" | "tombstoned";

type Args = {
  project?: string;
  dryRun?: boolean;
};

type RawRegistryFile = {
  version?: number;
  records?: unknown;
};

type ReconcileAssetRecord = {
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
  records: ReconcileAssetRecord[];
};

type ScanFile = {
  path: string;
  kind: AssetKind;
  scope: AssetScope;
  stem: string | null;
  sizeBytes: number;
  mtimeMs: number;
  contentHash: string | null;
};

export type ReconcileAssetsStats = {
  scanned: number;
  added: number;
  updated: number;
  moved: number;
  reactivated: number;
  missing: number;
  ambiguous: number;
  normalized: number;
};

export type ReconcileAssetsResult = {
  stem: string;
  dryRun: boolean;
  changed: boolean;
  wrote: boolean;
  assetsPath: string;
  registry: RegistryFileV2;
  stats: ReconcileAssetsStats;
};

export type ReconcileAssetsOptions = {
  repoRoot: string;
  stem: string;
  dryRun?: boolean;
  onWarn?: (message: string) => void;
  now?: () => number;
};

export class ReconcileAssetsProjectNotFoundError extends Error {
  readonly code = "PROJECT_NOT_FOUND";
  readonly projectDir: string;

  constructor(projectDir: string) {
    super(`project not found: ${projectDir}`);
    this.name = "ReconcileAssetsProjectNotFoundError";
    this.projectDir = projectDir;
  }
}

const LEGACY_ID_RE = /^ast_[0-9a-f]{16}$/;
const CANONICAL_ID_RE = /^ast_[0-9a-f]{32}$/;
const REMOTE_URL_RE = /^[a-z]+:\/\//i;
const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;

export const parseReconcileAssetsArgs = (argv: readonly string[]): Args => {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    const next = argv[i + 1];
    if (tok === "--project" && next) {
      out.project = next;
      i++;
    } else if (tok === "--dry-run") {
      out.dryRun = true;
    }
  }
  return out;
};

export const formatReconcileAssetsResult = (result: ReconcileAssetsResult): string[] => {
  const lines = [
    `[mv:reconcile] ${result.stem}`,
    `  scanned: ${result.stats.scanned}`,
    `  added: ${result.stats.added}`,
    `  moved: ${result.stats.moved}`,
    `  updated: ${result.stats.updated}`,
    `  reactivated: ${result.stats.reactivated}`,
    `  marked missing: ${result.stats.missing}`,
    `  ambiguous: ${result.stats.ambiguous}`,
    `  registry version: 2`,
  ];

  if (result.dryRun) {
    lines.push("", "[dry-run] no files written");
    return lines;
  }

  if (!result.changed) {
    lines.push("  ✓ registry is in sync");
    return lines;
  }

  lines.push("  ✓ assets.json updated");
  return lines;
};

const stableRegistrySignature = (registry: RegistryFileV2): string =>
  JSON.stringify(registry, (key, value) => (key === "updatedAt" ? "__updatedAt__" : value));

const kindFromFilename = (name: string): AssetKind | null => {
  if (/\.gif$/i.test(name)) return "gif";
  if (/\.(png|jpe?g|webp|avif|bmp|svg)$/i.test(name)) return "image";
  if (/\.(mp4|webm|mov|mkv|avi)$/i.test(name)) return "video";
  return null;
};

const normalizeLocalAssetPath = (value: string): string | null => {
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

const canonicalizePath = (path: string, projectStem: string, scope: AssetScope): string => {
  const normalizedInput = normalizeLocalAssetPath(path);
  if (!normalizedInput || hasUnsafePathSegments(normalizedInput)) {
    throw new Error(`unsafe asset path in registry: ${path}`);
  }
  const trimmed = normalizedInput;
  if (trimmed.startsWith("assets/") || trimmed.startsWith("projects/")) {
    return trimmed;
  }
  if (scope === "global") {
    return `assets/images/${basename(trimmed)}`;
  }
  return `projects/${projectStem}/${trimmed}`;
};

const stemFromPath = (path: string, projectStem: string): string | null => {
  if (path.startsWith("projects/")) {
    return path.split("/")[1] ?? projectStem;
  }
  return path.startsWith("assets/") ? null : projectStem;
};

const isAssetId = (value: string): boolean => LEGACY_ID_RE.test(value) || CANONICAL_ID_RE.test(value);

const createOpaqueId = (usedIds: Set<string>): `ast_${string}` => {
  while (true) {
    const id = `ast_${randomBytes(16).toString("hex")}` as const;
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
};

const readJsonFile = (filePath: string): unknown | null => {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
};

const writeJsonAtomic = (filePath: string, data: unknown): void => {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, filePath);
};

const hashFile = async (filePath: string): Promise<string | null> => {
  try {
    const bytes = await fs.readFile(filePath);
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
};

const buildRecord = (
  raw: unknown,
  projectStem: string,
  usedIds: Set<string>,
  now: number,
): ReconcileAssetRecord | null => {
  if (!raw || typeof raw !== "object") return null;

  const input = raw as Record<string, unknown>;
  const rawId = typeof input.id === "string" ? input.id : null;
  const legacyId = rawId && isLegacyAssetId(rawId) ? rawId : null;
  const canonicalId = rawId && isCanonicalAssetId(rawId)
    ? rawId
    : legacyId
      ? upgradeLegacyAssetId(legacyId)
      : null;
  if (!canonicalId) {
    throw new Error("Invalid asset record id in assets.json");
  }
  if (usedIds.has(canonicalId)) {
    throw new Error(`Duplicate canonical asset id during reconcile normalization: ${canonicalId}`);
  }
  usedIds.add(canonicalId);

  const rawPath = typeof input.path === "string" ? input.path : "";
  const kind: AssetKind =
    input.kind === "video" || input.kind === "gif" || input.kind === "image"
      ? input.kind
      : kindFromFilename(rawPath) ?? "image";
  const scope: AssetScope = input.scope === "global" ? "global" : "project";
  const path = canonicalizePath(rawPath, projectStem, scope);
  const aliases = Array.from(
    new Set<string>([
      ...(Array.isArray(input.aliases) ? input.aliases : []),
      ...(legacyId && legacyId !== canonicalId ? [legacyId] : []),
    ]),
  ).filter((value): value is `ast_${string}` => isAssetId(value)) as `ast_${string}`[];
  const pathHistory = Array.from(
    new Set<string>(
      Array.isArray(input.pathHistory)
        ? input.pathHistory.filter((value): value is string => typeof value === "string")
        : [],
    ),
  );
  const status: AssetStatus =
    input.status === "missing" || input.status === "tombstoned" ? input.status : "active";

  return {
    id: canonicalId,
    ...(aliases.length > 0 ? { aliases } : {}),
    path,
    pathHistory,
    kind,
    scope,
    stem:
      typeof input.stem === "string" || input.stem === null
        ? input.stem
        : stemFromPath(path, projectStem),
    status,
    missingSince: typeof input.missingSince === "number" ? input.missingSince : null,
    deletedAt: typeof input.deletedAt === "number" ? input.deletedAt : null,
    sizeBytes: typeof input.sizeBytes === "number" && Number.isFinite(input.sizeBytes) ? input.sizeBytes : 0,
    mtimeMs: typeof input.mtimeMs === "number" && Number.isFinite(input.mtimeMs) ? input.mtimeMs : 0,
    createdAt: typeof input.createdAt === "number" && Number.isFinite(input.createdAt) ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt) ? input.updatedAt : now,
    metadata: input.metadata && typeof input.metadata === "object" ? (input.metadata as AssetMetadata) : {},
    contentHash:
      typeof input.contentHash === "string" && input.contentHash.length > 0 ? input.contentHash : null,
    hashVersion: input.hashVersion === "sha256" ? "sha256" : null,
    ...(typeof input.label === "string" ? { label: input.label } : {}),
    ...(Array.isArray(input.tags)
      ? { tags: input.tags.filter((value): value is string => typeof value === "string") }
      : {}),
    ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
  };
};

const normalizeRegistry = (raw: unknown, projectStem: string, now: number): RegistryFileV2 => {
  if (raw == null) {
    return { version: 2, records: [] };
  }

  const parsed = AssetRegistryFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid assets.json: ${parsed.error.message}`);
  }

  const usedIds = new Set<string>();
  const rawRecords = (normalizeAssetRegistryFileV2(parsed.data as AssetRegistryFile)).records;

  const records: ReconcileAssetRecord[] = [];
  for (const entry of rawRecords) {
    const record = buildRecord(entry, projectStem, usedIds, now);
    if (record) records.push(record);
  }

  return { version: 2, records };
};

const loadRegistry = (assetsPath: string, projectStem: string, now: number): { raw: unknown | null; registry: RegistryFileV2 } => {
  const raw = readJsonFile(assetsPath);
  return { raw, registry: normalizeRegistry(raw, projectStem, now) };
};

const buildIndexes = (registry: RegistryFileV2) => {
  const byPath = new Map<string, ReconcileAssetRecord[]>();
  const byHistory = new Map<string, ReconcileAssetRecord[]>();

  for (const record of registry.records) {
    if (!byPath.has(record.path)) byPath.set(record.path, []);
    byPath.get(record.path)?.push(record);
    for (const previousPath of record.pathHistory) {
      if (!byHistory.has(previousPath)) byHistory.set(previousPath, []);
      byHistory.get(previousPath)?.push(record);
    }
  }

  return { byPath, byHistory };
};

const pickFirstAvailable = <T extends { id: string }>(
  candidates: T[] | undefined,
  claimed: Set<string>,
): T | null => {
  if (!candidates || candidates.length === 0) return null;
  const available = candidates.filter((candidate) => !claimed.has(candidate.id));
  if (available.length === 0) return null;
  return available[0] ?? null;
};

const uniqueCandidate = <T extends { id: string }>(
  candidates: T[] | undefined,
  claimed: Set<string>,
): T | null => {
  if (!candidates || candidates.length === 0) return null;
  const available = candidates.filter((candidate) => !claimed.has(candidate.id));
  if (available.length === 1) return available[0] ?? null;
  return null;
};

const scanAssetDir = async (
  root: string,
  scope: AssetScope,
  stem: string | null,
  relPrefix: string,
): Promise<ScanFile[]> => {
  const entries: ScanFile[] = [];
  if (!existsSync(root)) return entries;

  const walk = async (dir: string, rel: string): Promise<void> => {
    let dirents: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      if (dirent.name.startsWith(".")) continue;
      const full = join(dir, dirent.name);
      let stat: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        stat = await fs.lstat(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;

      const nextRel = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (stat.isDirectory()) {
        await walk(full, nextRel);
        continue;
      }

      if (!stat.isFile()) continue;
      const kind = kindFromFilename(dirent.name);
      if (!kind) continue;

      entries.push({
        path: nextRel.replace(/^\/+/, ""),
        kind,
        scope,
        stem,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        contentHash: await hashFile(full),
      });
    }
  };

  await walk(root, relPrefix);
  return entries;
};

const scanDisk = async (
  repoRoot: string,
  projectDir: string,
  stem: string,
): Promise<ScanFile[]> => {
  const out: ScanFile[] = [];
  const globalRoots: Array<[string, string]> = [
    [join(repoRoot, "public", "assets", "images"), "assets/images"],
    [join(repoRoot, "public", "assets", "gifs"), "assets/gifs"],
    [join(repoRoot, "public", "assets", "videos"), "assets/videos"],
  ];
  for (const [root, prefix] of globalRoots) {
    out.push(...(await scanAssetDir(root, "global", null, prefix)));
  }

  const projectRoots: Array<[string, string]> = [
    [join(projectDir, "images"), `projects/${stem}/images`],
    [join(projectDir, "gifs"), `projects/${stem}/gifs`],
    [join(projectDir, "videos"), `projects/${stem}/videos`],
  ];
  for (const [root, prefix] of projectRoots) {
    out.push(...(await scanAssetDir(root, "project", stem, prefix)));
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
};

const updateRecordFromFile = async (
  record: ReconcileAssetRecord,
  file: ScanFile,
  repoRoot: string,
  repoProjectsDir: string,
  now: number,
): Promise<{ moved: boolean; updated: boolean; reactivated: boolean }> => {
  const previousPath = record.path;
  const nextMetadata = await probeAsset(repoRoot, repoProjectsDir, file.path, file.kind);
  const nextHistory =
    previousPath !== file.path
      ? [...record.pathHistory.filter((entry) => entry !== previousPath), previousPath]
      : record.pathHistory;
  const nextRecord: ReconcileAssetRecord = {
    ...record,
    path: file.path,
    pathHistory: nextHistory,
    kind: file.kind,
    scope: file.scope,
    stem: file.stem,
    status: "active",
    missingSince: null,
    deletedAt: null,
    sizeBytes: file.sizeBytes,
    mtimeMs: file.mtimeMs,
    metadata: nextMetadata,
    contentHash: file.contentHash,
    hashVersion: file.contentHash ? "sha256" : null,
  };
  const changed = JSON.stringify(record) !== JSON.stringify(nextRecord);

  if (!changed) {
    return { moved: false, updated: false, reactivated: false };
  }

  const moved = previousPath !== file.path;
  const reactivated = record.status === "missing";
  const updated = !moved && !reactivated;

  record.path = nextRecord.path;
  record.pathHistory = nextRecord.pathHistory;
  record.kind = nextRecord.kind;
  record.scope = nextRecord.scope;
  record.stem = nextRecord.stem;
  record.status = nextRecord.status;
  record.missingSince = nextRecord.missingSince;
  record.deletedAt = nextRecord.deletedAt;
  record.sizeBytes = nextRecord.sizeBytes;
  record.mtimeMs = nextRecord.mtimeMs;
  record.metadata = nextRecord.metadata;
  record.contentHash = nextRecord.contentHash;
  record.hashVersion = nextRecord.hashVersion;
  record.updatedAt = now;
  return { moved, updated, reactivated };
};

const ensureNewRecord = async (
  file: ScanFile,
  registry: RegistryFileV2,
  projectStem: string,
  repoRoot: string,
  repoProjectsDir: string,
  now: number,
): Promise<ReconcileAssetRecord> => {
  const record: ReconcileAssetRecord = {
    id: createOpaqueId(new Set(registry.records.map((entry) => entry.id))),
    path: file.path,
    pathHistory: [],
    kind: file.kind,
    scope: file.scope,
    stem: file.stem ?? stemFromPath(file.path, projectStem),
    status: "active",
    missingSince: null,
    deletedAt: null,
    sizeBytes: file.sizeBytes,
    mtimeMs: file.mtimeMs,
    createdAt: now,
    updatedAt: now,
    metadata: await probeAsset(repoRoot, repoProjectsDir, file.path, file.kind),
    contentHash: file.contentHash,
    hashVersion: file.contentHash ? "sha256" : null,
    label: basename(file.path),
  };
  registry.records.push(record);
  return record;
};

export const reconcileAssets = async (
  options: ReconcileAssetsOptions,
): Promise<ReconcileAssetsResult> => {
  const repoRoot = resolve(options.repoRoot);
  const stem = options.stem;
  const dryRun = options.dryRun === true;
  const now = options.now ?? Date.now;
  const repoProjectsDir = resolveProjectsDir(repoRoot);
  const projectDir = resolveProjectDir(repoRoot, stem);

  if (!existsSync(projectDir)) {
    throw new ReconcileAssetsProjectNotFoundError(projectDir);
  }

  const assetsPath = join(projectDir, "assets.json");
  const originalRegistryJson = existsSync(assetsPath) ? readFileSync(assetsPath, "utf8") : null;
  const { raw, registry } = loadRegistry(assetsPath, stem, now());
  const registryBefore = JSON.parse(JSON.stringify(registry)) as RegistryFileV2;
  const registryBeforeStable =
    originalRegistryJson == null
      ? null
      : stableRegistrySignature(JSON.parse(originalRegistryJson) as RegistryFileV2);
  const indexes = buildIndexes(registry);
  const diskFiles = await scanDisk(repoRoot, projectDir, stem);

  const claimed = new Set<string>();
  const fileAssignments = new Map<string, string>();
  const stats: ReconcileAssetsStats = {
    scanned: diskFiles.length,
    added: 0,
    updated: 0,
    moved: 0,
    reactivated: 0,
    missing: 0,
    ambiguous: 0,
    normalized:
      raw == null || (raw && typeof raw === "object" && (raw as RawRegistryFile).version !== 2)
        ? 1
        : 0,
  };

  for (const file of diskFiles) {
    const exactCandidates = indexes.byPath.get(file.path);
    if (exactCandidates && exactCandidates.length > 1) {
      stats.ambiguous += 1;
      options.onWarn?.(
        `[mv:reconcile] ambiguous exact-path match for ${file.path}; creating a new record instead`,
      );
      const newRecord = await ensureNewRecord(file, registry, stem, repoRoot, repoProjectsDir, now());
      claimed.add(newRecord.id);
      fileAssignments.set(file.path, newRecord.id);
      stats.added += 1;
      continue;
    }

    const exact = pickFirstAvailable(exactCandidates, claimed);
    if (exact) {
      claimed.add(exact.id);
      fileAssignments.set(file.path, exact.id);
      const update = await updateRecordFromFile(exact, file, repoRoot, repoProjectsDir, now());
      if (update.moved) stats.moved += 1;
      if (update.updated) stats.updated += 1;
      if (update.reactivated) stats.reactivated += 1;
      continue;
    }

    const historical = uniqueCandidate(indexes.byHistory.get(file.path), claimed);
    if (historical) {
      claimed.add(historical.id);
      fileAssignments.set(file.path, historical.id);
      const update = await updateRecordFromFile(historical, file, repoRoot, repoProjectsDir, now());
      if (update.moved) stats.moved += 1;
      if (update.updated) stats.updated += 1;
      if (update.reactivated) stats.reactivated += 1;
    }
  }

  const missingCandidates = registry.records.filter(
    (record) => record.status !== "tombstoned" && !claimed.has(record.id),
  );
  const missingByHash = new Map<string, ReconcileAssetRecord[]>();
  for (const record of missingCandidates) {
    if (!record.contentHash) continue;
    if (!missingByHash.has(record.contentHash)) missingByHash.set(record.contentHash, []);
    missingByHash.get(record.contentHash)?.push(record);
  }

  for (const file of diskFiles) {
    if (fileAssignments.has(file.path)) continue;

    const candidates = file.contentHash ? missingByHash.get(file.contentHash) ?? [] : [];
    if (candidates.length === 1) {
      const record = candidates[0];
      if (!record || claimed.has(record.id)) {
        const newRecord = await ensureNewRecord(file, registry, stem, repoRoot, repoProjectsDir, now());
        claimed.add(newRecord.id);
        fileAssignments.set(file.path, newRecord.id);
        stats.added += 1;
        continue;
      }

      claimed.add(record.id);
      fileAssignments.set(file.path, record.id);
      const update = await updateRecordFromFile(record, file, repoRoot, repoProjectsDir, now());
      if (update.moved) stats.moved += 1;
      if (update.updated) stats.updated += 1;
      if (update.reactivated) stats.reactivated += 1;
      continue;
    }

    if (candidates.length > 1) {
      stats.ambiguous += 1;
      options.onWarn?.(
        `[mv:reconcile] ambiguous duplicate-content match for ${file.path}; creating a new record instead`,
      );
    }

    const newRecord = await ensureNewRecord(file, registry, stem, repoRoot, repoProjectsDir, now());
    claimed.add(newRecord.id);
    fileAssignments.set(file.path, newRecord.id);
    stats.added += 1;
  }

  const missingAt = now();
  for (const record of registry.records) {
    if (record.status === "tombstoned") continue;
    if (claimed.has(record.id)) continue;
    if (record.status !== "missing") {
      record.status = "missing";
      record.missingSince = record.missingSince ?? missingAt;
      record.updatedAt = missingAt;
      stats.missing += 1;
    } else if (record.missingSince == null) {
      record.missingSince = missingAt;
    }
  }

  const changed =
    registryBeforeStable == null
      ? registry.records.length > 0
      : registryBeforeStable !== stableRegistrySignature(registry);

  if (!changed) {
    registry.records.splice(0, registry.records.length, ...registryBefore.records);
    stats.updated = 0;
  }

  const wrote = !dryRun && changed;

  if (wrote) {
    writeJsonAtomic(assetsPath, registry);
  }

  return {
    stem,
    dryRun,
    changed,
    wrote,
    assetsPath,
    registry,
    stats,
  };
};
