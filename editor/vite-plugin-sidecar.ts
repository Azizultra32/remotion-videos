// vite-plugin-sidecar.ts
// Injects two endpoints into the Vite dev server that the editor calls:
//
//   POST /api/render   — spawn `npx remotion render` and stream progress
//   POST /api/chat     — invoke the local `claude` CLI (Max plan) and
//                        parse its JSON mutations into store actions.
//
// Both live in the dev server so we don't need a separate process.
// Lives inside editor/ but shells out from the repo root.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  type FSWatcher,
  promises as fs,
  watch as fsWatch,
  statSync,
  unlinkSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin, ViteDevServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { parseFileArg, sanitizeEditorPath } from "../scripts/cli/editorPath";
import {
  ensureProjectsDir,
  resolveProjectDir,
  resolveProjectsDir,
  syncStaticProjectsSymlink,
} from "../scripts/cli/paths";
import { probeAsset } from "../scripts/cli/probe-media";
import {
  ReconcileAssetsProjectNotFoundError,
  reconcileAssets,
} from "../scripts/cli/reconcile-assets-core";
import {
  type AssetId,
  type AssetMetadata,
  type AssetRecordV2,
  AssetRegistryFileSchema,
  createAssetRecord,
  isValidAssetId,
  normalizeAssetRegistryFileV2,
} from "./src/types/assetRecord";
import type {
  AssetDeleteRequest,
  AssetDeleteResponse,
  AssetEntry,
  AssetFolderDescriptor,
  AssetKind,
} from "./src/types/assets";
import { parseEventsFile, serializeEventsFile } from "./src/utils/eventsFile";
import { stemFromAudioSrc } from "./src/utils/url";

const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "out");
const ASSET_THUMB_DIR = path.join(OUT_DIR, "asset-thumbs");
// PROJECTS_DIR honours process.env.MV_PROJECTS_DIR (expanded and absolute-
// resolved); falls back to <engine>/projects for the default experience.
// The engine repo no longer tracks project content, so on fresh clones
// this dir is either empty or absent until a user scaffolds a track.
const PROJECTS_DIR = resolveProjectsDir(REPO_ROOT);
ensureProjectsDir(REPO_ROOT);
// Keep public/projects -> PROJECTS_DIR so Remotion renders that go through
// staticFile("projects/<stem>/audio.mp3") resolve correctly even when
// the user has relocated projects via MV_PROJECTS_DIR.
try {
  syncStaticProjectsSymlink(REPO_ROOT);
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn("[sidecar] could not sync public/projects symlink:", err);
}

// ---------------------------------------------------------------------------
// Analyze log / orphan status helpers
// ---------------------------------------------------------------------------
// Cap the per-project .analyze.log at ~10 MB. If the file is bigger than
// this at spawn time, we delete it and start fresh — cheaper than rotating
// and keeps recent failures readable without unbounded growth.
const ANALYZE_LOG_MAX_BYTES = 10 * 1024 * 1024;

// Open (or rotate) the per-project .analyze.log stream for a new run. Called
// from handleAnalyzeRun + handleAnalyzeSeedBeats right before spawning the
// child. Always appends; only truncates if the log is already over the 10 MB
// cap so multi-run history stays navigable via the `=== <ts> ... ===` headers.
const openAnalyzeLogStream = (
  projectDir: string,
  scriptLabel: string,
  args: readonly string[],
): import("node:fs").WriteStream => {
  const logPath = path.join(projectDir, ".analyze.log");
  try {
    const st = statSync(logPath);
    if (st.size > ANALYZE_LOG_MAX_BYTES) {
      unlinkSync(logPath);
    }
  } catch {
    /* file missing or stat failed — fine, appending creates it */
  }
  const stream = createWriteStream(logPath, { flags: "a" });
  const header = `\n=== ${new Date().toISOString()} ${scriptLabel} ${args.join(" ")} ===\n`;
  stream.write(header);
  return stream;
};

// Sweep orphaned .analyze-status.json files on sidecar boot.
// When vite is killed mid-run, the status file keeps startedAt set but never
// gets its endedAt. The SSE clients then show a permanent "Running..." until
// the user manually kicks off a new analysis. We don't record child PIDs in
// the status file (would require a migration), so we use updatedAt as a
// liveness proxy: if the mtime on the marker hasn't advanced in >60s, any
// child process writing to it would have died anyway.
const ORPHAN_STALE_MS = 60_000;

const reconcileOrphanStatusFiles = async (projectsDir: string): Promise<void> => {
  let entries: string[];
  try {
    entries = await fs.readdir(projectsDir);
  } catch {
    return; // projects dir doesn't exist yet — nothing to reconcile.
  }
  const now = Date.now();
  for (const name of entries) {
    const projectDir = path.join(projectsDir, name);
    let isDir = false;
    try {
      const st = await fs.stat(projectDir);
      isDir = st.isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const statusFile = path.join(projectDir, ".analyze-status.json");
    let raw: string;
    try {
      raw = await fs.readFile(statusFile, "utf8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    if (!parsed.startedAt || parsed.endedAt) continue;
    const lastTouch = typeof parsed.updatedAt === "number" ? parsed.updatedAt : parsed.startedAt;
    if (now - lastTouch < ORPHAN_STALE_MS) continue;
    const reconciled = {
      ...parsed,
      phase: "orphaned-at-boot",
      endedAt: now,
      updatedAt: now,
    };
    const tmp = `${statusFile}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(reconciled, null, 2));
      await fs.rename(tmp, statusFile);
      // eslint-disable-next-line no-console
      console.log(
        `[sidecar] reconciled orphan analyze run for ${name} (stale ${now - lastTouch}ms)`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[sidecar] failed to reconcile orphan status for ${name}:`, err);
    }
  }
};

// Fire-and-forget: boot-time orphan sweep. We don't block plugin init on it.
void reconcileOrphanStatusFiles(PROJECTS_DIR);

const _PUBLIC_DIR = path.join(REPO_ROOT, "public"); // kept for legacy engine assets (fonts, etc.)

// Per-stem in-process lock so concurrent /api/timeline/save calls don't
// interleave their writes. Each write waits for the previous one on the
// same stem. Writes across different stems run independently.
const TIMELINE_LOCK = new Map<string, Promise<void>>();
// Separate lock for events.json writes — orthogonal to timeline.json, so
// parallel saves of both for the same stem are safe.
const EVENTS_LOCK = new Map<string, Promise<void>>();
// Separate lock for assets.json writes — orthogonal to timeline/events.
const ASSETS_REGISTRY_LOCK = new Map<string, Promise<void>>();

const STEM_RE = /^[a-z0-9_-]+$/i;

// biome-ignore lint/suspicious/noExplicitAny: JSON.parse produces arbitrary shape; callers narrow at use site
const readJsonBody = (req: IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });

const sanitizeName = (n: string): string =>
  (n || "musicvideo").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60) || "musicvideo";

const sendSseEvent = (res: ServerResponse, event: string, data: unknown) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

// ---------------------------------------------------------------------------
// /api/songs   (GET — list projects under projects/<stem>/)
// ---------------------------------------------------------------------------
//
// Each direct subdirectory of projects/ is treated as one project (= one
// track). A project is "complete" if it has audio.mp3 (or audio.wav) plus
// analysis.json; it may also have timeline.json (editor state). Sizes
// reflect the audio file only.

type SongEntry = {
  stem: string;
  audioSrc: string; // path under projects/, e.g. "projects/love-in-traffic/audio.mp3"
  beatsSrc: string; // path under projects/, e.g. "projects/love-in-traffic/analysis.json"
  hasBeats: boolean; // true iff analysis.json exists
  hasTimeline: boolean;
  sizeBytes: number;
};

const handleSongs = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
  let projectEntries: Array<{ name: string; isDir: boolean }>;
  try {
    const ds = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    projectEntries = ds.map((d) => ({ name: d.name, isDir: d.isDirectory() }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "failed-to-read-projects", detail: String(err) }));
    return;
  }

  const songs: SongEntry[] = [];
  for (const entry of projectEntries) {
    if (!entry.isDir) continue;
    // Skip scratch/hidden dirs (e.g. _plans, .DS_Store) — they're not projects.
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const stem = entry.name;
    const projectDir = path.join(PROJECTS_DIR, stem);
    let files: string[];
    try {
      files = await fs.readdir(projectDir);
    } catch {
      continue;
    }
    const audioFile = files.find((f) => /^audio\.(mp3|wav)$/i.test(f));
    const hasBeats = files.includes("analysis.json");
    const hasTimeline = files.includes("timeline.json");
    let sizeBytes = 0;
    if (audioFile) {
      try {
        const st = await fs.stat(path.join(projectDir, audioFile));
        sizeBytes = st.size;
      } catch {
        // broken symlink / permissions — treat as 0 and surface the stem anyway
      }
    }
    songs.push({
      stem,
      audioSrc: audioFile ? `projects/${stem}/${audioFile}` : "",
      beatsSrc: `projects/${stem}/analysis.json`,
      hasBeats,
      hasTimeline,
      sizeBytes,
    });
  }

  songs.sort((a, b) => a.stem.localeCompare(b.stem));
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(songs));
};

// ---------------------------------------------------------------------------
// /api/projects/*  (GET — stream any file from projects/<stem>/<rest>)
// ---------------------------------------------------------------------------
//
// Replaces Vite's publicDir-based serving for per-project content. Supports
// nested paths inside a project (e.g. analysis/phase1-events.json). Path
// traversal is defended by resolving and comparing against PROJECTS_DIR.
//
// Honors HTTP Range for audio scrubbing — browsers require this for seekable
// audio elements to work smoothly.

const handleProjectFile = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  // Connect strips the "/api/projects/" mount; req.url here is
  // "/love-in-traffic/audio.mp3" or "/love-in-traffic/analysis/foo.json".
  const raw = (req.url ?? "").split("?")[0];
  const relPath = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (
    !relPath ||
    relPath.includes("\0") ||
    relPath.includes("\\") ||
    relPath.split("/").some((seg) => seg === "" || seg === "." || seg === "..")
  ) {
    res.statusCode = 400;
    res.end("bad path");
    return;
  }
  const full = path.resolve(PROJECTS_DIR, relPath);
  if (!full.startsWith(PROJECTS_DIR + path.sep)) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }
  const stat = await fs.stat(full).catch(() => null);
  if (!stat) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  if (stat.isDirectory()) {
    res.statusCode = 400;
    res.end("path is a directory");
    return;
  }
  const ext = path.extname(relPath).toLowerCase();
  const mime =
    ext === ".mp3"
      ? "audio/mpeg"
      : ext === ".wav"
        ? "audio/wav"
        : ext === ".m4a"
          ? "audio/mp4"
          : ext === ".mp4"
            ? "video/mp4"
            : ext === ".webm"
              ? "video/webm"
              : ext === ".mov"
                ? "video/quicktime"
                : ext === ".mkv"
                  ? "video/x-matroska"
                  : ext === ".avi"
                    ? "video/x-msvideo"
          : ext === ".json"
            ? "application/json"
            : ext === ".png"
              ? "image/png"
              : ext === ".jpg" || ext === ".jpeg"
                ? "image/jpeg"
                : ext === ".gif"
                  ? "image/gif"
                  : ext === ".webp"
                    ? "image/webp"
                    : ext === ".svg"
                      ? "image/svg+xml"
                      : ext === ".avif"
                        ? "image/avif"
                        : ext === ".bmp"
                          ? "image/bmp"
                  : ext === ".md"
                    ? "text/markdown; charset=utf-8"
                    : ext === ".txt"
                    ? "text/plain; charset=utf-8"
                    : "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");

  const { createReadStream } = await import("node:fs");
  const rangeHeader = req.headers.range;
  if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    const startStr = match?.[1] ?? "";
    const endStr = match?.[2] ?? "";
    const start = startStr === "" ? Math.max(0, stat.size - Number(endStr || 0)) : Number(startStr);
    const end = endStr === "" ? stat.size - 1 : Number(endStr);
    if (start >= stat.size || end >= stat.size || start > end) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${stat.size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    createReadStream(full, { start, end }).pipe(res);
    return;
  }
  res.setHeader("Content-Length", String(stat.size));
  createReadStream(full).pipe(res);
};

// ---------------------------------------------------------------------------
// /api/timeline/*  (GET + POST — read and write projects/<stem>/timeline.json)
// ---------------------------------------------------------------------------
//
// All writes to a project's timeline go through POST /api/timeline/save so
// the sidecar can serialize concurrent writers (GUI autosave + external
// Claude edits). Atomic write via tmp + rename.

const handleTimelineGet = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  // req.url is "/love-in-traffic" (the Connect mount strips "/api/timeline/")
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  const full = path.join(PROJECTS_DIR, stem, "timeline.json");
  let content: string;
  try {
    content = await fs.readFile(full, "utf8");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "timeline not found", stem }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(content);
};


// ---------------------------------------------------------------------------
// /api/assets/list   (GET — engine-wide + per-project asset inventory)
// ---------------------------------------------------------------------------
//
// Scans two roots for browsable media:
//   1. public/assets/{images,gifs,videos}/** — engine-level, available to any project
//   2. projects/<stem>/{images,gifs,videos}/** — per-project
//
// Returns items usable in staticFile() paths so BeatImageCycle / BeatVideoCycle
// / SpeedVideo / etc. can reference them by dropping the result path straight
// into their schema. Used by the AssetPicker UI in ElementDetail.
//
// GIFs are exposed as their own kind for consumers that want to create
// `overlay.gif` instead of treating them like generic still images. New GIF
// uploads land in dedicated gifs/ dirs, but list-scanning also classifies
// legacy .gif files found under images/ as kind:"gif" for backwards compat.

const GIF_EXT = /\.gif$/i;
const IMG_EXT = /\.(png|jpe?g|webp|avif|bmp|svg)$/i;
const VID_EXT = /\.(mp4|webm|mov|mkv|avi)$/i;

const kindFromFilename = (name: string): AssetKind | null => {
  if (GIF_EXT.test(name)) return "gif";
  if (IMG_EXT.test(name)) return "image";
  if (VID_EXT.test(name)) return "video";
  return null;
};

const kindFromMime = (mime: string): AssetKind | null => {
  if (mime === "image/gif") return "gif";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
};

const assetDirForKind = (kind: AssetKind): "images" | "gifs" | "videos" => {
  switch (kind) {
    case "image":
      return "images";
    case "gif":
      return "gifs";
    case "video":
      return "videos";
  }
};

const assetIdForPath = (assetPath: string): string =>
  createHash("sha1").update(assetPath).digest("hex").slice(0, 16);

const assetOriginalUrlForPath = (assetPath: string): string =>
  assetPath.startsWith("assets/")
    ? `/${assetPath}`
    : `/api/projects/${assetPath.replace(/^projects\//, "")}`;

const assetThumbnailUrlForPath = (assetPath: string, kind: AssetKind): string | null =>
  kind === "gif" ? `/api/assets/thumb?path=${encodeURIComponent(assetPath)}` : null;

