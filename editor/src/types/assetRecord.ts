/**
 * Asset ID format: ast_<16-hex-chars>
 */
export type AssetId = `ast_${string}`;

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

/**
 * Persistent asset record.
 * ID is stable across file renames/moves.
 */
export type AssetRecord = {
  id: AssetId;
  path: string;
  kind: "image" | "video" | "gif";
  scope: "global" | "project";
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
 * Asset registry file format.
 */
export type AssetRegistryFile = {
  version: 1;
  records: AssetRecord[];
};

/**
 * Generate a stable asset ID from path using a browser-safe FNV-1a 64-bit hash.
 * Format: ast_<16-char-hash>
 */
export function generateAssetId(path: string): AssetId {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < path.length; i += 1) {
    hash ^= BigInt(path.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }

  const hashHex = hash.toString(16).padStart(16, "0");
  const stableHash = hashHex.slice(0, 16);
  return `ast_${stableHash}`;
}

/**
 * Validate that a string is a properly formatted asset ID.
 */
export function isValidAssetId(id: string): id is AssetId {
  return /^ast_[0-9a-f]{16}$/.test(id);
}
