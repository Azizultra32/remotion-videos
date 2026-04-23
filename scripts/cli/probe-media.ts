// scripts/cli/probe-media.ts
//
// Server-side media metadata extraction for the asset registry.
// Uses image-size for images/GIFs and ffprobe for video duration/codecs.
//
// This is the Node.js counterpart to editor/src/utils/assetMetadata.ts
// (browser-side scanning). Both produce the same AssetMetadata shape.

import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import * as imageSizeModule from "image-size";
import type { AssetMetadata } from "../../editor/src/types/assetRecord";

const nodeRequire = createRequire(import.meta.url);

const resolveImageSize = (): ((target: string) => { width?: number; height?: number }) => {
  const candidate =
    (typeof imageSizeModule === "function" ? imageSizeModule : null) ??
    ("default" in imageSizeModule && typeof imageSizeModule.default === "function"
      ? imageSizeModule.default
      : null) ??
    ("imageSize" in imageSizeModule && typeof imageSizeModule.imageSize === "function"
      ? imageSizeModule.imageSize
      : null);

  if (!candidate) {
    throw new Error("image-size loader unavailable");
  }

  return candidate as (target: string) => { width?: number; height?: number };
};

// ffprobe-client is CJS; load it through createRequire so this module stays
// usable from both tsx CLIs and the Vite sidecar config bundle.
const ffprobe = nodeRequire("ffprobe-client") as (
  target: string,
  config?: { path?: string }
) => Promise<{
  streams: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    pix_fmt?: string;
  }>;
  format?: {
    duration?: string;
    bit_rate?: string;
  };
}>;

/**
 * Probe an image or GIF file for dimensions.
 * GIFs also get duration via ffprobe when available.
 */
export function probeImage(
  absolutePath: string
): AssetMetadata {
  const metadata: AssetMetadata = {};

  try {
    const sizeOf = resolveImageSize();
    const dims = sizeOf(absolutePath);
    if (dims.width) metadata.width = dims.width;
    if (dims.height) metadata.height = dims.height;
  } catch {
    // image-size can fail on corrupt files — leave dimensions empty
  }

  // Rough alpha heuristic: PNG/WebP may have alpha.
  // True alpha detection requires parsing chunks; this is a best-effort hint.
  const ext = absolutePath.split(".").pop()?.toLowerCase();
  if (ext === "png" || ext === "webp") {
    metadata.hasAlpha = true;
  }

  return metadata;
}

/**
 * Probe a GIF file for dimensions and (optionally) duration.
 */
export async function probeGif(
  absolutePath: string
): Promise<AssetMetadata> {
  const metadata = probeImage(absolutePath);

  // Try ffprobe for GIF duration
  try {
    const data = await ffprobe(absolutePath);
    const fmtDur = data.format?.duration;
    if (fmtDur) {
      metadata.durationSec = parseFloat(fmtDur);
    }
  } catch {
    // ffprobe may not support all GIFs; ignore
  }

  return metadata;
}

/**
 * Probe a video file for dimensions, duration, fps, and codec.
 */
export async function probeVideo(
  absolutePath: string
): Promise<AssetMetadata> {
  const metadata: AssetMetadata = {};

  try {
    const data = await ffprobe(absolutePath);
    const videoStream = data.streams.find((s) => s.codec_type === "video");

    if (videoStream) {
      if (videoStream.width) metadata.width = videoStream.width;
      if (videoStream.height) metadata.height = videoStream.height;
      if (videoStream.codec_name) metadata.codec = videoStream.codec_name;

      // Parse frame rate (ffprobe returns "num/den" strings like "30/1" or "2997/100")
      const fpsStr = videoStream.r_frame_rate || videoStream.avg_frame_rate;
      if (fpsStr) {
        const [num, den] = fpsStr.split("/").map(Number);
        if (num && den) {
          metadata.fps = Math.round((num / den) * 100) / 100;
        }
      }
    }

    const fmtDur = data.format?.duration;
    if (fmtDur) {
      metadata.durationSec = parseFloat(fmtDur);
    }
  } catch {
    // ffprobe unavailable or file unreadable
  }

  return metadata;
}

/**
 * Resolve an asset path (as stored in AssetRecord.path) to an absolute disk path.
 * Global assets live under public/, project assets live under the resolved
 * projects root (MV_PROJECTS_DIR-aware).
 */
export function resolveAssetDiskPath(
  engineRoot: string,
  projectsDir: string,
  recordPath: string
): string {
  if (recordPath.startsWith("assets/")) {
    return join(engineRoot, "public", recordPath);
  }
  if (recordPath.startsWith("projects/")) {
    return join(projectsDir, recordPath.slice("projects/".length));
  }
  return join(engineRoot, recordPath);
}

/**
 * Probe any supported asset and return populated AssetMetadata.
 * This is the main entry point used by the migration script.
 */
export async function probeAsset(
  engineRoot: string,
  projectsDir: string,
  recordPath: string,
  kind: "image" | "video" | "gif"
): Promise<AssetMetadata> {
  const absolutePath = resolveAssetDiskPath(engineRoot, projectsDir, recordPath);

  // Verify file exists before probing
  try {
    statSync(absolutePath);
  } catch {
    return {};
  }

  switch (kind) {
    case "image":
      return probeImage(absolutePath);
    case "gif":
      return probeGif(absolutePath);
    case "video":
      return probeVideo(absolutePath);
    default:
      return {};
  }
}