const buildAssetFolderDescriptor = (directory: string): AssetFolderDescriptor => {
  const normalizedDirectory = directory === "." ? "" : directory.replace(/^\/+/, "");
  const segments = normalizedDirectory ? normalizedDirectory.split("/") : [];
  return {
    id: assetIdForPath(`folder:${normalizedDirectory}`),
    path: normalizedDirectory,
    name: segments[segments.length - 1] ?? "",
    segments,
  };
};

const buildAssetEntry = (params: {
  path: string;
  scope: "global" | "project";
  stem: string | null;
  kind: AssetKind;
  size: number;
  mtime: number;
}): AssetEntry => {
  const normalizedPath = params.path.replace(/^\/+/, "");
  const filename = path.posix.basename(normalizedPath);
  const extension = path.posix.extname(filename).toLowerCase();
  const basename = extension ? filename.slice(0, -extension.length) : filename;
  const directory = path.posix.dirname(normalizedPath);
  const originalUrl = assetOriginalUrlForPath(normalizedPath);
  const thumbnailUrl = assetThumbnailUrlForPath(normalizedPath, params.kind);
  return {
    id: assetIdForPath(normalizedPath),
    path: normalizedPath,
    filename,
    label: filename,
    basename,
    extension,
    directory,
    folder: buildAssetFolderDescriptor(directory),
    scope: params.scope,
    stem: params.stem,
    kind: params.kind,
    size: params.size,
    mtime: params.mtime,
    urls: {
      original: originalUrl,
      preview: thumbnailUrl ?? originalUrl,
      thumbnail: thumbnailUrl,
    },
    capabilities: {
      canDelete: true,
      canPreview: true,
      canReferenceByPath: true,
    },
  };
};

const isPathWithinRoot = (candidatePath: string, rootPath: string): boolean => {
  const rel = path.relative(rootPath, candidatePath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const resolveAssetFsTarget = (
  assetPath: string,
): { rel: string; fullPath: string; boundaryRoot: string } | null => {
  const rel = assetPath.replace(/^\/+/, "");
  if (
    !rel ||
    rel.includes("\0") ||
    rel.includes("\\") ||
    rel.split("/").some((seg) => seg === "" || seg === "." || seg === "..")
  ) {
    return null;
  }

  if (rel.startsWith("assets/")) {
    const boundaryRoot = path.resolve(_PUBLIC_DIR, "assets");
    const fullPath = path.resolve(boundaryRoot, rel.slice("assets/".length));
    return isPathWithinRoot(fullPath, boundaryRoot) ? { rel, fullPath, boundaryRoot } : null;
  }

  if (rel.startsWith("projects/")) {
    const boundaryRoot = path.resolve(PROJECTS_DIR);
    const fullPath = path.resolve(boundaryRoot, rel.slice("projects/".length));
    return isPathWithinRoot(fullPath, boundaryRoot) ? { rel, fullPath, boundaryRoot } : null;
  }

  return null;
};

const readRegularFile = async (fullPath: string): Promise<Buffer | null> => {
  let st: import("node:fs").Stats;
  try {
    st = await fs.lstat(fullPath);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile()) return null;
  try {
    return await fs.readFile(fullPath);
  } catch {
    return null;
  }
};

const hasSymlinkWithinRoot = async (fullPath: string, boundaryRoot: string): Promise<boolean> => {
  const rel = path.relative(boundaryRoot, fullPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return true;

  let cursor = boundaryRoot;
  for (const segment of rel.split(path.sep)) {
    cursor = path.join(cursor, segment);
    let st: import("node:fs").Stats;
    try {
      st = await fs.lstat(cursor);
    } catch {
      return true;
    }
    if (st.isSymbolicLink()) return true;
  }

  return false;
};

const resolveAssetFileFromEditorPath = async (
  assetPath: string,
): Promise<{ fullPath: string; kind: AssetKind; mtimeMs: number } | null> => {
  const target = resolveAssetFsTarget(assetPath);
  if (!target) return null;

  const kind = kindFromFilename(target.rel.split("/").pop() ?? "");
  if (!kind) return null;

  let realBoundaryRoot: string;
  try {
    realBoundaryRoot = await fs.realpath(target.boundaryRoot);
  } catch {
    return null;
  }

  // Reject symlinks at the leaf and any symlinked parent path that resolves
  // outside the allowed boundary. lstat() only protects the final path
  // component, so we also realpath() the parent/file to catch traversal via
  // directories such as public/assets/foo -> /etc.
  let st: import("node:fs").Stats;
  try {
    st = await fs.lstat(target.fullPath);
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) return null;
  if (!st.isFile()) return null;
  if (await hasSymlinkWithinRoot(target.fullPath, target.boundaryRoot)) return null;

  const realParentPath = await fs.realpath(path.dirname(target.fullPath)).catch(() => null);
  if (!realParentPath || !isPathWithinRoot(realParentPath, realBoundaryRoot)) return null;

  const realFullPath = await fs.realpath(target.fullPath).catch(() => null);
  if (!realFullPath || !isPathWithinRoot(realFullPath, realBoundaryRoot)) return null;

  return { fullPath: target.fullPath, kind, mtimeMs: st.mtimeMs };
};

const sendGifThumbnailFallback = async (
  res: ServerResponse,
  fullPath: string,
): Promise<void> => {
  const gif = await readRegularFile(fullPath);
  if (!gif) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Content-Length", String(gif.length));
  res.setHeader("Cache-Control", "private, max-age=60");
  res.setHeader("X-Asset-Thumb-Fallback", "original-gif");
  res.end(gif);
};

const handleAssetThumb = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const assetPath = url.searchParams.get("path") ?? "";
  const resolved = await resolveAssetFileFromEditorPath(assetPath);
  if (!resolved) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  if (resolved.kind !== "gif") {
    res.statusCode = 400;
    res.end("thumbnail only supported for gif assets");
    return;
  }

  const cacheKey = createHash("sha1")
    .update(`${assetPath}:${resolved.mtimeMs}`)
    .digest("hex");
  const cacheFile = path.join(ASSET_THUMB_DIR, `${cacheKey}.png`);

  let png = await readRegularFile(cacheFile);
  try {
    await fs.mkdir(ASSET_THUMB_DIR, { recursive: true });
  } catch {
    // Fall back to the original GIF when we cannot create/read the cache dir.
    await sendGifThumbnailFallback(res, resolved.fullPath);
    return;
  }

  if (!png) {
    const tmpFile = `${cacheFile}.tmp-${process.pid}-${Date.now()}.png`;
    const ff = spawnSync(
      "ffmpeg",
      [
        "-loglevel",
        "error",
        "-y",
        "-i",
        resolved.fullPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=320:-1:force_original_aspect_ratio=decrease",
        tmpFile,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    );

    if (ff.status !== 0) {
      await fs.unlink(tmpFile).catch(() => {});
      await sendGifThumbnailFallback(res, resolved.fullPath);
      return;
    }

    try {
      await fs.rename(tmpFile, cacheFile);
    } catch {
      await fs.unlink(tmpFile).catch(() => {});
    }

    png = await readRegularFile(cacheFile);
    if (!png) {
      await sendGifThumbnailFallback(res, resolved.fullPath);
      return;
    }
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", String(png.length));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(png);
};

const handleAssetsList = async (
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const entries: AssetEntry[] = [];

  const walk = async (root: string, scope: "global" | "project", stem: string | null, relPrefix: string) => {
    let dirents: Array<{ name: string; isDir: boolean }>;
    try {
      const ds = await fs.readdir(root, { withFileTypes: true });
      dirents = ds.map((d) => ({ name: d.name, isDir: d.isDirectory() }));
    } catch {
      return;
    }
    const rootResolved = path.resolve(root);
    for (const d of dirents) {
      if (d.name.startsWith(".")) continue;
      const full = path.join(root, d.name);
      const rel = `${relPrefix}/${d.name}`;
      // Never follow symlinks: a link inside public/assets/ pointing at
      // /etc/hosts, ~/.ssh/id_rsa, or ../../.env would otherwise be
      // enumerated and its URL served by Vite. lstat + explicit skip.
      let lst;
      try {
        lst = await fs.lstat(full);
      } catch { continue; }
      if (lst.isSymbolicLink()) continue;
      // Boundary check — belt and suspenders against any odd ../ filename.
      const fullResolved = path.resolve(full);
      if (!fullResolved.startsWith(rootResolved + path.sep)) continue;
      if (d.isDir) {
        if (!lst.isDirectory()) continue;
        await walk(full, scope, stem, rel);
        continue;
      }
      if (!lst.isFile()) continue;
      const kind = kindFromFilename(d.name);
      if (!kind) continue;
      const normalizedRel = rel.replace(/^\/+/, "");
      entries.push(buildAssetEntry({
        path: normalizedRel,
        scope,
        stem,
        kind,
        size: lst.size,
        mtime: lst.mtimeMs,
      }));
    }
  };

  // Engine-level
  await walk(path.join(_PUBLIC_DIR, "assets", "images"), "global", null, "assets/images");
  await walk(path.join(_PUBLIC_DIR, "assets", "gifs"), "global", null, "assets/gifs");
  await walk(path.join(_PUBLIC_DIR, "assets", "videos"), "global", null, "assets/videos");

  // Per-project
  try {
    const projectDirs = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    for (const d of projectDirs) {
      if (!d.isDirectory()) continue;
      if (d.name.startsWith(".") || d.name.startsWith("_")) continue;
      await walk(path.join(PROJECTS_DIR, d.name, "images"), "project", d.name, `projects/${d.name}/images`);
      await walk(path.join(PROJECTS_DIR, d.name, "gifs"), "project", d.name, `projects/${d.name}/gifs`);
      await walk(path.join(PROJECTS_DIR, d.name, "videos"), "project", d.name, `projects/${d.name}/videos`);
      // Many tracks keep clips loose in the project root too — scan top-level
      // for media files and flag them as project-scope.
      try {
        const loose = await fs.readdir(path.join(PROJECTS_DIR, d.name), { withFileTypes: true });
        for (const f of loose) {
          if (!f.isFile()) continue;
          if (f.name.startsWith(".")) continue;
          const kind = kindFromFilename(f.name);
          if (!kind) continue;
          try {
            const st = await fs.stat(path.join(PROJECTS_DIR, d.name, f.name));
            const loosePath = `projects/${d.name}/${f.name}`;
            entries.push(buildAssetEntry({
              path: loosePath,
              scope: "project",
              stem: d.name,
              kind,
              size: st.size,
              mtime: st.mtimeMs,
            }));
          } catch { /* skip */ }
        }
      } catch { /* no project dir */ }
    }
  } catch { /* no projects dir */ }

  const dedupedEntries = new Map<string, AssetEntry>();
  for (const entry of entries) {
    const dedupeKey =
      entry.kind === "gif" ? entry.path.replace(/\/images\//, "/gifs/") : entry.path;
    const existing = dedupedEntries.get(dedupeKey);
    if (!existing) {
      dedupedEntries.set(dedupeKey, entry);
      continue;
    }
    const entryCanonicalGif = entry.kind === "gif" && /\/gifs\//.test(entry.path);
    const existingCanonicalGif = existing.kind === "gif" && /\/gifs\//.test(existing.path);
    if (entryCanonicalGif && !existingCanonicalGif) {
      dedupedEntries.set(dedupeKey, entry);
    }
  }

  const finalEntries = Array.from(dedupedEntries.values());

  finalEntries.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "global" ? -1 : 1;
    if (a.kind !== b.kind) {
      const order: Record<AssetKind, number> = { image: 0, gif: 1, video: 2 };
      return order[a.kind] - order[b.kind];
    }
    return a.path.localeCompare(b.path);
  });

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(finalEntries));
};


// ---------------------------------------------------------------------------
// /api/assets/upload  (POST — multipart upload to the shared/project library)
// ---------------------------------------------------------------------------
//
// Accepts a single multipart/form-data file upload and writes it under either
// the shared library or the current project's media folders:
//   * scope=global  -> public/assets/{images,gifs,videos}/<filename>
//   * scope=project -> projects/<stem>/{images,gifs,videos}/<filename>
// MIME + extension decide the logical kind. Scope/stem travel in the query
// string so the editor can offer "Library vs Project" import without making
// the tiny multipart parser below more complex.
//
// Hardening:
//   * 50 MB hard size cap, enforced mid-stream so a malicious 10GB upload
//     cannot exhaust memory.
//   * Filename sanitized to [a-z0-9._-]+ with collision-suffix (-2, -3, ...).
//   * Atomic write: <target>.tmp + fs.rename so a partial read during the
//     2s AssetLibrary poll never sees half a file.
//   * Boundary check on the resolved path — a filename with .. cannot
//     escape public/assets/.
//   * Zero external deps; tiny multipart parser below handles only the
//     single-file shape this endpoint actually accepts.

const parseSingleFileUpload = (
  req: IncomingMessage,
  sizeLimit: number,
): Promise<{ filename: string; contentType: string; body: Buffer }> =>
  new Promise((resolve, reject) => {
    const ct = String(req.headers["content-type"] ?? "");
    const bm = ct.match(/boundary=([^;]+)/);
    if (!bm) return reject(new Error("no-boundary"));
    const boundary = `--${bm[1]}`;
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > sizeLimit) {
        req.pause();
        return reject(new Error("upload-size-exceeded"));
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks);
        const headText = body.toString("utf8", 0, Math.min(4096, body.length));
        const headerEnd = headText.indexOf("\r\n\r\n");
        if (headerEnd === -1) return reject(new Error("malformed-multipart"));
        const headerSection = headText.substring(0, headerEnd);
        const filenameMatch = headerSection.match(/filename="([^"]+)"/);
        const ctMatch = headerSection.match(/Content-Type:\s*([^\r\n]+)/i);
        if (!filenameMatch) return reject(new Error("no-filename"));
        const boundaryBytes = Buffer.from(boundary);
        const firstBoundary = body.indexOf(boundaryBytes);
        const headerSep = Buffer.from("\r\n\r\n");
        const contentStart = body.indexOf(headerSep, firstBoundary) + headerSep.length;
        const tailBoundary = Buffer.from(`\r\n${boundary}`);
        let contentEnd = body.indexOf(tailBoundary, contentStart);
        if (contentEnd === -1) contentEnd = body.length;
        resolve({
          filename: filenameMatch[1],
          contentType: ctMatch ? ctMatch[1].trim() : "application/octet-stream",
          body: body.subarray(contentStart, contentEnd),
        });
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });

const sanitizeAssetFilename = async (
  dirPath: string,
  raw: string,
): Promise<{ filename: string; fullPath: string } | null> => {
  const base = raw.split("/").pop()?.split("\\").pop() ?? "";
  if (!base || base === "." || base === "..") return null;
  const normalized = base
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9._-]+\.[a-z0-9]+$/.test(normalized)) return null;
  const m = normalized.match(/^(.+?)(\.[a-z0-9]+)$/);
  if (!m) return null;
  const stem = m[1];
  const ext = m[2];
  // Atomic claim via O_EXCL: instead of stat-then-write (TOCTOU race
  // when two uploads hit the same filename in parallel), try to create
  // an empty placeholder file with `wx` flag. If it succeeds, the name
  // is ours. If EEXIST, increment and retry. The caller will overwrite
  // the placeholder with the real bytes via the atomic tmp + rename
  // pattern further down — the placeholder is just a name reservation.
  let candidate = normalized;
  let counter = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fullPath = path.join(dirPath, candidate);
    try {
      const handle = await fs.open(fullPath, "wx");
      await handle.close();
      return { filename: candidate, fullPath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      counter += 1;
      candidate = `${stem}-${counter}${ext}`;
    }
  }
};

