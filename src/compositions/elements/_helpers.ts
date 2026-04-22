import { z } from "zod";

export const makeZ = <S extends z.ZodRawShape>(shape: S) => z.object(shape);

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const expDecay = (timeSince: number, decay: number) =>
  Math.exp(-decay * Math.max(0, timeSince));

export const gaussian = (t: number, peak: number, sigma: number) =>
  Math.exp(-((t - peak) ** 2) / (2 * sigma * sigma));

export const FONT_STACK = "'Helvetica Neue', Helvetica, Inter, system-ui, sans-serif";

/**
 * Resolve a static asset path, handling asset IDs, HTTP URLs, and local paths.
 * Asset IDs (ast_...) are resolved via the asset registry passed in assetRegistry.
 * HTTP URLs and absolute paths (/...) pass through.
 * Relative paths go through staticFile().
 *
 * @param src - Source path (asset ID, URL, or relative path)
 * @param staticFile - Remotion's staticFile() function
 * @param assetRegistry - Optional asset registry from RenderCtx
 * @returns Resolved URL/path
 */
export const resolveStatic = (
  src: string,
  staticFile: (s: string) => string,
  assetRegistry?: Array<{ id: string; path: string; aliases?: string[] }> | null,
): string => {
  // HTTP URLs and absolute paths pass through
  if (src.startsWith("http") || src.startsWith("/")) return src;

  // Asset IDs: resolve via registry if available
  if (/^ast_(?:[0-9a-f]{16}|[0-9a-f]{32})$/.test(src)) {
    if (!assetRegistry || assetRegistry.length === 0) {
      console.warn(`[resolveStatic] asset ID ${src} requires assetRegistry in RenderCtx`);
      return src; // Will fail visibly at render time
    }

    const record = assetRegistry.find((r) => r.id === src || r.aliases?.includes(src));
    if (!record) {
      console.warn(`[resolveStatic] asset ID not found in registry: ${src}`);
      return src;
    }

    // Found the record, now resolve the path through staticFile
    return staticFile(record.path);
  }

  // Legacy relative paths
  return staticFile(src);
};
