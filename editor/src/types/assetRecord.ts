import { z } from "zod";

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

// ---------------------------------------------------------------------------
// Zod schemas for runtime validation
// ---------------------------------------------------------------------------

export const AssetMetadataSchema = z.object({
  width: z.number().optional(),
  height: z.number().optional(),
  durationSec: z.number().optional(),
  hasAlpha: z.boolean().optional(),
  fps: z.number().optional(),
  codec: z.string().optional(),
});

export const AssetRecordSchema = z.object({
  id: z.string().regex(/^ast_[0-9a-f]{16}$/, "Invalid asset ID format"),
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

export const AssetRegistryFileSchema = z.object({
  version: z.literal(1),
  records: z.array(AssetRecordSchema),
});

/**
 * Generate a unique asset ID using timestamp + random hex.
 * Format: ast_<16-char-hex>
 * IDs are opaque and rename-stable — path is stored separately.
 */
export function generateAssetId(path: string): AssetId {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < path.length; i += 1) {
    hash ^= BigInt(path.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }

  const hashHex = hash.toString(16).padStart(16, "0");
  return `ast_${hashHex}`;
}

export function isValidAssetId(id: string): id is AssetId {
  return /^ast_[0-9a-f]{16}$/.test(id);
}