const handleAssetsUpload = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const scopeParam = url.searchParams.get("scope");
  const stemParam = url.searchParams.get("stem");
  const scope: "global" | "project" = scopeParam === "project" ? "project" : "global";
  if (scope === "project" && (!stemParam || !STEM_RE.test(stemParam))) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad-project-stem" }));
    return;
  }

  let upload: { filename: string; contentType: string; body: Buffer };
  try {
    upload = await parseSingleFileUpload(req, 50 * 1024 * 1024);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    res.statusCode = msg === "upload-size-exceeded" ? 413 : 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: msg }));
    return;
  }

  const mime = upload.contentType.toLowerCase();
  const mimeKind = kindFromMime(mime);
  const extKind = kindFromFilename(upload.filename);
  let kind: AssetKind | null = mimeKind ?? extKind;
  if (kind === "image" && extKind === "gif") kind = "gif";
  if (!kind) {
    res.statusCode = 415;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "unsupported-media-type", contentType: mime }));
    return;
  }
  const targetDir =
    scope === "project" && stemParam
      ? path.join(PROJECTS_DIR, stemParam, assetDirForKind(kind))
      : path.join(_PUBLIC_DIR, "assets", assetDirForKind(kind));

  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "dir-create-failed", detail: String(err) }));
    return;
  }

  const sanitized = await sanitizeAssetFilename(targetDir, upload.filename);
  if (!sanitized) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-filename", raw: upload.filename }));
    return;
  }

  // Boundary: the resolved path must still live under the selected asset root.
  const assetsRoot = path.resolve(targetDir) + path.sep;
  const resolved = path.resolve(sanitized.fullPath);
  if (resolved !== path.resolve(targetDir, sanitized.filename) || !resolved.startsWith(assetsRoot)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "path-traversal-rejected" }));
    return;
  }

  const tmp = `${sanitized.fullPath}.tmp`;
  try {
    await fs.writeFile(tmp, upload.body);
    // Atomic rename overwrites the wx-claim placeholder created by
    // sanitizeAssetFilename (a 0-byte file reserving the name).
    await fs.rename(tmp, sanitized.fullPath);
  } catch (err) {
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    // Best-effort cleanup of the wx-claim placeholder on failure so the
    // filename is freed for the user's next attempt instead of being
    // permanently consumed by a 0-byte orphan.
    try { await fs.unlink(sanitized.fullPath); } catch { /* ignore */ }
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "write-failed", detail: String(err) }));
    return;
  }

  const entry = buildAssetEntry({
    path:
      scope === "project" && stemParam
        ? `projects/${stemParam}/${assetDirForKind(kind)}/${sanitized.filename}`
        : `assets/${assetDirForKind(kind)}/${sanitized.filename}`,
    scope,
    stem: scope === "project" ? stemParam ?? null : null,
    kind,
    size: upload.body.length,
    mtime: Date.now(),
  });
  res.statusCode = 201;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(entry));
};

const handleAssetsDelete = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const body = (await readJsonBody(req).catch(() => null)) as AssetDeleteRequest | null;
  const assetPath = typeof body?.path === "string" ? body.path : "";
  if (!assetPath) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "missing-path" }));
    return;
  }

  const resolved = await resolveAssetFileFromEditorPath(assetPath);
  if (!resolved) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "asset-not-found", path: assetPath }));
    return;
  }

  try {
    await fs.unlink(resolved.fullPath);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "delete-failed", detail: String(err), path: assetPath }));
    return;
  }

  res.setHeader("Content-Type", "application/json");
  const normalizedPath = assetPath.replace(/^\/+/, "");
  const response: AssetDeleteResponse = {
    ok: true,
    id: assetIdForPath(normalizedPath),
    path: normalizedPath,
    deletedAt: Date.now(),
  };
  res.end(JSON.stringify(response));
};

// ---------------------------------------------------------------------------
// /api/assets/ensure/:stem  (POST)
// ---------------------------------------------------------------------------
//
// Ensures one canonical record exists in projects/<stem>/assets.json for the
// given asset path. The read/modify/write happens under the registry lock so
// concurrent UI writers cannot mint conflicting canonical IDs from stale
// client-side snapshots.

type EnsureAssetRecordRequest = {
  path: string;
  kind?: AssetKind;
  label?: string;
};

type EnrichAssetRecordRequest = {
  ids?: AssetId[];
  paths?: string[];
};

type ReconcileAssetsRequest = {
  dryRun?: boolean;
};

const loadAssetRegistryForStem = async (registryPath: string) => {
  let registry = normalizeAssetRegistryFileV2({ version: 2, records: [] });

  try {
    const content = await fs.readFile(registryPath, "utf8");
    const parsed = AssetRegistryFileSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      throw new Error(`invalid registry payload: ${parsed.error.message}`);
    }
    registry = normalizeAssetRegistryFileV2(parsed.data);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }

  return registry;
};

