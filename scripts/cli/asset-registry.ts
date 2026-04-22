// scripts/cli/asset-registry.ts
//
// Node.js utilities for asset registry operations.
// CLI-compatible versions of the browser functions in editor/src/lib/assetRecordStore.ts
//
// The asset registry at projects/<stem>/assets.json stores persistent metadata
// for all project assets (images, videos, GIFs). Each asset gets a stable ID
// (ast_<16chars>) that survives file renames/moves.
//
// Migration scripts use these functions to read/write the registry from Node.js
// without running the editor.

import { promises as fs, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AssetRecord,
  AssetRegistryFile,
  AssetId,
} from "../../editor/src/types/assetRecord";
import {
  isValidAssetId,
  AssetRegistryFileSchema,
} from "../../editor/src/types/assetRecord";

/**
 * Read asset registry from projects/<stem>/assets.json
 * Returns empty array if file doesn't exist.
 * Validates structure with Zod before returning.
 */
export async function readAssetsJson(
  projectsDir: string,
  stem: string
): Promise<{ version: number; records: AssetRecord[] }> {
  const filePath = join(projectsDir, stem, "assets.json");

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const raw = JSON.parse(content);

    // Validate with Zod schema
    const result = AssetRegistryFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(
        `[asset-registry] Validation failed for ${filePath}:`,
        result.error.format()
      );
      throw new Error(
        `Invalid assets.json: ${result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`
      );
    }

    return {
      version: result.data.version,
      records: result.data.records,
    };
  } catch (error: any) {
    // File doesn't exist yet, return empty registry
    if (error.code === "ENOENT") {
      return { version: 1, records: [] };
    }
    throw error;
  }
}

/**
 * Write asset registry to projects/<stem>/assets.json
 * Uses atomic write (tmp + rename) to prevent corruption.
 * Validates with Zod before writing.
 */
export async function writeAssetsJson(
  projectsDir: string,
  stem: string,
  data: { version: number; records: AssetRecord[] }
): Promise<void> {
  const filePath = join(projectsDir, stem, "assets.json");
  const tmpPath = `${filePath}.tmp`;

  const registry: AssetRegistryFile = {
    version: 1,
    records: data.records,
  };

  // Validate with Zod before writing
  const result = AssetRegistryFileSchema.safeParse(registry);
  if (!result.success) {
    console.error(
      `[asset-registry] Validation failed before write to ${filePath}:`,
      result.error.format()
    );
    throw new Error(
      `Cannot write invalid assets.json: ${result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`
    );
  }

  // Write to temp file first
  await fs.writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf-8");

  // Atomic rename
  await fs.rename(tmpPath, filePath);
}

/**
 * Synchronous version of writeAssetsJson for scaffold/setup scripts.
 * Used during project initialization when async is not needed.
 * Validates with Zod before writing.
 */
export function writeAssetsJsonSync(
  projectsDir: string,
  stem: string,
  data: { version: number; records: AssetRecord[] }
): void {
  const filePath = join(projectsDir, stem, "assets.json");

  const registry: AssetRegistryFile = {
    version: 1,
    records: data.records,
  };

  // Validate with Zod before writing
  const result = AssetRegistryFileSchema.safeParse(registry);
  if (!result.success) {
    console.error(
      `[asset-registry] Validation failed before sync write to ${filePath}:`,
      result.error.format()
    );
    throw new Error(
      `Cannot write invalid assets.json: ${result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`
    );
  }

  writeFileSync(filePath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

/**
 * Find an asset record by its path.
 * Returns null if not found.
 */
export function findAssetByPath(
  records: AssetRecord[],
  path: string
): AssetRecord | null {
  return records.find((r) => r.path === path) || null;
}

/**
 * Find an asset record by its ID.
 * Returns null if not found.
 */
export function findAssetById(
  records: AssetRecord[],
  id: AssetId
): AssetRecord | null {
  return records.find((r) => r.id === id) || null;
}

/**
 * Generate a unique asset ID using timestamp + random hex.
 * Format: ast_<16-char-hex>
 * IDs are opaque and rename-stable — path is stored separately.
 *
 * MUST match the browser version in editor/src/types/assetRecord.ts exactly.
 */
export function generateAssetId(path: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < path.length; i += 1) {
    hash ^= BigInt(path.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }

  const hashHex = hash.toString(16).padStart(16, "0");
  return `ast_${hashHex}`;
}

/**
 * Check if a string is a valid asset ID.
 */
export function isAssetId(value: string): boolean {
  return /^ast_[0-9a-f]{16}$/.test(value);
}

/**
 * Resolve a path or asset ID to the actual file path.
 * Dual-mode resolver: accepts both legacy paths and new asset IDs.
 *
 * @param records - Asset registry
 * @param pathOrId - Either a path string or an asset ID (ast_...)
 * @returns The resolved path, or null if asset ID not found
 */
export function resolveAssetPath(
  records: AssetRecord[],
  pathOrId: string
): string | null {
  if (isAssetId(pathOrId)) {
    const record = findAssetById(records, pathOrId as AssetId);
    return record?.path || null;
  }
  return pathOrId;
}
