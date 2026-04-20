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
  resolveProjectsDir,
  syncStaticProjectsSymlink,
} from "../scripts/cli/paths";
import { parseEventsFile, serializeEventsFile } from "./src/utils/eventsFile";

const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "out");
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
    let parsed: any;
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

const STEM_RE = /^[a-z0-9_-]+$/i;

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
  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
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
          : ext === ".json"
            ? "application/json"
            : ext === ".png"
              ? "image/png"
              : ext === ".jpg" || ext === ".jpeg"
                ? "image/jpeg"
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
  await fs.writeFile(CURRENT_PROJECT_FILE, `${stem}\n`);
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
  let parsed;
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
  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
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
    let parsed: any = null;
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

const handleChat = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readJsonBody(req);
  const message: string = String(body?.message ?? "").slice(0, 4000);
  const state = body?.state ?? {};
  if (!message) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "body.message required" }));
    return;
  }

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
  )}\n\nUser request:\n${message}\n\nInvestigate with tools as needed, then end with the <final>{...}</final> block.`;

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
  let m: RegExpExecArray | null;
  while ((m = finalRe.exec(stdout)) !== null) lastFinal = m[1];
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
  )}${historyBlock}\n\nUser request:\n${message}\n\nInvestigate with tools as needed, then end with the <final>{...}</final> block.`;

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
      let m: RegExpExecArray | null;
      while ((m = finalRe.exec(result)) !== null) lastFinal = m[1];
      const primary = lastFinal !== null ? tryParse(lastFinal) : null;
      const payload = primary ??
        tryParse(result) ?? { reply: result.trim() || "(no output)", mutations: [] };
      send({ type: "done", reply: payload.reply, mutations: payload.mutations });
    }
    // other types (system, rate_limit_event, thinking) are dropped client-side
  };

  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
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
    server.middlewares.use("/api/timeline/watch/", wrap("GET", handleTimelineWatch));
    server.middlewares.use("/api/timeline/", wrap("GET", handleTimelineGet));
    server.middlewares.use("/api/storyboard/save", wrap("POST", handleStoryboardSave));
    server.middlewares.use("/api/storyboard/", wrap("GET", handleStoryboardGet));
    server.middlewares.use("/api/events/", wrap("GET", handleEventsGet));
    server.middlewares.use("/api/events/", wrap("POST", handleEventsSave));
    server.middlewares.use("/api/current-project", wrap("GET", handleCurrentGet));
    server.middlewares.use("/api/current-project", wrap("POST", handleCurrentSave));
    server.middlewares.use("/__open-in-editor", wrap("POST", handleOpenInEditor));
  },
});