const writeAssetRegistryForStem = async (
  registryPath: string,
  registry: ReturnType<typeof normalizeAssetRegistryFileV2>,
): Promise<void> => {
  const tmp = `${registryPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(registry, null, 2), "utf8");
  await fs.rename(tmp, registryPath);
};

const withAssetRegistryLock = async <T>(stem: string, operation: () => Promise<T>): Promise<T> => {
  const prev = ASSETS_REGISTRY_LOCK.get(stem) ?? Promise.resolve();
  const next = prev.then(operation);

  ASSETS_REGISTRY_LOCK.set(
    stem,
    next.then(() => undefined).catch(() => {
      // swallow — failure is surfaced through `await next` below
    }),
  );

  return next;
};

const sanitizeAssetMetadata = (metadata: AssetMetadata): AssetMetadata => {
  const sanitized: AssetMetadata = {};

  if (typeof metadata.width === "number" && Number.isFinite(metadata.width) && metadata.width > 0) {
    sanitized.width = metadata.width;
  }
  if (typeof metadata.height === "number" && Number.isFinite(metadata.height) && metadata.height > 0) {
    sanitized.height = metadata.height;
  }
  if (
    typeof metadata.durationSec === "number" &&
    Number.isFinite(metadata.durationSec) &&
    metadata.durationSec > 0
  ) {
    sanitized.durationSec = metadata.durationSec;
  }
  if (typeof metadata.hasAlpha === "boolean") {
    sanitized.hasAlpha = metadata.hasAlpha;
  }
  if (typeof metadata.fps === "number" && Number.isFinite(metadata.fps) && metadata.fps > 0) {
    sanitized.fps = metadata.fps;
  }
  if (typeof metadata.codec === "string" && metadata.codec.trim().length > 0) {
    sanitized.codec = metadata.codec.trim();
  }

  return sanitized;
};

const hasAssetMetadata = (metadata: AssetMetadata): boolean => Object.keys(metadata).length > 0;

const assetRecordMatchesId = (record: AssetRecordV2, id: string): boolean =>
  record.id === id || record.aliases?.includes(id as AssetId) === true;

const hashAssetFileSafely = async (fullPath: string): Promise<string | null> => {
  try {
    const bytes = await fs.readFile(fullPath);
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
};

const statAssetRecordSafely = async (
  record: AssetRecordV2,
): Promise<{
  exists: boolean;
  stat?: import("node:fs").Stats;
  target?: ReturnType<typeof resolveAssetFsTarget>;
}> => {
  const target = resolveAssetFsTarget(record.path);
  if (!target) return { exists: false };

  try {
    const stat = await fs.lstat(target.fullPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return { exists: false, target };

    const realBoundaryRoot = await fs.realpath(target.boundaryRoot).catch(() => null);
    if (!realBoundaryRoot) return { exists: false, target };
    if (await hasSymlinkWithinRoot(target.fullPath, target.boundaryRoot)) {
      return { exists: false, target };
    }

    const realParentPath = await fs.realpath(path.dirname(target.fullPath)).catch(() => null);
    if (!realParentPath || !isPathWithinRoot(realParentPath, realBoundaryRoot)) {
      return { exists: false, target };
    }

    const realFullPath = await fs.realpath(target.fullPath).catch(() => null);
    if (!realFullPath || !isPathWithinRoot(realFullPath, realBoundaryRoot)) {
      return { exists: false, target };
    }

    return { exists: true, stat, target };
  } catch {
    return { exists: false, target };
  }
};

const probeAssetMetadataSafely = async (record: AssetRecordV2): Promise<AssetMetadata> => {
  try {
    return sanitizeAssetMetadata(await probeAsset(REPO_ROOT, PROJECTS_DIR, record.path, record.kind));
  } catch {
    return {};
  }
};

const recordNeedsRegistryEnrichment = (record: AssetRecordV2): boolean =>
  record.status !== "tombstoned" &&
  (record.status !== "active" || !record.contentHash || record.hashVersion !== "sha256");

const enrichRegistryRecord = async (
  existing: AssetRecordV2,
): Promise<{ record: AssetRecordV2; changed: boolean; enriched: boolean }> => {
  if (existing.status === "tombstoned") {
    return { record: existing, changed: false, enriched: false };
  }

  const disk = await statAssetRecordSafely(existing);
  const now = Date.now();

  if (!disk.exists || !disk.stat || !disk.target) {
    const candidateRecord = normalizeAssetRegistryFileV2({
      version: 2,
      records: [
        {
          ...existing,
          status: "missing",
          ...(existing.missingSince !== undefined || existing.status === "missing"
            ? { missingSince: existing.missingSince ?? now }
            : { missingSince: now }),
          ...(existing.deletedAt !== undefined || existing.status === "tombstoned"
            ? { deletedAt: null }
            : {}),
          updatedAt: existing.updatedAt,
        },
      ],
    }).records[0];
    const changed = JSON.stringify(candidateRecord) !== JSON.stringify(existing);
    const record = changed
      ? normalizeAssetRegistryFileV2({
          version: 2,
          records: [
            {
              ...candidateRecord,
              updatedAt: now,
            },
          ],
        }).records[0]
      : existing;
    return { record, changed, enriched: false };
  }

  const probedMetadata = await probeAssetMetadataSafely(existing);
  const contentHash = await hashAssetFileSafely(disk.target.fullPath);
  const candidateRecord = normalizeAssetRegistryFileV2({
    version: 2,
    records: [
      {
        ...existing,
        sizeBytes: disk.stat.size,
        mtimeMs: disk.stat.mtimeMs,
        metadata: hasAssetMetadata(probedMetadata)
          ? {
              ...existing.metadata,
              ...probedMetadata,
            }
          : existing.metadata,
        contentHash,
        hashVersion: contentHash ? "sha256" : null,
        status: "active",
        ...(existing.missingSince !== undefined || existing.status === "missing"
          ? { missingSince: null }
          : {}),
        ...(existing.deletedAt !== undefined || existing.status === "tombstoned"
          ? { deletedAt: null }
          : {}),
        updatedAt: existing.updatedAt,
      },
    ],
  }).records[0];

  const changed = JSON.stringify(candidateRecord) !== JSON.stringify(existing);
  const record = changed
    ? normalizeAssetRegistryFileV2({
        version: 2,
        records: [
          {
            ...candidateRecord,
            updatedAt: now,
          },
        ],
      }).records[0]
    : existing;

  return {
    record,
    changed,
    enriched: hasAssetMetadata(probedMetadata) || Boolean(contentHash),
  };
};

const handleAssetsEnsure = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));

  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-stem", detail: "stem must be alphanumeric with hyphens/underscores only" }));
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-json", detail: String(err) }));
    return;
  }

  const requestBody = body as Partial<EnsureAssetRecordRequest> | null;
  const requestedPath = typeof requestBody?.path === "string" ? requestBody.path.trim() : "";
  const requestedLabel =
    typeof requestBody?.label === "string" && requestBody.label.trim().length > 0
      ? requestBody.label.trim()
      : undefined;
  const requestedKind = requestBody?.kind;

  if (!requestedPath) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "missing-path" }));
    return;
  }

  if (
    requestedKind !== undefined &&
    requestedKind !== "image" &&
    requestedKind !== "video" &&
    requestedKind !== "gif"
  ) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-kind" }));
    return;
  }

  const resolved = resolveAssetFsTarget(requestedPath);
  if (!resolved) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-path", path: requestedPath }));
    return;
  }

  let stat: import("node:fs").Stats;
  try {
    stat = await fs.lstat(resolved.fullPath);
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "asset-not-found", path: resolved.rel }));
    return;
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-asset-target", path: resolved.rel }));
    return;
  }

  let realBoundaryRoot: string;
  try {
    realBoundaryRoot = await fs.realpath(resolved.boundaryRoot);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-asset-target", path: resolved.rel }));
    return;
  }

  if (await hasSymlinkWithinRoot(resolved.fullPath, resolved.boundaryRoot)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-asset-target", path: resolved.rel }));
    return;
  }

  const realParentPath = await fs.realpath(path.dirname(resolved.fullPath)).catch(() => null);
  if (!realParentPath || !isPathWithinRoot(realParentPath, realBoundaryRoot)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-asset-target", path: resolved.rel }));
    return;
  }

  const realFullPath = await fs.realpath(resolved.fullPath).catch(() => null);
  if (!realFullPath || !isPathWithinRoot(realFullPath, realBoundaryRoot)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-asset-target", path: resolved.rel }));
    return;
  }

  const inferredKind = kindFromFilename(resolved.rel);
  if (!inferredKind) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "unsupported-kind", path: resolved.rel }));
    return;
  }

  if (requestedKind && requestedKind !== inferredKind) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "kind-mismatch",
        expected: inferredKind,
        received: requestedKind,
        path: resolved.rel,
      }),
    );
    return;
  }

  const isProjectScoped = resolved.rel.startsWith("projects/");
  const recordStem = isProjectScoped ? resolved.rel.split("/")[1] ?? null : null;
  const recordScope = isProjectScoped ? "project" : "global";
  if (recordScope === "project" && recordStem !== stem) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "cross-project-asset",
        detail: `asset path belongs to project ${recordStem}, not ${stem}`,
        path: resolved.rel,
      }),
    );
    return;
  }

  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    try {
      await fs.mkdir(projectDir, { recursive: true });
    } catch (mkdirErr) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "project-dir-create-failed", detail: String(mkdirErr) }));
      return;
    }
  }

  try {
    const result = await withAssetRegistryLock(stem, async () => {
      const dest = path.join(projectDir, "assets.json");
      const registry = await loadAssetRegistryForStem(dest);

      const existingIndex = registry.records.findIndex((record) => record.path === resolved.rel);
      const now = Date.now();

      if (existingIndex >= 0) {
        const existing = registry.records[existingIndex];
        const candidateRecord = normalizeAssetRegistryFileV2({
          version: 2,
          records: [
            {
              ...existing,
              kind: inferredKind,
              scope: recordScope,
              stem: recordStem,
              sizeBytes: stat.size,
              mtimeMs: stat.mtimeMs,
              updatedAt: existing.updatedAt,
              status: "active",
              ...(existing.missingSince !== undefined || existing.status === "missing"
                ? { missingSince: null }
                : {}),
              ...(existing.deletedAt !== undefined || existing.status === "tombstoned"
                ? { deletedAt: null }
                : {}),
              ...(requestedLabel !== undefined && existing.label === undefined
                ? { label: requestedLabel }
                : {}),
            },
          ],
        }).records[0];

        const changed = JSON.stringify(candidateRecord) !== JSON.stringify(existing);
        const nextRecord = changed
          ? normalizeAssetRegistryFileV2({
              version: 2,
              records: [
                {
                  ...candidateRecord,
                  updatedAt: now,
                },
              ],
            }).records[0]
          : existing;
        if (changed) {
          registry.records[existingIndex] = nextRecord;
          await writeAssetRegistryForStem(dest, registry);
        }

        return { record: nextRecord, changed, count: registry.records.length };
      }

      const record = createAssetRecord({
        path: resolved.rel,
        kind: inferredKind,
        scope: recordScope,
        stem: recordStem,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        createdAt: now,
        updatedAt: now,
        metadata: {},
        ...(requestedLabel !== undefined ? { label: requestedLabel } : {}),
      });

      registry.records.push(record);
      await writeAssetRegistryForStem(dest, registry);

      return { record, changed: true, count: registry.records.length };
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "ensure-failed", detail: String(err) }));
  }
};

// ---------------------------------------------------------------------------
// /api/assets/enrich/:stem  (POST)
// ---------------------------------------------------------------------------
//
// Probes metadata + disk facts for one or more existing asset records after
// canonical identity is already established. This keeps /ensure focused on
// path -> record identity while giving callers an explicit opt-in enrichment
// step that does not block record creation.

const handleAssetsEnrich = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));

  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-stem", detail: "stem must be alphanumeric with hyphens/underscores only" }));
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-json", detail: String(err) }));
    return;
  }

  const requestBody = body as Partial<EnrichAssetRecordRequest> | null;
  const requestedIds = Array.isArray(requestBody?.ids)
    ? Array.from(
        new Set(
          requestBody.ids
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      )
    : undefined;
  const requestedPaths = Array.isArray(requestBody?.paths)
    ? Array.from(
        new Set(
          requestBody.paths
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      )
    : undefined;

  if (requestedIds && requestedPaths) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "ambiguous-selector", detail: "provide ids or paths, not both" }));
    return;
  }

  if (requestedIds?.some((id) => !isValidAssetId(id))) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-ids" }));
    return;
  }

  const normalizedRequestedPaths = requestedPaths?.map((requestedPath) => {
    const resolved = resolveAssetFsTarget(requestedPath);
    return resolved?.rel ?? null;
  });

  if (normalizedRequestedPaths?.some((requestedPath) => requestedPath == null)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-paths" }));
    return;
  }

  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "project-not-found", stem }));
    return;
  }

  try {
    const result = await withAssetRegistryLock(stem, async () => {
      const dest = path.join(projectDir, "assets.json");
      const registry = await loadAssetRegistryForStem(dest);
      const matchingIndexes = registry.records.flatMap((record, index) =>
        requestedIds
          ? requestedIds.some((requestedId) => assetRecordMatchesId(record, requestedId))
            ? [index]
            : []
          : normalizedRequestedPaths
            ? normalizedRequestedPaths.includes(record.path)
              ? [index]
              : []
            : recordNeedsRegistryEnrichment(record)
              ? [index]
              : [],
      );

      let changed = false;
      let enrichedCount = 0;
      const records: AssetRecordV2[] = [];
      for (const index of matchingIndexes) {
        const result = await enrichRegistryRecord(registry.records[index]);
        if (result.changed) {
          registry.records[index] = result.record;
          changed = true;
        }
        if (result.enriched) {
          enrichedCount += 1;
        }
        records.push(result.record);
      }

      if (changed) {
        await writeAssetRegistryForStem(dest, registry);
      }

      const matchedIds = new Set(
        records.flatMap((record) => [record.id, ...(record.aliases ?? [])]),
      );
      const missingIds = requestedIds ? requestedIds.filter((id) => !matchedIds.has(id)) : [];
      const matchedPaths = new Set(records.map((record) => record.path));
      const missingPaths = normalizedRequestedPaths
        ? normalizedRequestedPaths.filter((requestedPath): requestedPath is string =>
            requestedPath != null && !matchedPaths.has(requestedPath),
          )
        : [];

      return {
        records,
        record: records[0] ?? null,
        changed,
        enriched: enrichedCount > 0,
        enrichedCount,
        missingIds,
        missingPaths,
        count: registry.records.length,
      };
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "enrich-failed", detail: String(err) }));
  }
};

// ---------------------------------------------------------------------------
// /api/assets/reconcile/:stem  (POST)
// ---------------------------------------------------------------------------
//
// Runs the shared Node reconcile pass for one project under the existing
// in-process assets.json lock so concurrent registry writers do not interleave
// with the disk scan + write sequence.

const handleAssetsReconcile = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));

  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "invalid-stem",
        detail: "stem must be alphanumeric with hyphens/underscores only",
      }),
    );
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-json", detail: String(err) }));
    return;
  }

  if (body !== null && (typeof body !== "object" || Array.isArray(body))) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-body", detail: "body must be a JSON object" }));
    return;
  }

  const requestBody = body as ReconcileAssetsRequest | null;
  if (requestBody?.dryRun !== undefined && typeof requestBody.dryRun !== "boolean") {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-body", detail: "dryRun must be a boolean" }));
    return;
  }

  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const stat = await fs.stat(projectDir);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "project-not-found", stem }));
    return;
  }

  try {
    const result = await withAssetRegistryLock(stem, async () =>
      reconcileAssets({
        repoRoot: REPO_ROOT,
        stem,
        dryRun: requestBody?.dryRun,
        onWarn: (message) => console.warn(message),
      }),
    );
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (err) {
    if (err instanceof ReconcileAssetsProjectNotFoundError) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "project-not-found", stem }));
      return;
    }

    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "reconcile-failed", detail: String(err) }));
  }
};

// ---------------------------------------------------------------------------
// /api/assets/registry/:stem  (GET)
// ---------------------------------------------------------------------------
//
// Reads projects/<stem>/assets.json and returns the full registry for that
// project. Part of the fresh-memory Phase 1 implementation — the registry
// maps asset IDs to source paths + metadata. Used by the editor to resolve
// element props after external tools swap underlying files.
//
// Security: validates stem is alphanumeric + hyphens only (no path traversal).
// Returns { version: 2, records: [] } with 200 if the file is missing.

const handleAssetsRegistryGet = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  // Connect strips "/api/assets/registry/"; req.url is "/<stem>"
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));

  // Validate stem: alphanumeric + hyphens/underscores only, no path traversal
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-stem", detail: "stem must be alphanumeric with hyphens/underscores only" }));
    return;
  }

  const registryPath = path.join(PROJECTS_DIR, stem, "assets.json");

  let content: string;
  try {
    content = await fs.readFile(registryPath, "utf8");
  } catch (err) {
    // If the file doesn't exist, return an empty registry with 200
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ version: 2, records: [] }));
      return;
    }
    // Other errors (permissions, etc.) are 500s
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "read-failed", detail: String(err) }));
    return;
  }

  // Parse and validate the registry structure
  let registry: unknown;
  try {
    registry = JSON.parse(content);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "parse-failed", detail: String(err) }));
    return;
  }

  const parsed = AssetRegistryFileSchema.safeParse(registry);
  if (!parsed.success) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "invalid-registry",
        detail: parsed.error.flatten(),
      }),
    );
    return;
  }

  const normalized = normalizeAssetRegistryFileV2(parsed.data);

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(normalized));
};

// ---------------------------------------------------------------------------
// /api/assets/registry/:stem  (POST)
// ---------------------------------------------------------------------------
//
// Writes projects/<stem>/assets.json atomically. Part of the fresh-memory
// Phase 1 implementation — persistence layer for the asset identity system.
//
// Request body: { version: 1 | 2, records: AssetRecord[] }
// Security: validates stem and body structure; atomic tmp+rename write.

const handleAssetsRegistryPost = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  // Extract stem from URL (Connect strips "/api/assets/registry/")
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));

  // Validate stem: alphanumeric + hyphens/underscores only, no path traversal
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-stem", detail: "stem must be alphanumeric with hyphens/underscores only" }));
    return;
  }

  // Read and validate request body
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid-json", detail: String(err) }));
    return;
  }

  const parsed = AssetRegistryFileSchema.safeParse(body);
  if (!parsed.success) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "invalid-body",
        detail: parsed.error.flatten(),
      }),
    );
    return;
  }
  const registry = normalizeAssetRegistryFileV2(parsed.data);

  // Ensure project directory exists
  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch (_err) {
    // Create project directory if it doesn't exist
    try {
      await fs.mkdir(projectDir, { recursive: true });
    } catch (mkdirErr) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "project-dir-create-failed", detail: String(mkdirErr) }));
      return;
    }
  }

  // Serialize writes per-stem (prevent concurrent writes from corrupting the file)
  const prev = ASSETS_REGISTRY_LOCK.get(stem) ?? Promise.resolve();
  const next = prev.then(async () => {
    const dest = path.join(projectDir, "assets.json");
    const tmp = `${dest}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(registry, null, 2), "utf8");
    await fs.rename(tmp, dest);
  });
  ASSETS_REGISTRY_LOCK.set(
    stem,
    next.catch(() => {
      // swallow — failure is surfaced through `await next` below
    }),
  );

  try {
    await next;
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "write-failed", detail: String(err) }));
    return;
  }

  // Success: return the written registry
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(registry));
};

// ---------------------------------------------------------------------------
// /api/storyboard/:stem  (GET) + /api/storyboard/save (POST)
// ---------------------------------------------------------------------------
//
// Reads/writes projects/<stem>/storyboard.json. Shape on disk:
//   { version: 1, stem, scenes: [{id, name, startSec, endSec, intent,
//                                  linkedElementIds: []}] }
// Missing file -> 404 on GET (client treats as empty scenes array).
// POST writes atomically via tmp + rename; per-stem lock prevents interleaved
// writes from the autosave debounce.

const STORYBOARD_LOCK = new Map<string, Promise<void>>();

// SSE stream of projects/<stem>/events.json. Initial `events` event on
// connect with the parsed file contents (empty doc on missing file); subsequent
// `events` events whenever the file changes on disk. Wires external writes
// (chat Write tool, vim, other processes) through to the editor store so the
// cyan NamedEventPills appear without a manual reload. Mirrors
// handleAnalyzeEvents / handleTimelineWatch.
const handleEventsWatch = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  const file = path.join(projectDir, "events.json");
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a dir");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "project not found", stem }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const emit = async () => {
    let payload: string;
    try {
      const raw = await fs.readFile(file, "utf8");
      try {
        payload = JSON.stringify(parseEventsFile(JSON.parse(raw)));
      } catch {
        payload = JSON.stringify(parseEventsFile(undefined));
      }
    } catch {
      payload = JSON.stringify(parseEventsFile(undefined));
    }
    try {
      res.write(`event: events\ndata: ${payload}\n\n`);
    } catch {
      /* closed */
    }
  };

  let watcher: FSWatcher | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };
  req.on("close", cleanup);
  if (req.destroyed) {
    cleanup();
    return;
  }

  await emit();

  try {
    watcher = fsWatch(projectDir, { persistent: false }, (eventType, filename) => {
      if (filename != null && filename !== "events.json") return;
      if (eventType !== "change" && eventType !== "rename") return;
      void emit();
    });
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ stem, detail: String(err) })}\n\n`);
  }

  keepalive = setInterval(() => {
    try {
      res.write(":keepalive\n\n");
    } catch {
      /* closed */
    }
  }, 20000);
};

const handleStoryboardGet = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  const full = path.join(PROJECTS_DIR, stem, "storyboard.json");
  let content: string;
  try {
    content = await fs.readFile(full, "utf8");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "storyboard not found", stem }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(content);
};

const handleStoryboardSave = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const stem = String(body?.stem ?? "");
  const storyboard = body?.storyboard;
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  if (!storyboard || typeof storyboard !== "object") {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.storyboard required" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "project not found", stem }));
    return;
  }
  const prev = STORYBOARD_LOCK.get(stem) ?? Promise.resolve();
  const next = prev.then(async () => {
    const dest = path.join(projectDir, "storyboard.json");
    const tmp = `${dest}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(storyboard, null, 2));
    await fs.rename(tmp, dest);
  });
  STORYBOARD_LOCK.set(
    stem,
    next.catch(() => {
      /* surfaced below */
    }),
  );
  try {
    await next;
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "storyboard-write-failed", detail: String(err) }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true }));
};

// ---------------------------------------------------------------------------
// /api/current-project  (GET + POST — the "which project is active" pointer)
// ---------------------------------------------------------------------------
//
// The editor's SongPicker writes this file on every track switch. It's the
// bridge that lets an external Claude Code session (via `npm run mv:current`)
// know which project the user is working on without needing browser state.
// File is at repo root, gitignored, single-line (just the stem).

const CURRENT_PROJECT_FILE = path.join(REPO_ROOT, ".current-project");

const handleCurrentGet = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
  let content: string;
  try {
    content = (await fs.readFile(CURRENT_PROJECT_FILE, "utf8")).trim();
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "no current project" }));
    return;
  }
  // Validate: the stored stem must exist under the ACTIVE MV_PROJECTS_DIR.
  // When a user switches MV_PROJECTS_DIR between sessions, .current-project
  // may still point at a stem absent from the new root. Report 404 instead
  // of returning a dead pointer.
  if (content && STEM_RE.test(content)) {
    const projectDir = path.join(PROJECTS_DIR, content);
    try {
      const st = await fs.stat(projectDir);
      if (!st.isDirectory()) throw new Error("not a directory");
    } catch {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: `current project "${content}" not found under MV_PROJECTS_DIR (${PROJECTS_DIR})`,
          stale: content,
        }),
      );
      return;
    }
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ stem: content }));
};

const handleCurrentSave = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const stem = String(body?.stem ?? "");
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  // Atomic write via tmp + rename. The CLI's mv:switch and this handler
  // both write .current-project; without atomicity, a third process
  // (mv:current, mv:render, an external Claude session) could read a
  // partially-written file and get a truncated stem.
  const tmpCurrent = `${CURRENT_PROJECT_FILE}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmpCurrent, `${stem}\n`);
  await fs.rename(tmpCurrent, CURRENT_PROJECT_FILE);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, stem }));
};

const handleTimelineSave = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const stem = String(body?.stem ?? "");
  const timeline = body?.timeline;
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  if (!timeline || typeof timeline !== "object") {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.timeline required" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "project not found", stem }));
    return;
  }

  // Serialize writes per-stem.
  const prev = TIMELINE_LOCK.get(stem) ?? Promise.resolve();
  const next = prev.then(async () => {
    const dest = path.join(projectDir, "timeline.json");
    const tmp = `${dest}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(timeline, null, 2));
    await fs.rename(tmp, dest);
  });
  TIMELINE_LOCK.set(
    stem,
    next.catch(() => {
      // swallow — failure is surfaced through `await next` below
    }),
  );
  try {
    await next;
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "timeline-write-failed", detail: String(err) }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true }));
};

