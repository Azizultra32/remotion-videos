#!/usr/bin/env tsx
// scripts/cli/migrate-timeline-assets.ts
//
// One-time migration CLI: convert legacy timeline.json paths → asset IDs.
//
// Phase 1 migration strategy: existing projects have paths in element props
// (imageSrc, gifSrc, videoSrc, images[], etc.). This script:
//
//   1. Scans timeline.json for all media paths
//   2. Ensures each path has an AssetRecord in assets.json (creates if missing)
//   3. Rewrites element props to use asset IDs instead of paths
//   4. Atomic backups + dual-file atomic write (timeline + assets)
//
// Usage:
//   npm run migrate:assets -- --project love-in-traffic
//   npm run migrate:assets -- --project love-in-traffic --dry-run
//
// Output:
//   - projects/<stem>/timeline.backup-<timestamp>.json
//   - projects/<stem>/assets.json (created or appended)
//   - projects/<stem>/timeline.json (rewritten with asset IDs)

import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  findAssetByPath,
  generateAssetId,
  readAssetsJson,
  writeAssetsJson,
} from "./asset-registry";
import type { AssetRecord } from "../../editor/src/types/assetRecord";
import { resolveProjectDir, resolveProjectsDir } from "./paths";

const repoRoot = resolve(__dirname, "..", "..");

// Timeline.json on-disk format (from useTimelineSync.ts)
type OnDiskTimeline = {
  version: 1;
  stem: string;
  fps: number;
  compositionDuration: number;
  elements: Array<{
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
  }>;
};

type Args = {
  project?: string;
  dryRun?: boolean;
};

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

const args = parseArgs();
if (!args.project) {
  console.error("usage: migrate:assets --project <stem> [--dry-run]");
  console.error("       migrates timeline.json paths → asset IDs");
  process.exit(1);
}

const stem = args.project;
const projectsDir = resolveProjectsDir(repoRoot);
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

// ---- Load timeline ----
const timelineContent = readFileSync(timelinePath, "utf-8");
let timeline: OnDiskTimeline;
try {
  timeline = JSON.parse(timelineContent) as OnDiskTimeline;
} catch (e) {
  console.error(`failed to parse timeline.json: ${e}`);
  process.exit(1);
}

