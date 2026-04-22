import type {
  AssetRecord,
  AssetRegistryFile,
  AssetId,
} from "../types/assetRecord";
import { isValidAssetId } from "../types/assetRecord";

/**
 * Load asset registry from projects/<stem>/assets.json
 * Returns empty array if file doesn't exist.
 */
export async function loadAssetRegistry(stem: string): Promise<AssetRecord[]> {
  try {
    const response = await fetch(`/api/assets/registry/${stem}`);
    if (!response.ok) {
      if (response.status === 404) {
        // File doesn't exist yet, return empty array
        return [];
      }
      throw new Error(`Failed to load asset registry: ${response.statusText}`);
    }
    const registry: AssetRegistryFile = await response.json();
    return registry.records || [];
  } catch (error) {
    console.warn(`Failed to load asset registry for ${stem}:`, error);
    return [];
  }
}

/**
 * Save asset registry to projects/<stem>/assets.json
 * Uses atomic write (tmp + rename) on the backend.
 */
export async function saveAssetRegistry(
  stem: string,
  records: AssetRecord[]
): Promise<void> {
  const registry: AssetRegistryFile = {
    version: 1,
    records,
  };

  const response = await fetch(`/api/assets/registry/${stem}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(registry),
  });

  if (!response.ok) {
    throw new Error(`Failed to save asset registry: ${response.statusText}`);
  }
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
  // If it's a valid asset ID, resolve it
  if (isValidAssetId(pathOrId)) {
    const record = findAssetById(records, pathOrId);
    return record?.path || null;
  }

  // Legacy path string, pass through
  return pathOrId;
}