// ---------------------------------------------------------------------------
// /api/chat-global            (GET + POST — global chat transcript)
// /api/chat-history/:stem     (GET + POST — per-project chat transcript)
// ---------------------------------------------------------------------------

const GLOBAL_CHAT_PATH = path.join(OUT_DIR, "chat.json");
const CHAT_LOCK_GLOBAL_KEY = "_global";

const handleChatGlobalGet = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
  try {
    const content = await fs.readFile(GLOBAL_CHAT_PATH, "utf8");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(content);
  } catch {
    // No chat yet — empty array is valid.
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ messages: [] }));
  }
};

const handleChatGlobalSave = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const messages = body?.messages;
  if (!Array.isArray(messages)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.messages must be an array" }));
    return;
  }
  const MAX = 500;
  const trimmed = messages.length > MAX ? messages.slice(-MAX) : messages;
  const prev = CHAT_LOCK.get(CHAT_LOCK_GLOBAL_KEY) ?? Promise.resolve();
  const next = prev.then(async () => {
    await fs.mkdir(path.dirname(GLOBAL_CHAT_PATH), { recursive: true });
    const tmp = `${GLOBAL_CHAT_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, messages: trimmed }, null, 2));
    await fs.rename(tmp, GLOBAL_CHAT_PATH);
  });
  CHAT_LOCK.set(CHAT_LOCK_GLOBAL_KEY, next.catch(() => { /* surfaced below */ }));
  try {
    await next;
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "chat-global-write-failed", detail: String(err) }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, count: trimmed.length }));
};
//
// Mirrors the timeline/events sync model. Chat lives at
// projects/<stem>/chat.json as an array of {id, role, content, createdAt}.
// localStorage in the browser is still there as an instant-render cache;
// disk is the durable copy that survives across browsers/machines.
// Atomic write via tmp + rename. Per-stem in-process lock.

const CHAT_LOCK = new Map<string, Promise<void>>();

const handleChatHistoryGet = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  const full = path.join(PROJECTS_DIR, stem, "chat.json");
  let content: string;
  try {
    content = await fs.readFile(full, "utf8");
  } catch {
    // No chat yet is a valid state — return empty array, not 404.
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ messages: [] }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(content);
};

const handleChatHistorySave = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const stem = String(body?.stem ?? "");
  const messages = body?.messages;
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  if (!Array.isArray(messages)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.messages must be an array" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "project not found", stem }));
    return;
  }

  // Cap history on disk at 500 messages — long enough for a real session,
  // short enough that the file stays small. Oldest entries drop off.
  const MAX_CHAT_ON_DISK = 500;
  const trimmed =
    messages.length > MAX_CHAT_ON_DISK ? messages.slice(-MAX_CHAT_ON_DISK) : messages;

  const payload = { version: 1, stem, messages: trimmed };
  const prev = CHAT_LOCK.get(stem) ?? Promise.resolve();
  const next = prev.then(async () => {
    const dest = path.join(projectDir, "chat.json");
    const tmp = `${dest}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2));
    await fs.rename(tmp, dest);
  });
  CHAT_LOCK.set(stem, next.catch(() => { /* surfaced below */ }));
  try {
    await next;
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "chat-write-failed", detail: String(err) }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, count: trimmed.length }));
};

// ---------------------------------------------------------------------------
// /api/events/:stem   (GET + POST — named time-event markers)
// ---------------------------------------------------------------------------
//
// Per-project events.json — the MC-style `waitUntil('name')` store. Schema
// validated via parseEventsFile so malformed entries (e.g. hand-edited JSON)
// don't poison the editor state.

const handleEventsGet = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  const dest = path.join(PROJECTS_DIR, stem, "events.json");
  let parsed: ReturnType<typeof parseEventsFile>;
  try {
    const content = await fs.readFile(dest, "utf8");
    parsed = parseEventsFile(JSON.parse(content));
  } catch {
    // Missing file is the default state — return empty v1 doc.
    parsed = parseEventsFile(undefined);
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(parsed));
};

const handleEventsSave = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  const body = await readJsonBody(req);
  // Validate at the gateway — the client may send the whole file OR just the
  // events array. parseEventsFile normalizes both.
  const toPersist = parseEventsFile(body);
  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "project not found", stem }));
    return;
  }

  const prev = EVENTS_LOCK.get(stem) ?? Promise.resolve();
  const next = prev.then(async () => {
    const destFile = path.join(projectDir, "events.json");
    const tmp = `${destFile}.tmp`;
    await fs.writeFile(tmp, serializeEventsFile(toPersist.events));
    await fs.rename(tmp, destFile);
  });
  EVENTS_LOCK.set(
    stem,
    next.catch(() => {}),
  );
  try {
    await next;
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "events-write-failed", detail: String(err) }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, count: toPersist.events.length }));
};

// ---------------------------------------------------------------------------
// /api/out/:file   (GET — stream a rendered MP4 back to the browser)
// ---------------------------------------------------------------------------
//
// Vite's dev server doesn't publish `out/`. Without this, the editor's
// "Rendered ✓ — click to open" link would need to 404 or prompt the OS
// for a file URL (browsers block those). Streaming through the sidecar
// keeps the link inside the normal http origin. Path traversal is
// defended by rejecting anything that escapes OUT_DIR after resolve.

const handleOut = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  // Connect strips the mount prefix, so req.url here is like
  // "/musicvideo-123.mp4?x=y" (not "/api/out/..."). Strip leading slashes
  // so path.resolve treats the name as relative to OUT_DIR.
  const raw = (req.url ?? "").split("?")[0];
  const name = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!name || name.includes("\0") || name.includes("/") || name.includes("\\")) {
    res.statusCode = 400;
    res.end("bad name");
    return;
  }
  const full = path.resolve(OUT_DIR, name);
  if (!full.startsWith(OUT_DIR + path.sep)) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }
  const stat = await fs.stat(full).catch(() => null);
  if (!stat) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  const ext = path.extname(name).toLowerCase();
  const mime =
    ext === ".mp4"
      ? "video/mp4"
      : ext === ".webm"
        ? "video/webm"
        : ext === ".mov"
          ? "video/quicktime"
          : "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Accept-Ranges", "bytes");
  const { createReadStream } = await import("node:fs");
  createReadStream(full).pipe(res);
};

// ---------------------------------------------------------------------------
// /api/render
// ---------------------------------------------------------------------------

const handleRender = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const props = body?.props;
  const name = sanitizeName(body?.name ?? "musicvideo");
  if (!props || typeof props !== "object") {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "body.props required" }));
    return;
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outName = `${name}.mp4`;
  const outPath = path.join(OUT_DIR, outName);

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  sendSseEvent(res, "start", { outPath, outName });

  const args = [
    "remotion",
    "render",
    "src/index.ts",
    "MusicVideo",
    outPath,
    `--props=${JSON.stringify(props)}`,
  ];
  // Optional partial-range render: body.frames = { start, end } in frame
  // indices (inclusive). Passes through as --frames=start-end. Used by
  // the editor's in/out selector ([ / ]) to render just the marked range.
  const framesReq = body?.frames;
  if (
    framesReq && typeof framesReq === "object" &&
    typeof (framesReq as {start?: unknown}).start === "number" &&
    typeof (framesReq as {end?: unknown}).end === "number"
  ) {
    const start = Math.max(0, Math.floor(Number((framesReq as {start: number}).start)));
    const end = Math.max(start, Math.floor(Number((framesReq as {end: number}).end)));
    args.push(`--frames=${start}-${end}`);
  }
  const child = spawn("npx", args, {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const pushLine = (channel: "stdout" | "stderr", chunk: Buffer) => {
    const lines = chunk.toString("utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      sendSseEvent(res, "log", { channel, line });
      // Remotion progress lines look like: "Rendering frames (24/432)"
      const m = line.match(/\((\d+)\/(\d+)\)/);
      if (m) {
        sendSseEvent(res, "progress", {
          done: Number(m[1]),
          total: Number(m[2]),
        });
      }
    }
  };
  child.stdout.on("data", (c) => pushLine("stdout", c));
  child.stderr.on("data", (c) => pushLine("stderr", c));

  child.on("close", (code) => {
    sendSseEvent(res, "done", { code, outPath, outName, ok: code === 0 });
    res.end();
  });
  req.on("close", () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });
};

// ---------------------------------------------------------------------------
// /api/chat  (Claude Code CLI → mutation list)
// ---------------------------------------------------------------------------

const CHAT_SYSTEM = `You are an editor assistant for a music-video editor.

The user will describe what they want. You respond with a JSON object:
{
  "reply": "<short human-readable summary of what you're doing>",
  "mutations": [ <zero or more mutation objects> ]
}

Mutation shapes:

  Element ops (edit the timeline):
  { "op": "addElement",    "element": { id, type, trackIndex, startSec, durationSec, label, props } }
  { "op": "updateElement", "id": "<elementId>", "patch": { startSec?, durationSec?, trackIndex?, label?, props? (shallow merge), startEvent? ("<eventName>" to anchor render-time start to a named event, null to clear) } }
  { "op": "removeElement", "id": "<elementId>" }
  { "op": "seekTo",        "sec": <number> }
  { "op": "setPlaying",    "playing": <boolean> }

  Project-lifecycle ops (no-CLI alternatives to npm run mv:*):
  { "op": "scaffold",      "audioPath": "/abs/path/to/track.mp3" }   # Create new project + auto-run analysis. Use when the user says "add this track", "bring in /path/to/song.mp3", "new project from ...". Progress visible in StageStrip after automatic switch to the new stem.
  { "op": "analyze",       "stem": "<optional; current track if omitted>" }   # Re-run mv:analyze (Setup + Phase 1 + Phase 2). ~5-10 min. For "analyze again", "re-run analysis", "redo phase 2".
  { "op": "seedBeats",     "stem": "<optional>" }   # Run detect-beats.py only (~45s). Use for "just detect beats", "fix the beat grid", "snap-to-beat isn't working".
  { "op": "clearEvents",   "stem": "<optional>" }   # Remove Phase 1 + Phase 2 events. Keeps beats/bands. For "clear the pipeline events", "start over with events".
  { "op": "switchTrack",   "stem": "<required>" }   # Switch the editor to a different existing project. For "open <track>", "switch to <name>", "load the other one".

  Named time-event ops (per-project events.json, the MC-style waitUntil('name') store):
  { "op": "addEvent",      "name": "<string>", "timeSec": <number ≥ 0> }   # Create or update a named event. Use for "mark the drop at 30s as 'drop1'", "remember beat 12:12 as zeta".
  { "op": "moveEvent",     "name": "<string>", "timeSec": <number ≥ 0> }   # Adjust time of an existing event (fails if absent). Use for "move drop1 back 2 seconds".
  { "op": "renameEvent",   "oldName": "<string>", "newName": "<string>" }   # Rename. Fails on collision with existing newName.
  { "op": "removeEvent",   "name": "<string>" }   # Delete a named event.

Element types and their main props (all props optional; reasonable defaults used if omitted):
  text.typingText        { text, cps, textColor, fontSize, fontWeight, fontFamily, x, y }
  text.glitchText        { text, rate, intensity, textColor, fontSize }
  text.poppingText       { text, damping, stiffness, textColor, fontSize }
  text.slidingText       { text, from ("left"|"right"|"top"|"bottom"), textColor, fontSize }
  text.bellCurve         { text, sigmaSec, zoomFrom, zoomTo, textColor, fontSize, x, y, bassReactive }
  text.beatDrop          { words: string[], mode ("cut"|"flash"), textColor, fontSize, useDownbeatsOnly, decay, blackBackground }
  text.fitboxSVGWord     { text, textColor, viewBoxWidth, viewBoxHeight, paddingPct }
  audio.spectrumBars     { position, numberOfBars, height, color, opacity, mirror, gap, amplitude, logScale }
  audio.waveformPath     { position, height, color, strokeWidth, smoothing, amplitude }
  audio.bassGlowOverlay  { color, intensity, bassThreshold }
  shape.pathReveal       { svgPath, viewBoxWidth, viewBoxHeight, stroke, strokeWidth, x, y, widthPct, heightPct, triggerOnBeats, drawDurationFrames }
  shape.neonStrokeStack  { lines: string[], color, glow }
  shape.sonarRings       { color, strokeWidth, ringLifeSec, maxRadiusPct, triggerOn ("beats"|"downbeats"), x, y, fadeExponent }
  overlay.preDropFadeHold { startFade, endFade, holdUntil }
  overlay.watermarkMask  { position, widthPx, heightPx, offsetPx, background, blurPx, opacity, borderRadius }
  overlay.videoClip      { videoSrc, videoStartSec, opacity, scale, beatBrightnessBoost, beatBrightnessDecay, objectFit, muted }

Tools available:
You are running as a Claude Code subagent with the same toolset as the interactive CLI (Read, Bash, Glob, Grep, Edit, Write, WebFetch). Use them freely to:
- Read files: inspect projects/<stem>/analysis.json for beat timings, .analyze-status.json for pipeline phase, any PNG under projects/<stem>/analysis/ for visual review.
- Run bash: "ps aux | grep mv:analyze" to check running processes, tail log files, query git.
- Grep / Glob the codebase to answer "why is X doing Y" questions.
- Edit or Write files only when the user explicitly asks for a code change (and respect engine-lock rules — engine paths under src/, editor/, scripts/ need ENGINE_UNLOCK in the shell env, which you do not have here; report that the user needs to do it themselves if they ask for such an edit).

When a question can be answered by reading/inspecting, do the work — don't just emit mutations from the prompt state alone. The "Current editor state" section below is a snapshot, not the full picture. If the user asks "do the events sit on real beats?", actually read analysis.json + the confirmed-full PNG and report.

Output format:
End your turn with a single final-output block that the client parses:

<final>
{ "reply": "<short human summary; 1-3 sentences>", "mutations": [ <zero or more mutation objects> ] }
</final>

Everything before <final> is free-form reasoning + tool use — the client discards it. Everything between <final> and </final> must be valid JSON with exactly those two keys.

Mutation rules:
- Generate new element ids as short random strings (e.g. "el-7x3k").
- trackIndex: 0-3 for text, 4 for shapes, 5-6 for overlays, 7 for mask, 8 for video.
- When inserting at a specific beat/drop, use seconds (e.g. drop at 12:12 = 732).
- If you are unsure what the user wants, emit an empty mutations array and explain in reply.
- If a request needs code changes that require ENGINE_UNLOCK (editor/src/**, scripts/**, etc.), emit { "reply": "requires ENGINE_UNLOCK=1; set ENGINE_UNLOCK=1 in your shell and restart the editor, then re-issue", "mutations": [] }.
`.trim();

