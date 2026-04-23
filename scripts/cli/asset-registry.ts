// scripts/cli/asset-registry.ts
//
// Node.js utilities for asset registry operations.
// CLI-compatible versions of the browser functions in editor/src/lib/assetRecordStore.ts
//
// The asset registry at projects/<stem>/assets.json stores persistent metadata
// for all project assets (images, videos, GIFs). v2 canonical IDs are opaque,
// while legacy v1 path-hash IDs remain readable as compatibility aliases.
//
// Migration scripts use these functions to read/write the registry from Node.js
// without running the editor.

import { promises as fs, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AssetId,
  AssetRecord,
  AssetRegistryFile,
  AssetRegistryFileV2,
  CanonicalAssetId,
  LegacyAssetId,
} from "../../editor/src/types/assetRecord";
import {
  AssetRegistryFileSchema,
  AssetRegistryFileV2Schema,
  generateCanonicalAssetId as generateCanonicalAssetIdFromTypes,
  generateAssetId as generateLegacyAssetId,
  generateOpaqueAssetId as generateOpaqueAssetIdFromTypes,
  isAssetId as isAssetIdFromTypes,
  isCanonicalAssetId as isCanonicalAssetIdFromTypes,
  isLegacyAssetId as isLegacyAssetIdFromTypes,
  isValidAssetId as isValidAssetIdFromTypes,
  normalizeAssetRegistryFileV2,
} from "../../editor/src/types/assetRecord";

function formatValidationError(error: {
  issues: Array<{ path: Array<string | number>; message: string }>;
}): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
}

function toV2Registry(data: AssetRegistryFile): AssetRegistryFileV2 {
  const normalized = normalizeAssetRegistryFileV2(data);
  const result = AssetRegistryFileV2Schema.safeParse(normalized);

  if (!result.success) {
    throw new Error(`Invalid normalized assets.json: ${formatValidationError(result.error)}`);
  }

  return result.data;
}

/**
 * Read asset registry from projects/<stem>/assets.json.
 * Returns an empty v2 registry if the file doesn't exist.
 * Accepts both v1 and v2 on disk and normalizes to v2 in memory.
 */
export async function readAssetsJson(
  projectsDir: string,
  stem: string,
): Promise<AssetRegistryFileV2> {
  const filePath = join(projectsDir, stem, "assets.json");

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const raw = JSON.parse(content);
    const result = AssetRegistryFileSchema.safeParse(raw);

    if (!result.success) {
      console.error(`[asset-registry] Validation failed for ${filePath}:`, result.error.format());
      throw new Error(`Invalid assets.json: ${formatValidationError(result.error)}`);
    }

    return toV2Registry(result.data);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { version: 2, records: [] };
    }
    throw error;
  }
}

/**
 * Write asset registry to projects/<stem>/assets.json.
 * Uses atomic write (tmp + rename) to prevent corruption.
 * Accepts compatibility input and always writes strict v2.
 */
export async function writeAssetsJson(
  projectsDir: string,
  stem: string,
  data: AssetRegistryFile,
): Promise<void> {
  const filePath = join(projectsDir, stem, "assets.json");
  const tmpPath = `${filePath}.tmp`;
  const registry = toV2Registry(data);

  await fs.writeFile(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Synchronous version of writeAssetsJson for scaffold/setup scripts.
 * Accepts compatibility input and always writes strict v2.
 */
export function writeAssetsJsonSync(
  projectsDir: string,
  stem: string,
  data: AssetRegistryFile,
): void {
  const filePath = join(projectsDir, stem, "assets.json");
  const tmpPath = `${filePath}.tmp`;
  const registry = toV2Registry(data);

  writeFileSync(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, filePath);
}

/**
 * Find an asset record by its current path.
 * Returns null if not found.
 */
export function findAssetByPath(records: AssetRecord[], path: string): AssetRecord | null {
  return records.find((record) => record.path === path) || null;
}

/**
 * Find an asset record by canonical ID or legacy alias.
 * Returns null if not found.
 */
export function findAssetById(records: AssetRecord[], id: AssetId): AssetRecord | null {
  return (
    records.find((record) => {
      if (record.id === id) return true;
      return record.aliases?.some((alias) => alias === id) ?? false;
    }) || null
  );
}

/**
 * Generate the legacy path-derived asset ID.
 * Kept for compatibility with existing v1 workflows.
 */
export function generateAssetId(path: string): LegacyAssetId {
  return generateLegacyAssetId(path);
}

/**
 * Generate the canonical opaque v2 asset ID.
 */
export function generateCanonicalAssetId(): CanonicalAssetId {
  return generateCanonicalAssetIdFromTypes();
}

/**
 * Backward-compatible alias for the canonical opaque generator.
 */
export function generateOpaqueAssetId(): CanonicalAssetId {
  return generateOpaqueAssetIdFromTypes();
}

/**
 * Check if a string is a valid asset ID in either legacy or canonical format.
 */
export function isAssetId(value: string): value is AssetId {
  return isAssetIdFromTypes(value);
}

export function isLegacyAssetId(value: string): value is LegacyAssetId {
  return isLegacyAssetIdFromTypes(value);
}

export function isCanonicalAssetId(value: string): value is CanonicalAssetId {
  return isCanonicalAssetIdFromTypes(value);
}

/**
 * Backward-compatible alias for the broader asset ID validator.
 */
export function isValidAssetId(value: string): value is AssetId {
  return isValidAssetIdFromTypes(value);
}

/**
 * Resolve a path or asset ID to the actual file path.
 * Resolution precedence is canonical ID, then legacy alias, then raw path.
 */
export function resolveAssetPath(records: AssetRecord[], pathOrId: string): string | null {
  if (isAssetId(pathOrId)) {
    return findAssetById(records, pathOrId)?.path || null;
  }

  return pathOrId;
}