// ---- Load or initialize asset registry ----
let assetsData: { version: number; records: AssetRecord[] };
(async () => {
  try {
    assetsData = await readAssetsJson(projectsDir, stem);
  } catch (e) {
    console.error(`failed to read assets.json: ${e}`);
    process.exit(1);
  }

  const records = assetsData.records;
  const pathsToMigrate = new Map<string, string>(); // path → asset ID
  let newAssetCount = 0;
  let updatedElementCount = 0;

  // ---- Scan all element props for media paths ----
  // Heuristic: detect fields that look like paths (contain "/" or end with known extensions)
  const MEDIA_FIELDS = [
    "imageSrc",
    "gifSrc",
    "videoSrc",
    "backgroundImage",
    "backgroundGif",
    "backgroundVideo",
    "images",
    "videos",
    "gifs",
  ];

  const PATH_LIKE = /^(assets\/|projects\/|\.\.\/|\/|~\/)/;
  const MEDIA_EXT = /\.(png|jpe?g|webp|avif|bmp|svg|gif|mp4|webm|mov|mkv|avi)$/i;

  const detectKind = (path: string): "image" | "video" | "gif" | null => {
    if (/\.gif$/i.test(path)) return "gif";
    if (/\.(png|jpe?g|webp|avif|bmp|svg)$/i.test(path)) return "image";
    if (/\.(mp4|webm|mov|mkv|avi)$/i.test(path)) return "video";
    return null;
  };

  const detectScope = (path: string): "global" | "project" => {
    if (path.startsWith("assets/")) return "global";
    if (path.startsWith("projects/")) return "project";
    return "project"; // default for relative paths
  };

  const ensureAssetRecord = (path: string): string => {
    // Check if we've already processed this path
    if (pathsToMigrate.has(path)) {
      return pathsToMigrate.get(path)!;
    }

    // Check if record exists in current registry
    let record = findAssetByPath(records, path);
    if (record) {
      pathsToMigrate.set(path, record.id);
      return record.id as string;
    }

    // Create new record
    const id = generateAssetId(path) as string;
    const kind = detectKind(path);
    if (!kind) {
      console.warn(`  [warn] cannot determine kind for path: ${path} — skipping`);
      return path; // Return original path, don't migrate
    }

    const scope = detectScope(path);
    const projectStem = scope === "project" ? stem : null;

    // Try to get file stats (may fail for non-existent files)
    let sizeBytes = 0;
    let mtimeMs = Date.now();
    try {
      const fullPath = join(repoRoot, "public", path);
      const stats = statSync(fullPath);
      sizeBytes = stats.size;
      mtimeMs = stats.mtimeMs;
    } catch {
      // File doesn't exist on disk — create placeholder record anyway
      // (allows migration of timelines referencing missing assets)
    }

    const now = Date.now();
    const newRecord: AssetRecord = {
      id: id as `ast_${string}`,
      path,
      kind,
      scope,
      stem: projectStem,
      sizeBytes,
      mtimeMs,
      createdAt: now,
      updatedAt: now,
      metadata: {},
      label: path.split("/").pop() || path,
    };

    records.push(newRecord);
    pathsToMigrate.set(path, id);
    newAssetCount++;
    return id;
  };

  const migrateValue = (value: unknown): unknown => {
    if (typeof value === "string") {
      // Check if this looks like a media path
      if (PATH_LIKE.test(value) || MEDIA_EXT.test(value)) {
        return ensureAssetRecord(value);
      }
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(migrateValue);
    }

    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = migrateValue(v);
      }
      return result;
    }

    return value;
  };

  // ---- Process each element ----
  const migratedElements = timeline.elements.map((element) => {
    const originalProps = JSON.stringify(element.props);
    const migratedProps = migrateValue(element.props) as Record<string, unknown>;
    const changed = JSON.stringify(migratedProps) !== originalProps;

    if (changed) {
      updatedElementCount++;
    }

    return {
      ...element,
      props: migratedProps,
    };
  });

  // ---- Report ----
  console.log(`\n[migrate-timeline-assets] ${stem}`);
  console.log(`  found ${timeline.elements.length} elements`);
  console.log(`  discovered ${pathsToMigrate.size} unique asset paths`);
  console.log(`  created ${newAssetCount} new asset records`);
  console.log(`  updated ${updatedElementCount} elements with asset IDs`);

  if (pathsToMigrate.size === 0) {
    console.log(`  ✓ no migration needed — timeline has no media paths`);
    process.exit(0);
  }

  if (args.dryRun) {
    console.log(`\n[dry-run] would migrate:`);
    for (const [path, id] of Array.from(pathsToMigrate.entries())) {
      console.log(`  ${path} → ${id}`);
    }
    console.log(`\n[dry-run] no files written`);
    process.exit(0);
  }

  // ---- Write backups ----
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0] + "-" + Date.now();
  const backupPath = join(projectDir, `timeline.backup-${timestamp}.json`);
  try {
    writeFileSync(backupPath, timelineContent, "utf-8");
    console.log(`  created backup: ${backupPath}`);
  } catch (e) {
    console.error(`  [error] failed to create backup: ${e}`);
    process.exit(1);
  }

  // ---- Atomic write: timeline + assets ----
  const timelineTmpPath = `${timelinePath}.tmp`;

  const migratedTimeline: OnDiskTimeline = {
    ...timeline,
    elements: migratedElements,
  };

  try {
    // Step 1: Write timeline to tmp file
    writeFileSync(timelineTmpPath, JSON.stringify(migratedTimeline, null, 2), "utf-8");

    // Step 2: Write assets.json (internally uses tmp+rename, already atomic)
    await writeAssetsJson(projectsDir, stem, { version: 1, records });

    // Step 3: Atomic rename timeline tmp → final
    renameSync(timelineTmpPath, timelinePath);
    console.log(`  ✓ timeline.json migrated`);
    console.log(`  ✓ assets.json updated`);
    console.log(`\n[success] migration complete`);
  } catch (e) {
    console.error(`\n[error] migration failed: ${e}`);

    // Rollback: restore timeline from backup
    try {
      if (existsSync(timelineTmpPath)) {
        // The tmp file was written but not yet renamed — delete it.
        // Don't rename it over the original (it contains migrated data).
        const { unlinkSync } = await import("node:fs");
        unlinkSync(timelineTmpPath);
      }
      // Restore original timeline from backup
      if (existsSync(backupPath)) {
        const { copyFileSync, unlinkSync } = await import("node:fs");
        copyFileSync(backupPath, timelinePath);
        console.log(`  ✓ restored timeline.json from backup`);
      }
      // Note: assets.json write is already committed (writeAssetsJson uses
      // atomic rename internally). Since asset records are additive (they
      // only add entries, never remove), a partial commit is safe — the
      // restored timeline still references paths, and the extra records in
      // assets.json are harmless.
    } catch (rollbackErr) {
      console.error(`  [error] rollback also failed: ${rollbackErr}`);
    }
    console.error(`  backup preserved at: ${backupPath}`);
    process.exit(1);
  }
})();