// ---------------------------------------------------------------------------
// /api/timeline/watch/:stem  (GET — SSE stream of external edits to timeline.json)
// ---------------------------------------------------------------------------
//
// Pushes a `change` event whenever projects/<stem>/timeline.json is modified
// by something OTHER than the autosave round-trip (e.g. Claude Code's Edit
// tool touching the file, or the user editing it in vim). The editor's
// useTimelineSync hook consumes this stream and re-hydrates the store so
// the preview reflects the external change without a manual refresh.
//
// Watches the PARENT DIRECTORY and filters on filename because our own
// /api/timeline/save writes a tmp file then renames — fs.watch on the
// file itself loses the inode during that rename. Dir-watch + filter is
// race-free.

const handleTimelineWatch = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  // Connect strips "/api/timeline/watch/"; req.url is "/love-in-traffic".
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a dir");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "project not found", stem }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable nginx-style buffering if ever behind a proxy
  });

  // Resources get created below; cleanup is registered FIRST so a client
  // abort between writeHead and watcher/interval creation can't leak them.
  let watcher: FSWatcher | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };
  req.on("close", cleanup);

  // If the client already closed during the 404/stat path, bail now.
  if (req.destroyed) {
    cleanup();
    return;
  }

  res.write(`event: hello\ndata: ${JSON.stringify({ stem })}\n\n`);

  try {
    watcher = fsWatch(projectDir, { persistent: false }, (eventType, filename) => {
      if (filename !== "timeline.json") return;
      if (eventType !== "change" && eventType !== "rename") return;
      try {
        res.write(`event: change\ndata: ${JSON.stringify({ stem, ts: Date.now() })}\n\n`);
      } catch {
        // connection closed; ignore
      }
    });
  } catch (err) {
    // Directory watch failed (unlikely). Surface as a one-off SSE error
    // and hold the connection so the client doesn't reconnect-storm.
    res.write(`event: error\ndata: ${JSON.stringify({ stem, detail: String(err) })}\n\n`);
  }

  // SSE keep-alive — some intermediaries close idle connections at 30s.
  keepalive = setInterval(() => {
    try {
      res.write(":keepalive\n\n");
    } catch {
      /* closed */
    }
  }, 20000);
};

// ---------------------------------------------------------------------------
// /api/analyze/events/:stem  (GET — SSE stream of projects/<stem>/analysis.json)
// ---------------------------------------------------------------------------
//
// Mirrors /api/timeline/watch/:stem but for analysis.json. Emits an initial
// `events` event with the full file contents on connect, then a new `events`
// event whenever the file changes. The editor's useTimelineSync hook uses
// this to auto-populate locked pipeline placeholders (text.bellCurve per
// confirmed event) on re-runs of the analysis pipeline.

const handleAnalyzeEvents = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  const file = path.join(projectDir, "analysis.json");
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a dir");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "project not found", stem }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const emit = async () => {
    // SSE protocol: every continuation line in the message body must be
    // prefixed with `data:`. Pretty-printed JSON contains real newlines,
    // so the browser's EventSource only receives the first line ("{")
    // and JSON.parse throws. Parse+stringify collapses to one line.
    let payload: string;
    try {
      const raw = await fs.readFile(file, "utf8");
      try {
        payload = JSON.stringify(JSON.parse(raw));
      } catch {
        payload = JSON.stringify({ error: "invalid-json" });
      }
    } catch {
      payload = "{}";
    }
    try {
      res.write(`event: events\ndata: ${payload}\n\n`);
    } catch {
      // connection closed between readFile and write; ignore
    }
  };

  let watcher: FSWatcher | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };
  req.on("close", cleanup);
  if (req.destroyed) {
    cleanup();
    return;
  }

  await emit(); // initial snapshot

  try {
    watcher = fsWatch(projectDir, { persistent: false }, (eventType, filename) => {
      // macOS FSEvents sometimes reports filename==null for dotfiles or on
      // rename across inodes. Treat null as "unknown, re-emit to be safe".
      if (filename != null && filename !== "analysis.json") return;
      if (eventType !== "change" && eventType !== "rename") return;
      void emit();
    });
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ stem, detail: String(err) })}\n\n`);
  }

  keepalive = setInterval(() => {
    try {
      res.write(":keepalive\n\n");
    } catch {
      /* closed */
    }
  }, 20000);
};

// ---------------------------------------------------------------------------
// /api/analyze/status/:stem  (GET — SSE stream of projects/<stem>/.analyze-status.json)
// ---------------------------------------------------------------------------
//
// Mirrors handleAnalyzeEvents for the per-run status file written by
// mv:analyze at phase boundaries. Sends `event: status` with the JSON body
// on connect + on every fs.watch change. The editor's StageStrip component
// subscribes to this and renders the current pipeline phase.

const handleAnalyzeStatus = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, ""));
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  const file = path.join(projectDir, ".analyze-status.json");
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a dir");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "project not found", stem }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const emit = async () => {
    let payload: string;
    try {
      const raw = await fs.readFile(file, "utf8");
      try {
        payload = JSON.stringify(JSON.parse(raw));
      } catch {
        payload = "null";
      }
    } catch {
      payload = "null";
    }
    try {
      res.write(`event: status\ndata: ${payload}\n\n`);
    } catch {
      // connection closed
    }
  };

  let watcher: FSWatcher | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };
  req.on("close", cleanup);
  if (req.destroyed) {
    cleanup();
    return;
  }

  await emit();

  try {
    watcher = fsWatch(projectDir, { persistent: false }, (eventType, filename) => {
      // macOS FSEvents often reports filename==null for dotfiles —
      // treat null as "unknown, re-emit to be safe".
      if (filename != null && filename !== ".analyze-status.json") return;
      if (eventType !== "change" && eventType !== "rename") return;
      void emit();
    });
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ stem, detail: String(err) })}\n\n`);
  }

  keepalive = setInterval(() => {
    try {
      res.write(":keepalive\n\n");
    } catch {
      /* closed */
    }
  }, 20000);
};

// Merge empty event lists into projects/<stem>/analysis.json. Preserves
// beats/downbeats/duration/energy_bands and every other field — only wipes
// phase1_events_sec and phase2_events_sec. Shared by /api/analyze/clear and
// the pre-clear at the head of /api/analyze/run so the editor doesn't hold
// stale pipeline elements for the 5–10 min a fresh run is in flight.
// Snapshot the project's current analysis.json to analysis/runs/<ISO>.json
// before any destructive operation (clear, re-analyze, seed-beats, events
// update). Lets the user revert to a prior analysis without git. Retention
// cap keeps the latest ANALYSIS_RUN_KEEP snapshots per project.
const ANALYSIS_RUN_KEEP = 10;
const snapshotAnalysisJson = async (projectDir: string): Promise<void> => {
  const analysisFile = path.join(projectDir, "analysis.json");
  try {
    await fs.access(analysisFile);
  } catch {
    return; // no analysis.json yet — nothing to snapshot
  }
  const runsDir = path.join(projectDir, "analysis", "runs");
  try {
    await fs.mkdir(runsDir, { recursive: true });
  } catch {
    return; // directory creation failed; skip snapshot rather than block
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(runsDir, `${stamp}.json`);
  try {
    await fs.copyFile(analysisFile, dest);
  } catch {
    return; // snapshot is best-effort; don't block the destructive op
  }
  // Retention: keep the newest ANALYSIS_RUN_KEEP files, prune the rest.
  try {
    const entries = await fs.readdir(runsDir);
    const dated = entries
      .filter((n) => n.endsWith(".json"))
      .map((n) => ({ n, full: path.join(runsDir, n) }));
    // Filename is ISO-ish → lexical sort == chronological.
    dated.sort((a, b) => (a.n < b.n ? 1 : -1));
    for (const stale of dated.slice(ANALYSIS_RUN_KEEP)) {
      await fs.unlink(stale.full).catch(() => {});
    }
  } catch {
    /* pruning is optional */
  }
};

const clearAnalysisEvents = async (projectDir: string): Promise<void> => {
  const analysisFile = path.join(projectDir, "analysis.json");
  let existing: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(analysisFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") existing = parsed as Record<string, unknown>;
  } catch {
    /* missing file is fine */
  }
  const merged = {
    ...existing,
    phase1_events_sec: [],
    phase2_events_sec: [],
  };
  await fs.writeFile(analysisFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
};

// POST /api/analyze/run  {stem}
// Spawns `npm run mv:analyze -- --project <stem>` as a detached child so the
// dev server doesn't block for the 5–10 min analysis wall clock. Status is
// surfaced through the same .analyze-status.json → SSE channel the
// StageStrip already reads from. Returns 202 immediately if kickoff
// succeeded, 409 if another run is already in flight for this stem.
const handleAnalyzeRun = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const stem: string = String(body?.stem ?? "").trim();
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.stem must match /^[a-z0-9_-]+$/i" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `project ${stem} not found` }));
    return;
  }
  const statusFile = path.join(projectDir, ".analyze-status.json");
  try {
    const existing = await fs.readFile(statusFile, "utf8");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(existing);
    } catch {
      // Mid-write corrupt JSON means something IS running (mv-analyze is
      // writing). Conservatively 409 to avoid a double-spawn.
      res.statusCode = 409;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "status file mid-write; retry in a moment" }));
      return;
    }
    if (parsed?.startedAt && !parsed.endedAt) {
      res.statusCode = 409;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "analysis already in flight", state: parsed }));
      return;
    }
  } catch {
    /* no status file — no prior run */
  }

  // Drop old pipeline events from analysis.json BEFORE spawning mv:analyze.
  // The editor's SSE watcher picks up the emptied event arrays and calls
  // replacePipelineElements(stem, []), so the timeline shows a clean slate
  // while the new run is in flight. Fresh events flow in when mv:analyze
  // writes the final analysis.json.
  await snapshotAnalysisJson(projectDir);
  await clearAnalysisEvents(projectDir);

  const { spawn: spawnChild } = await import("node:child_process");
  const analyzeArgs = ["run", "mv:analyze", "--", "--project", stem];
  const logStream = openAnalyzeLogStream(projectDir, "mv:analyze", analyzeArgs);
  const child = spawnChild("npm", analyzeArgs, {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  child.stdout?.pipe(logStream, { end: false });
  child.stderr?.pipe(logStream, { end: false });
  child.on("close", () => {
    try {
      logStream.end();
    } catch {
      /* ignore */
    }
  });
  child.unref();
  res.statusCode = 202;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ stem, pid: child.pid }));
};

// POST /api/analyze/seed-beats  {stem}
// Spawns `npm run mv:seed-beats -- --project <stem>` as a detached child.
// Runs ONLY detect-beats.py (~30-60s) and merges beats/downbeats/bpm into
// projects/<stem>/analysis.json. Safe to call anytime — doesn't touch phase
// events or energy bands. Used to backfill beats on projects that predate
// the beat-tracking integration (ead3c3a).
const handleAnalyzeSeedBeats = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const stem: string = String(body?.stem ?? "").trim();
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.stem must match /^[a-z0-9_-]+$/i" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  try {
    const st = await fs.stat(projectDir);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `project ${stem} not found` }));
    return;
  }
  await snapshotAnalysisJson(projectDir);
  const { spawn: spawnChild } = await import("node:child_process");
  const seedArgs = ["run", "mv:seed-beats", "--", "--project", stem];
  const logStream = openAnalyzeLogStream(projectDir, "mv:seed-beats", seedArgs);
  const child = spawnChild("npm", seedArgs, {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  child.stdout?.pipe(logStream, { end: false });
  child.stderr?.pipe(logStream, { end: false });
  child.on("close", () => {
    try {
      logStream.end();
    } catch {
      /* ignore */
    }
  });
  child.unref();
  res.statusCode = 202;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ stem, pid: child.pid }));
};

// Shared tail for byte-upload and path-based scaffold endpoints.
// Runs mv:scaffold synchronously (fast: file copy + starter json), parses
// the stem from stdout, spawns mv:analyze detached, and writes a 202
// response. If cleanupTmp is true, unlinks audioPath after scaffold copies
// the bytes into projects/<stem>/ (it's a tempfile we own).
const runScaffoldAndAnalyze = async (
  audioPath: string,
  stemHint: string,
  cleanupTmp: boolean,
  res: ServerResponse,
): Promise<void> => {
  const scaffoldArgs = ["run", "--silent", "mv:scaffold", "--", "--audio", audioPath];
  if (stemHint) scaffoldArgs.push("--stem", stemHint);
  const scaffold = spawnSync("npm", scaffoldArgs, { cwd: REPO_ROOT, encoding: "utf8" });
  if (cleanupTmp) {
    try {
      await fs.unlink(audioPath);
    } catch {
      /* best effort */
    }
  }
  if (scaffold.status !== 0) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "scaffold-failed",
        stdout: scaffold.stdout,
        stderr: scaffold.stderr,
      }),
    );
    return;
  }
  const stemMatch = (scaffold.stdout || "").match(/scaffolded projects\/([a-z0-9_-]+)\//);
  if (!stemMatch) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "scaffold-succeeded-but-stem-not-parsed",
        stdout: scaffold.stdout,
      }),
    );
    return;
  }
  const stem = stemMatch[1];
  const child = spawn("npm", ["run", "mv:analyze", "--", "--project", stem], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
  res.statusCode = 202;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ stem, analysisPid: child.pid }));
};

// POST /api/projects/create-from-path  {audioPath}
// Chat-invoked variant of /api/projects/create: the chat layer has a file
// path (from the user's natural-language request), not uploaded bytes.
// Validates the path exists and is one of .mp3/.wav/.m4a, then delegates
// to the shared scaffold+analyze helper. No tempfile cleanup — the audio
// lives where the user left it.
const handleProjectCreateFromPath = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const body = await readJsonBody(req);
  const audioPath = String(body?.audioPath ?? "").trim();
  if (!audioPath) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.audioPath required" }));
    return;
  }
  const resolved = path.resolve(audioPath);
  try {
    const st = await fs.stat(resolved);
    if (!st.isFile()) throw new Error("not a file");
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `audio file not found: ${audioPath}` }));
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  if (![".mp3", ".wav", ".m4a"].includes(ext)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: `unsupported audio format: ${ext} (expected .mp3/.wav/.m4a)`,
      }),
    );
    return;
  }
  await runScaffoldAndAnalyze(resolved, path.basename(resolved, ext), false, res);
};

