#!/usr/bin/env tsx
// scripts/cli/migrate-timeline-assets.ts
//
// One-time migration CLI: convert legacy timeline.json paths → asset IDs.
//
// Phase 1 migration strategy: existing projects have paths in element props
// (imageSrc, gifSrc, videoSrc, images[], etc.). This script:
//
//   1. Scans timeline.json for all media paths (mediaFields-targeted + heuristic fallback)
//   2. Ensures each path has an AssetRecord in assets.json (creates if missing)
//   3. Probes media files to populate AssetMetadata (dimensions, duration, codec)
//   4. Rewrites element props to use asset IDs instead of paths
//   5. Atomic backups + dual-file atomic write (timeline + assets)
//   6. Creates .migrated flag file on success
//
// Usage:
//   npm run migrate:assets -- --project love-in-traffic
//   npm run migrate:assets -- --project love-in-traffic --dry-run
//
// Output:
//   - projects/<stem>/timeline.backup-<timestamp>.json
//   - projects/<stem>/assets.json (created or appended)
//   - projects/<stem>/timeline.json (rewritten with asset IDs, _migrated flag)
//   - projects/<stem>/.migrated (flag file)

import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  findAssetByPath,
  generateAssetId,
  readAssetsJson,
  writeAssetsJson,
} from "./asset-registry";
import type { AssetRecord } from "../../editor/src/types/assetRecord";
import { resolveProjectDir, resolveProjectsDir } from "./paths";
import { ELEMENT_REGISTRY } from "../../src/compositions/elements/registry";
import { probeAsset, resolveAssetDiskPath } from "./probe-media";

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

// Check if already migrated
const migratedFlagPath = join(projectDir, ".migrated");
if (existsSync(migratedFlagPath)) {
  console.log(`[migrate-timeline-assets] ${stem}`);
  console.log(`  ✓ already migrated (.migrated flag exists)`);
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

  const MEDIA_FIELDS = new Set([
    "imageSrc", "videoSrc", "gifSrc", "jsonSrc",
    "backgroundImage", "backgroundGif", "backgroundVideo",
    "images", "videos", "gifs",
  ]);

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

  const ensureAssetRecord = async (path: string): Promise<string> => {
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
      const fullPath = resolveAssetDiskPath(repoRoot, path);
      const stats = statSync(fullPath);
      sizeBytes = stats.size;
      mtimeMs = stats.mtimeMs;
    } catch {
      // File doesn't exist on disk — create placeholder record anyway
      // (allows migration of timelines referencing missing assets)
    }

    // Probe metadata for existing files
    const metadata = await probeAsset(repoRoot, path, kind);

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
      metadata,
      label: path.split("/").pop() || path,
    };

    records.push(newRecord);
    pathsToMigrate.set(path, id);
    newAssetCount++;
    return id;
  };

  /**
   * Migrate a single value: if it's a path-looking string, convert to asset ID.
   * Recurses into arrays and objects.
   */
  const migrateValue = async (value: unknown, fieldName?: string): Promise<unknown> => {
    if (typeof value === "string") {
      // Only migrate values in known media fields or arrays within them
      if (fieldName && MEDIA_FIELDS.has(fieldName) && (MEDIA_EXT.test(value) || value.includes("/"))) {
        return ensureAssetRecord(value);
      }
      return value;
    }

    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => migrateValue(item, fieldName)));
    }

    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = await migrateValue(v, k);
      }
      return result;
    }

    return value;
  };

  /**
   * Migrate element props using mediaFields from ELEMENT_REGISTRY when available.
   * Falls back to full recursive heuristic scan for unknown element types.
   */
  const migrateElementProps = async (
    elementType: string,
    props: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const moduleDef = ELEMENT_REGISTRY[elementType];
    const mediaFields = moduleDef?.mediaFields;

    if (!mediaFields || mediaFields.length === 0) {
      // No media fields declared — fall back to recursive heuristic scan
      return migrateValue(props) as Promise<Record<string, unknown>>;
    }

    // Targeted migration: only touch declared media fields
    const migrated: Record<string, unknown> = { ...props };
    for (const field of mediaFields) {
      const raw = props[field.name];
      if (raw === undefined || raw === null) continue;

      if (field.multi && Array.isArray(raw)) {
        migrated[field.name] = await Promise.all(
          raw.map((item) =>
            typeof item === "string" && (PATH_LIKE.test(item) || MEDIA_EXT.test(item))
              ? ensureAssetRecord(item)
              : item
          )
        );
      } else if (typeof raw === "string") {
        if (PATH_LIKE.test(raw) || MEDIA_EXT.test(raw)) {
          migrated[field.name] = await ensureAssetRecord(raw);
        }
      }
    }

    return migrated;
  };

  // ---- Process each element ----
  const migratedElements = [];
  for (const element of timeline.elements) {
    const originalProps = JSON.stringify(element.props);
    const migratedProps = await migrateElementProps(element.type, element.props);
    const changed = JSON.stringify(migratedProps) !== originalProps;

    if (changed) {
      updatedElementCount++;
    }

    migratedElements.push({
      ...element,
      props: migratedProps,
    });
  }

  // ---- Report ----
  console.log(`\n[migrate-timeline-assets] ${stem}`);
  console.log(`  found ${timeline.elements.length} elements`);
  console.log(`  discovered ${pathsToMigrate.size} unique asset paths`);
  console.log(`  created ${newAssetCount} new asset records`);
  console.log(`  updated ${updatedElementCount} elements with asset IDs`);

  if (pathsToMigrate.size === 0) {
    console.log(`  ✓ no migration needed — timeline has no media paths`);
    // Still write .migrated flag so we don't scan again
    if (!args.dryRun) {
      writeFileSync(migratedFlagPath, new Date().toISOString(), "utf-8");
    }
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
  const timestamp =
    new Date().toISOString().replace(/[:.]/g, "-").split("T")[0] +
    "-" +
    Date.now();
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

  const migratedTimeline = {
    ...timeline,
    _migrated: true,
    elements: migratedElements,
  };

  try {
    // Step 1: Write timeline to tmp file
    writeFileSync(
      timelineTmpPath,
      JSON.stringify(migratedTimeline, null, 2),
      "utf-8"
    );

    // Step 2: Write assets.json (internally uses tmp+rename, already atomic)
    await writeAssetsJson(projectsDir, stem, { version: 1, records });

    // Step 3: Atomic rename timeline tmp → final
    renameSync(timelineTmpPath, timelinePath);

    // Step 4: Write .migrated flag
    writeFileSync(migratedFlagPath, new Date().toISOString(), "utf-8");

    console.log(`  ✓ timeline.json migrated`);
    console.log(`  ✓ assets.json updated`);
    console.log(`  ✓ .migrated flag created`);
    console.log(`\n[success] migration complete`);
  } catch (e) {
    console.error(`\n[error] migration failed: ${e}`);

    // Rollback: restore timeline from backup
    try {
      if (existsSync(timelineTmpPath)) {
        unlinkSync(timelineTmpPath);
      }
      if (existsSync(backupPath)) {
        copyFileSync(backupPath, timelinePath);
        console.log(`  ✓ restored timeline.json from backup`);
      }
      // assets.json write is additive — extra records are harmless
    } catch (rollbackErr) {
      console.error(`  [error] rollback also failed: ${rollbackErr}`);
    }
    console.error(`  backup preserved at: ${backupPath}`);
    process.exit(1);
  }
})();