// POST /api/projects/create
// Upload an audio file + create a new project end-to-end with no CLI:
//   1. Stream the raw body (audio bytes) to a tempfile.
//   2. Run `npm run mv:scaffold` synchronously — copies into projects/<stem>/,
//      writes starter timeline.json. Stem is derived from the original
//      filename slug (passed via X-Audio-Filename header).
//   3. Spawn `npm run mv:analyze --project <stem>` detached — Setup (incl.
//      detect-beats) + Phase 1 + Phase 2. Progress streams via the existing
//      .analyze-status.json SSE channel.
//
// Returns 202 with {stem, analysisPid} as soon as scaffold completes; the
// client can immediately switch to the new stem and StageStrip picks up
// the running analysis.
const handleProjectCreate = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const origFilename = String(req.headers["x-audio-filename"] ?? "").slice(0, 200);
  if (!origFilename) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "X-Audio-Filename header required" }));
    return;
  }
  const ext = path.extname(origFilename).toLowerCase();
  if (![".mp3", ".wav", ".m4a"].includes(ext)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `expected .mp3/.wav/.m4a filename (got ${ext})` }));
    return;
  }

  // Stream body to tempfile. Avoid buffering large audio in memory.
  const tmpFile = path.join(os.tmpdir(), `editor-upload-${Date.now()}${ext}`);
  try {
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(tmpFile);
      req.pipe(ws);
      ws.on("finish", () => resolve());
      ws.on("error", reject);
      req.on("error", reject);
    });
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "upload-write-failed", detail: String(err) }));
    try {
      await fs.unlink(tmpFile);
    } catch {
      /* best effort */
    }
    return;
  }

  await runScaffoldAndAnalyze(tmpFile, path.basename(origFilename, ext), true, res);
};

// POST /api/analyze/clear  {stem}
// POST /api/analyze/clear  {stem}
// Sets analysis.json to an empty events list so the SSE EventSource next
// tick pushes `{}` → replacePipelineElements(stem, []) → merge removes all
// pipeline-origin elements. User-origin elements and on-disk artifacts
// (analysis/**/*.png, phase*-events.json) are NOT touched; use Re-analyze
// to regenerate.
const handleAnalyzeClear = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const stem: string = String(body?.stem ?? "").trim();
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.stem must match /^[a-z0-9_-]+$/i" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  const statusFile = path.join(projectDir, ".analyze-status.json");
  // Reject CLEAR mid-run — otherwise we race mv-analyze's final
  // `cp phase2-events.json analysis.json` and can leave either zombie
  // state in the file.
  try {
    const raw = await fs.readFile(statusFile, "utf8");
    const st = JSON.parse(raw);
    if (st?.startedAt && !st.endedAt) {
      res.statusCode = 409;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "cannot clear while analysis is running" }));
      return;
    }
  } catch {
    /* no status or corrupt — proceed (will be harmless) */
  }

  await snapshotAnalysisJson(projectDir);
  await clearAnalysisEvents(projectDir);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ stem, cleared: true }));
};

// GET /api/analyze/runs/:stem
// Lists the per-run analysis.json snapshots retained for a project. Returns
// [{ id, timestamp, events: number }] sorted newest-first. UI consumes this
// via the StageStrip "runs" dropdown so users can revert to a prior run.
const handleAnalyzeRunsList = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  // Connect strips the "/api/analyze/runs/" mount; req.url is "<stem>" or similar
  const raw = (req.url ?? "").split("?")[0];
  const stem = decodeURIComponent(raw.replace(/^\/+/, "").split("/")[0]);
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "stem must match /^[a-z0-9_-]+$/i" }));
    return;
  }
  const runsDir = path.join(PROJECTS_DIR, stem, "analysis", "runs");
  let files: string[] = [];
  try {
    files = (await fs.readdir(runsDir)).filter((n) => n.endsWith(".json"));
  } catch {
    // No runs dir yet — fine, return empty list.
  }
  files.sort((a, b) => (a < b ? 1 : -1)); // newest first (ISO name → lexical)
  const runs = await Promise.all(
    files.map(async (n) => {
      const id = n.replace(/\.json$/, "");
      const fp = path.join(runsDir, n);
      let events = 0;
      try {
        const raw = await fs.readFile(fp, "utf8");
        const parsed = JSON.parse(raw);
        events =
          (parsed?.phase2_events_sec?.length ?? 0) || (parsed?.phase1_events_sec?.length ?? 0);
      } catch {
        /* unreadable run — still list the id */
      }
      return {
        id,
        timestamp: id.replace(/-/g, (_m, i) => (i < 10 ? "-" : i < 13 ? "T" : ":")),
        events,
      };
    }),
  );
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ stem, runs }));
};

// POST /api/analyze/runs/:stem/restore  {id}
// Copy analysis/runs/<id>.json back over analysis.json. Also snapshots the
// current state first so a restore is itself reversible. Returns the
// restored events list.
const handleAnalyzeRunsRestore = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  // Connect strips "/api/analyze/runs/"; req.url is "<stem>/restore".
  const urlPath = (req.url ?? "").split("?")[0];
  const m = urlPath.replace(/^\/+/, "").match(/^([^/]+)\/restore$/);
  if (!m || !STEM_RE.test(m[1])) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "URL must be /api/analyze/runs/<stem>/restore" }));
    return;
  }
  const stem = m[1];
  const body = await readJsonBody(req);
  const id: string = String(body?.id ?? "").trim();
  if (!id || !/^[0-9T:.\-Z]+$/.test(id)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.id required (ISO-ish timestamp)" }));
    return;
  }
  const projectDir = path.join(PROJECTS_DIR, stem);
  const src = path.join(projectDir, "analysis", "runs", `${id}.json`);
  try {
    await fs.access(src);
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `run ${id} not found for ${stem}` }));
    return;
  }
  // Snapshot the current state so the restore itself is reversible.
  await snapshotAnalysisJson(projectDir);
  const dest = path.join(projectDir, "analysis.json");
  await fs.copyFile(src, dest);
  const raw = await fs.readFile(dest, "utf8");
  const parsed = JSON.parse(raw);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      stem,
      restored: id,
      phase1: parsed?.phase1_events_sec?.length ?? 0,
      phase2: parsed?.phase2_events_sec?.length ?? 0,
    }),
  );
};

// POST /api/analyze/events/update  {stem, events: number[]}
// Replaces projects/<stem>/analysis.json's phase2_events_sec with the given
// list (sorted ascending, deduped at 0.05s granularity). Treats user edits
// as confirmed (phase 2 equivalent). All other fields preserved. Rejects if
// a mv:analyze run is in flight (same lock as /api/analyze/clear). SSE
// watcher auto-pushes the new events to every connected client.
// POST /api/analyze/cancel  {stem}
// Kills the in-flight mv:analyze child for a stem. Uses pgrep to find the
// npm wrapper process whose args contain "--project <stem>"; sends SIGTERM
// to the process group so energy-bands.py / plot-pioneer.py / claude -p
// descendants all die together. Writes a final status frame with
// phase:"cancelled" so the editor's SSE handler clears Running state.
const handleAnalyzeCancel = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const stem: string = String(body?.stem ?? "").trim();
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.stem must match /^[a-z0-9_-]+$/i" }));
    return;
  }
  const { spawn: spawnChild } = await import("node:child_process");
  const killed: number[] = [];
  try {
    // pgrep -f matches the full command line; mv:analyze args include the
    // stem so this isolates the per-stem run.
    const pgrep = spawnChild("pgrep", ["-f", `mv:analyze .*--project ${stem}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    pgrep.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    await new Promise<void>((resolve) => pgrep.on("exit", () => resolve()));
    const pids = stdout.trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite);
    for (const pid of pids) {
      try {
        // Negative pid targets the process group (all descendants).
        process.kill(-pid, "SIGTERM");
        killed.push(pid);
      } catch {
        // Process already gone or no perms — continue.
      }
    }
  } catch {
    /* pgrep unavailable — fall through with empty killed */
  }

  // Record a terminal status frame so SSE clients flip out of Running.
  const projectDir = path.join(PROJECTS_DIR, stem);
  const statusFile = path.join(projectDir, ".analyze-status.json");
  let startedAt = Date.now();
  try {
    const raw = await fs.readFile(statusFile, "utf8");
    const st = JSON.parse(raw);
    if (st?.startedAt) startedAt = st.startedAt;
  } catch {
    /* fine */
  }
  const tmp = `${statusFile}.tmp`;
  const now = Date.now();
  await fs.writeFile(
    tmp,
    JSON.stringify(
      { startedAt, phase: "cancelled", stage: null, updatedAt: now, endedAt: now },
      null,
      2,
    ),
  );
  await fs.rename(tmp, statusFile);

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ stem, killed }));
};

const handleAnalyzeEventsUpdate = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const body = await readJsonBody(req);
  const stem: string = String(body?.stem ?? "").trim();
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.stem must match /^[a-z0-9_-]+$/i" }));
    return;
  }
  const rawEvents = Array.isArray(body?.events) ? body.events : null;
  if (!rawEvents) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "body.events must be an array of numbers" }));
    return;
  }
  const events = rawEvents
    .map((v: unknown) => (typeof v === "number" ? v : Number(v)))
    .filter((v: number) => Number.isFinite(v) && v >= 0);
  // Dedupe within 0.05s of each other; keep first occurrence.
  events.sort((a: number, b: number) => a - b);
  const deduped: number[] = [];
  for (const v of events) {
    if (deduped.length === 0 || v - deduped[deduped.length - 1] > 0.05) {
      deduped.push(Math.round(v * 1000) / 1000);
    }
  }

  const projectDir = path.join(PROJECTS_DIR, stem);
  const statusFile = path.join(projectDir, ".analyze-status.json");
  try {
    const raw = await fs.readFile(statusFile, "utf8");
    const st = JSON.parse(raw);
    if (st?.startedAt && !st.endedAt) {
      res.statusCode = 409;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "cannot edit events while analysis is running" }));
      return;
    }
  } catch {
    /* no status — fine */
  }

  const analysisFile = path.join(projectDir, "analysis.json");
  let existing: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(analysisFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") existing = parsed as Record<string, unknown>;
  } catch {
    /* missing file is fine */
  }
  await snapshotAnalysisJson(projectDir);
  const merged = {
    ...existing,
    phase2_events_sec: deduped,
  };
  await fs.writeFile(analysisFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ stem, events: deduped }));
};

// Gather per-project context the chat assistant needs: the active project's
// custom-elements/*.tsx list (so the assistant knows 'custom.<stem>.*' ids
// exist beyond the engine palette), notes.md if present, and a short
// structural digest. This is injected into the user prompt at request time
// rather than baked into CHAT_SYSTEM because it's project-specific.
const gatherProjectContext = async (stem: string | null): Promise<string> => {
  if (!stem) return "(no active project)";
  const projectDir = resolveProjectDir(REPO_ROOT, stem);
  const parts: string[] = [`stem: ${stem}`, `projectDir: projects/${stem}/`];

  // List per-project custom elements so the assistant can reference
  // custom.<stem>.* ids directly. Without this the assistant only knows
  // the 28 engine elements listed in CHAT_SYSTEM and will fall back to
  // buggy engine defaults (e.g. text.bellCurve for AHURA).
  try {
    const customDir = path.join(projectDir, "custom-elements");
    const entries = await fs.readdir(customDir);
    const tsxFiles = entries.filter((f) => f.endsWith(".tsx") && !f.startsWith("."));
    if (tsxFiles.length > 0) {
      parts.push(`\nper-project custom elements (USE THESE over engine primitives when they fit the user's intent):`);
      for (const file of tsxFiles) {
        try {
          const src = await fs.readFile(path.join(customDir, file), "utf8");
          // Extract id + label + description from the exported module.
          const idMatch = src.match(/id:\s*["']([^"']+)["']/);
          const labelMatch = src.match(/label:\s*["']([^"']+)["']/);
          const descMatch = src.match(/description:\s*["']([^"']+)["']/);
          if (idMatch) {
            parts.push(
              `  - ${idMatch[1]} (${labelMatch?.[1] ?? file}): ${descMatch?.[1] ?? "no description"}`,
            );
          }
        } catch {
          /* skip unreadable file */
        }
      }
    }
  } catch {
    /* no custom-elements dir; fine */
  }

  // Load project notes so the assistant remembers track-specific direction.
  try {
    const notes = await fs.readFile(path.join(projectDir, "notes.md"), "utf8");
    if (notes.trim()) {
      parts.push(`\nproject notes (notes.md):\n${notes.trim()}`);
    }
  } catch {
    /* no notes; fine */
  }

  return parts.join("\n");
};

const handleChat = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const message: string = String(body?.message ?? "").slice(0, 4000);
  const state = body?.state ?? {};
  if (!message) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "body.message required" }));
    return;
  }

  const stem = typeof state.audioSrc === "string" ? stemFromAudioSrc(state.audioSrc) : null;
  const projectContext = await gatherProjectContext(stem);

  const userPrompt = `Current editor state (for your reference):\n${JSON.stringify(
    {
      currentTimeSec: state.currentTimeSec,
      compositionDuration: state.compositionDuration,
      fps: state.fps,
      audioSrc: state.audioSrc,
      beatsSrc: state.beatsSrc,
      elements: state.elements,
    },
    null,
    2,
  )}\n\nProject context:\n${projectContext}\n\nYou have full Claude Code tool access (Read/Bash/Glob/Grep/Edit/Write/WebFetch). The mutation list above is the quickest path for common element edits, but you can also write code: per-project custom elements under projects/${stem ?? "<stem>"}/custom-elements/*.tsx are free-write; src/compositions/** is free-write; other engine paths need ENGINE_UNLOCK=1. You are NOT limited to what appears in the sidebar — if the user asks for something the widgets don't expose (a shader, a new prop, a Remotion-feature not currently wired), investigate and implement it.\n\nUser request:\n${message}\n\nInvestigate with tools as needed, then end with the <final>{...}</final> block.`;

  const args = [
    "-p",
    // --permission-mode bypassPermissions unlocks the full Claude Code toolset
    // (Read/Bash/Glob/Grep/Edit/Write/WebFetch). Without this, tool calls would
    // prompt interactively on stdin and hang - there is no TTY here.
    "--permission-mode",
    "bypassPermissions",
    "--append-system-prompt",
    CHAT_SYSTEM,
    userPrompt,
  ];

  // stdin:"ignore" is load-bearing: without it claude waits 3s for piped
  // stdin, prints a warning, then never emits output in the Vite subprocess
  // context. Closing stdin up-front lets it move straight to the API call.
  const child = spawn(process.env.CLAUDE_BIN || "claude", args, {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on("data", (c) => out.push(c));
  child.stderr.on("data", (c) => err.push(c));

  const code: number = await new Promise((resolve) => child.on("close", (c) => resolve(c ?? -1)));
  const stdout = Buffer.concat(out).toString("utf8");
  const stderr = Buffer.concat(err).toString("utf8");

  if (code !== 0) {
    // Detect Max-plan rate limiting so the client can show a cooldown banner
    // instead of a generic error. The CLI surfaces these as non-zero exits
    // with known markers in stderr/stdout.
    const combined = `${stderr}\n${stdout}`.toLowerCase();
    const rateLimited =
      /rate[- ]?limit/.test(combined) || /too many requests/.test(combined) || /429/.test(combined);
    if (rateLimited) {
      // Try to pull "retry in Ns" / "retry after Ns" out of the message.
      const match = combined.match(
        /retry[^0-9]{0,20}(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes)?/,
      );
      let retryAfter = 60;
      if (match) {
        const n = Number(match[1]);
        const unit = (match[2] || "s").toLowerCase();
        if (Number.isFinite(n) && n > 0) {
          retryAfter = unit.startsWith("m") ? n * 60 : n;
        }
      }
      res.statusCode = 429;
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "claude-cli-rate-limited", retryAfter }));
      return;
    }
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "claude-cli-failed", code, stderr }));
    return;
  }

  // Without --output-format json, stdout is free-form: thinking + tool calls +
  // tool results + final reply. CHAT_SYSTEM requires the model to end with a
  // <final>{...}</final> sentinel - we extract JSON from the LAST such block.
  // Fallback to a greedy brace match if the model forgot the sentinel so the
  // feature degrades rather than erroring.
  let payload: { reply: string; mutations: unknown[] } = {
    reply: stdout.trim() || "(no output)",
    mutations: [],
  };
  const tryParse = (s: string): { reply: string; mutations: unknown[] } | null => {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      const parsed = JSON.parse(s.slice(start, end + 1));
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.reply === "string" &&
        Array.isArray(parsed.mutations)
      ) {
        return { reply: parsed.reply, mutations: parsed.mutations };
      }
    } catch {
      /* not JSON */
    }
    return null;
  };
  const finalRe = /<final>([\s\S]*?)<\/final>/g;
  let lastFinal: string | null = null;
  for (let m = finalRe.exec(stdout); m !== null; m = finalRe.exec(stdout)) lastFinal = m[1];
  const primary = lastFinal !== null ? tryParse(lastFinal) : null;
  if (primary) {
    payload = primary;
  } else {
    const fallback = tryParse(stdout);
    if (fallback) payload = fallback;
  }

  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

// POST /api/chat/stream
// Same contract as /api/chat but streams the turn incrementally:
//   - Spawns `claude -p --output-format stream-json --verbose` so each
//     assistant message / tool_use / tool_result arrives as its own JSON
//     line instead of all-at-once at the end.
//   - Response body is a line-delimited JSON stream (not SSE; the client
//     uses fetch + getReader rather than EventSource so we can keep the
//     POST body for {message, state}).
//   - Emits events: {type:"text", delta}, {type:"tool_use", id, name, input},
//                    {type:"tool_result", tool_use_id, content, is_error},
//                    {type:"done", reply, mutations} OR {type:"error", ...}
//   - Final `done` event parses the accumulated text for <final>{...}</final>
//     the same way /api/chat does, so the client can still apply mutations.
const handleChatStream = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const message: string = String(body?.message ?? "").slice(0, 4000);
  const state = body?.state ?? {};
  const rawHistory = Array.isArray(body?.history) ? body.history : [];
  if (!message) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "body.message required" }));
    return;
  }

  // Render prior turns as a conversational prelude. Claude sees this inside
  // the single-turn user prompt (the CLI\'s -p mode doesn\'t preserve state
  // between spawns, so context is re-sent each turn). Bounded by the client
  // to last 8 turns @ 600 chars each.
  const historyBlock = rawHistory.length
    ? '\n\nPrior conversation (most recent last, for context resolution — "that event", "make it bigger", etc.):\n' +
      rawHistory
        .filter(
          (t: unknown): t is { role: string; content: string } =>
            !!t &&
            typeof t === "object" &&
            typeof (t as { role?: unknown }).role === "string" &&
            typeof (t as { content?: unknown }).content === "string",
        )
        .map((t) => `[${t.role}]: ${t.content}`)
        .join("\n")
    : "";

  const streamStem = typeof state.audioSrc === "string" ? stemFromAudioSrc(state.audioSrc) : null;
  const streamProjectContext = await gatherProjectContext(streamStem);

  const userPrompt = `Current editor state (for your reference):\n${JSON.stringify(
    {
      currentTimeSec: state.currentTimeSec,
      compositionDuration: state.compositionDuration,
      fps: state.fps,
      audioSrc: state.audioSrc,
      beatsSrc: state.beatsSrc,
      elements: state.elements,
    },
    null,
    2,
  )}\n\nProject context:\n${streamProjectContext}\n\nYou have full Claude Code tool access (Read/Bash/Glob/Grep/Edit/Write/WebFetch). Mutations are the quick path for element edits, but you can also write code: per-project custom elements under projects/${streamStem ?? "<stem>"}/custom-elements/*.tsx are free-write, src/compositions/** is free-write, other engine paths need ENGINE_UNLOCK=1. You are NOT limited to what appears in the sidebar — if the user wants something the widgets don't expose (a shader, a new prop, a Remotion feature not yet wired), investigate and implement it.${historyBlock}\n\nUser request:\n${message}\n\nInvestigate with tools as needed, then end with the <final>{...}</final> block.`;

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });

  const send = (obj: unknown) => {
    try {
      res.write(`${JSON.stringify(obj)}\n`);
    } catch {
      /* closed */
    }
  };

  const child = spawn(
    process.env.CLAUDE_BIN || "claude",
    [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      "--append-system-prompt",
      CHAT_SYSTEM,
      userPrompt,
    ],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );

  // Stitch stdout lines: claude emits one JSON per newline, but a line may
  // arrive across multiple data chunks.
  let buf = "";
  let fullText = ""; // for <final> extraction on done
  const stderrBuf: Buffer[] = [];

  const processLine = (line: string) => {
    if (!line.trim()) return;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line);
    } catch {
      return; /* skip malformed */
    }
    const t = ev.type;
    if (t === "assistant") {
      const m = ev.message as { content?: Array<Record<string, unknown>> } | undefined;
      const content = Array.isArray(m?.content) ? m?.content : [];
      for (const c of content) {
        const ct = c.type;
        if (ct === "text" && typeof c.text === "string") {
          fullText += c.text;
          send({ type: "text", delta: c.text });
        } else if (ct === "tool_use") {
          send({
            type: "tool_use",
            id: typeof c.id === "string" ? c.id : "",
            name: typeof c.name === "string" ? c.name : "unknown",
            input: c.input ?? {},
          });
        }
      }
    } else if (t === "user") {
      const m = ev.message as { content?: Array<Record<string, unknown>> } | undefined;
      const content = Array.isArray(m?.content) ? m?.content : [];
      for (const c of content) {
        if (c.type === "tool_result") {
          const raw = c.content;
          const text = Array.isArray(raw)
            ? raw
                .map((x: unknown) =>
                  typeof x === "object" && x && "text" in x ? (x as { text: string }).text : "",
                )
                .join("")
            : typeof raw === "string"
              ? raw
              : "";
          send({
            type: "tool_result",
            tool_use_id: typeof c.tool_use_id === "string" ? c.tool_use_id : "",
            content: text.slice(0, 2000),
            is_error: !!c.is_error,
          });
        }
      }
    } else if (t === "result") {
      // Final event from claude — parse <final>{...}</final> out of the
      // accumulated text, same as the non-streaming endpoint.
      const result = typeof ev.result === "string" ? ev.result : fullText;
      const tryParse = (s: string): { reply: string; mutations: unknown[] } | null => {
        const start = s.indexOf("{");
        const end = s.lastIndexOf("}");
        if (start === -1 || end <= start) return null;
        try {
          const parsed = JSON.parse(s.slice(start, end + 1));
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.reply === "string" &&
            Array.isArray(parsed.mutations)
          ) {
            return { reply: parsed.reply, mutations: parsed.mutations };
          }
        } catch {
          /* not JSON */
        }
        return null;
      };
      const finalRe = /<final>([\s\S]*?)<\/final>/g;
      let lastFinal: string | null = null;
      for (let m = finalRe.exec(result); m !== null; m = finalRe.exec(result)) lastFinal = m[1];
      const primary = lastFinal !== null ? tryParse(lastFinal) : null;
      const payload = primary ??
        tryParse(result) ?? { reply: result.trim() || "(no output)", mutations: [] };
      send({ type: "done", reply: payload.reply, mutations: payload.mutations });
    }
    // other types (system, rate_limit_event, thinking) are dropped client-side
  };

  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    while (true) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      processLine(line);
    }
  });
  child.stderr.on("data", (c: Buffer) => stderrBuf.push(c));

  child.on("close", (code) => {
    // Flush any trailing partial line (rare but possible).
    if (buf.trim()) processLine(buf);
    if (code !== 0) {
      const err = Buffer.concat(stderrBuf).toString("utf8");
      const combined = err.toLowerCase();
      const rateLimited =
        /rate[- ]?limit/.test(combined) ||
        /too many requests/.test(combined) ||
        /429/.test(combined);
      send({
        type: "error",
        code,
        error: rateLimited ? "claude-cli-rate-limited" : "claude-cli-failed",
        stderr: err.slice(0, 500),
      });
    }
    try {
      res.end();
    } catch {
      /* already closed */
    }
  });

  req.on("close", () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });
};

// ---------------------------------------------------------------------------
// /__open-in-editor   (POST — jump to a repo-relative file in $EDITOR)
// ---------------------------------------------------------------------------
//
// Accepts ?file=<relPath>[:line[:col]]. Sanitizes the path to the repo root
// and spawns the user's editor (EDITOR_OPEN_CMD env, default: `code`).
// Dev-only — this plugin only runs under `vite dev` / `vite preview`.

const handleOpenInEditor = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? "", "http://localhost");
  const raw = url.searchParams.get("file") ?? undefined;
  const parsed = parseFileArg(raw);
  if (!parsed) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "missing or invalid 'file' query param" }));
    return;
  }
  const abs = sanitizeEditorPath(parsed.filePath, REPO_ROOT);
  if (!abs) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "path escapes repo root or not resolvable" }));
    return;
  }
  const locator =
    parsed.line !== undefined
      ? `${abs}:${parsed.line}${parsed.column !== undefined ? `:${parsed.column}` : ""}`
      : abs;
  const editorCmd = process.env.EDITOR_OPEN_CMD ?? "code";
  try {
    const child = spawn(editorCmd, ["-g", locator], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    res.statusCode = 204;
    res.end();
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `failed to launch ${editorCmd}: ${String(err)}` }));
  }
};

// ---------------------------------------------------------------------------
// Vite plugin wiring
// ---------------------------------------------------------------------------

const wrap =
  (
    method: "GET" | "POST",
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): Connect.NextHandleFunction =>
  (req, res, next) => {
    // Accept HEAD wherever GET is allowed — browsers preload audio via HEAD
    // and falling through to Vite's SPA fallback would 200 with HTML.
    const ok =
      method === "GET" ? req.method === "GET" || req.method === "HEAD" : req.method === method;
    if (!ok) {
      next();
      return;
    }
    handler(req, res).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[sidecar]", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    });
  };

export const sidecarPlugin = (): Plugin => ({
  name: "music-video-editor-sidecar",
  configureServer(server: ViteDevServer) {
    server.middlewares.use("/api/render", wrap("POST", handleRender));
    server.middlewares.use("/api/chat/stream", wrap("POST", handleChatStream));
    server.middlewares.use("/api/chat", wrap("POST", handleChat));
    server.middlewares.use("/api/songs", wrap("GET", handleSongs));
    server.middlewares.use("/api/out/", wrap("GET", handleOut));
    server.middlewares.use("/api/projects/", wrap("GET", handleProjectFile));
    server.middlewares.use("/api/analyze/events/", wrap("GET", handleAnalyzeEvents));
    server.middlewares.use("/api/analyze/status/", wrap("GET", handleAnalyzeStatus));
    server.middlewares.use("/api/analyze/run", wrap("POST", handleAnalyzeRun));
    server.middlewares.use("/api/analyze/seed-beats", wrap("POST", handleAnalyzeSeedBeats));
    server.middlewares.use("/api/projects/create", wrap("POST", handleProjectCreate));
    server.middlewares.use(
      "/api/projects/create-from-path",
      wrap("POST", handleProjectCreateFromPath),
    );
    server.middlewares.use("/api/analyze/clear", wrap("POST", handleAnalyzeClear));
    server.middlewares.use("/api/analyze/cancel", wrap("POST", handleAnalyzeCancel));
    server.middlewares.use("/api/analyze/events/update", wrap("POST", handleAnalyzeEventsUpdate));
    // Single /api/analyze/runs/ prefix; the dispatcher below branches by
    // method + whether the URL ends with /restore.
    server.middlewares.use("/api/analyze/runs/", (req, res, next) => {
      const url = req.url ?? "";
      const isRestore = url.includes("/restore");
      if (req.method === "POST" && isRestore) {
        handleAnalyzeRunsRestore(req, res).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[sidecar] runs/restore", err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(err?.message ?? err) }));
        });
        return;
      }
      if ((req.method === "GET" || req.method === "HEAD") && !isRestore) {
        handleAnalyzeRunsList(req, res).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[sidecar] runs/list", err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(err?.message ?? err) }));
        });
        return;
      }
      next();
    });
    server.middlewares.use("/api/timeline/save", wrap("POST", handleTimelineSave));
    // Global chat (single continuous conversation across tracks).
    server.middlewares.use("/api/chat-global/save", wrap("POST", handleChatGlobalSave));
    server.middlewares.use("/api/chat-global", wrap("GET", handleChatGlobalGet));
    // Per-project chat (optional — kept for projects that want isolated
    // conversations). Save must be registered before the catch-all GET.
    server.middlewares.use("/api/chat-history/save", wrap("POST", handleChatHistorySave));
    server.middlewares.use("/api/chat-history/", wrap("GET", handleChatHistoryGet));
    server.middlewares.use("/api/timeline/watch/", wrap("GET", handleTimelineWatch));
    server.middlewares.use("/api/assets/list", wrap("GET", handleAssetsList));
    server.middlewares.use("/api/assets/thumb", wrap("GET", handleAssetThumb));
    server.middlewares.use("/api/assets/upload", wrap("POST", handleAssetsUpload));
    server.middlewares.use("/api/assets/delete", wrap("POST", handleAssetsDelete));
    server.middlewares.use("/api/assets/ensure/", wrap("POST", handleAssetsEnsure));
    server.middlewares.use("/api/assets/enrich/", wrap("POST", handleAssetsEnrich));
    server.middlewares.use("/api/assets/reconcile/", wrap("POST", handleAssetsReconcile));
    server.middlewares.use("/api/assets/registry/", wrap("GET", handleAssetsRegistryGet));
    server.middlewares.use("/api/assets/registry/", wrap("POST", handleAssetsRegistryPost));
    server.middlewares.use("/api/timeline/", wrap("GET", handleTimelineGet));
    server.middlewares.use("/api/storyboard/save", wrap("POST", handleStoryboardSave));
    server.middlewares.use("/api/storyboard/", wrap("GET", handleStoryboardGet));
    server.middlewares.use("/api/events/watch/", wrap("GET", handleEventsWatch));
    server.middlewares.use("/api/events/", wrap("GET", handleEventsGet));
    server.middlewares.use("/api/events/", wrap("POST", handleEventsSave));
    server.middlewares.use("/api/current-project", wrap("GET", handleCurrentGet));
    server.middlewares.use("/api/current-project", wrap("POST", handleCurrentSave));
    server.middlewares.use("/__open-in-editor", wrap("POST", handleOpenInEditor));
  },
});
