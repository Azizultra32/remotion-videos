// vite-plugin-sidecar.ts
// Injects two endpoints into the Vite dev server that the editor calls:
//
//   POST /api/render   — spawn `npx remotion render` and stream progress
//   POST /api/chat     — invoke the local `claude` CLI (Max plan) and
//                        parse its JSON mutations into store actions.
//
// Both live in the dev server so we don't need a separate process.
// Lives inside editor/ but shells out from the repo root.
import type { Plugin, ViteDevServer, Connect } from "vite";
import { spawn } from "node:child_process";
import { promises as fs, watch as fsWatch, type FSWatcher } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "out");
const PROJECTS_DIR = path.join(REPO_ROOT, "projects");
const PUBLIC_DIR = path.join(REPO_ROOT, "public"); // kept for legacy engine assets (fonts, etc.)

// Per-stem in-process lock so concurrent /api/timeline/save calls don't
// interleave their writes. Each write waits for the previous one on the
// same stem. Writes across different stems run independently.
const TIMELINE_LOCK = new Map<string, Promise<void>>();

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
  (n || "musicvideo").replace(/[^a-zA-Z0-9_\-]/g, "-").slice(0, 60) ||
  "musicvideo";

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
  audioSrc: string;   // path under projects/, e.g. "projects/love-in-traffic/audio.mp3"
  beatsSrc: string;   // path under projects/, e.g. "projects/love-in-traffic/analysis.json"
  hasBeats: boolean;  // true iff analysis.json exists
  hasTimeline: boolean;
  sizeBytes: number;
};

const handleSongs = async (
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  let projectEntries: Array<{ name: string; isDir: boolean }>;
  try {
    const ds = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    projectEntries = ds.map((d) => ({ name: d.name, isDir: d.isDirectory() }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ error: "failed-to-read-projects", detail: String(err) }),
    );
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

const handleProjectFile = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
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
    ext === ".mp3" ? "audio/mpeg" :
    ext === ".wav" ? "audio/wav" :
    ext === ".m4a" ? "audio/mp4" :
    ext === ".json" ? "application/json" :
    ext === ".png" ? "image/png" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    ext === ".md" ? "text/markdown; charset=utf-8" :
    ext === ".txt" ? "text/plain; charset=utf-8" :
    "application/octet-stream";
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

const handleTimelineGet = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
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
// /api/current-project  (GET + POST — the "which project is active" pointer)
// ---------------------------------------------------------------------------
//
// The editor's SongPicker writes this file on every track switch. It's the
// bridge that lets an external Claude Code session (via `npm run mv:current`)
// know which project the user is working on without needing browser state.
// File is at repo root, gitignored, single-line (just the stem).

const CURRENT_PROJECT_FILE = path.join(REPO_ROOT, ".current-project");

const handleCurrentGet = async (
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  let content: string;
  try {
    content = (await fs.readFile(CURRENT_PROJECT_FILE, "utf8")).trim();
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "no current project" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ stem: content }));
};

const handleCurrentSave = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const body = await readJsonBody(req);
  const stem = String(body?.stem ?? "");
  if (!STEM_RE.test(stem)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "bad stem" }));
    return;
  }
  await fs.writeFile(CURRENT_PROJECT_FILE, stem + "\n");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, stem }));
};

const handleTimelineSave = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
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
    const tmp = dest + ".tmp";
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
// /api/out/:file   (GET — stream a rendered MP4 back to the browser)
// ---------------------------------------------------------------------------
//
// Vite's dev server doesn't publish `out/`. Without this, the editor's
// "Rendered ✓ — click to open" link would need to 404 or prompt the OS
// for a file URL (browsers block those). Streaming through the sidecar
// keeps the link inside the normal http origin. Path traversal is
// defended by rejecting anything that escapes OUT_DIR after resolve.

const handleOut = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
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
    ext === ".mp4" ? "video/mp4" :
    ext === ".webm" ? "video/webm" :
    ext === ".mov" ? "video/quicktime" :
    "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Accept-Ranges", "bytes");
  const { createReadStream } = await import("node:fs");
  createReadStream(full).pipe(res);
};

// ---------------------------------------------------------------------------
// /api/render
// ---------------------------------------------------------------------------

const handleRender = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
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
  { "op": "addElement",    "element": { id, type, trackIndex, startSec, durationSec, label, props } }
  { "op": "updateElement", "id": "<elementId>", "patch": { startSec?, durationSec?, trackIndex?, label?, props? (shallow merge) } }
  { "op": "removeElement", "id": "<elementId>" }
  { "op": "seekTo",        "sec": <number> }
  { "op": "setPlaying",    "playing": <boolean> }

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

Rules:
- Respond with ONLY the JSON object. No prose outside the JSON.
- Generate new element ids as short random strings (e.g. "el-7x3k").
- trackIndex: 0–3 for text, 4 for shapes, 5–6 for overlays, 7 for mask, 8 for video.
- When inserting at a specific beat/drop, use seconds (e.g. drop at 12:12 = 732).
- If you are unsure what the user wants, emit an empty mutations array and explain in reply.
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

const handleTimelineWatch = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
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
    if (keepalive) { clearInterval(keepalive); keepalive = null; }
    if (watcher) { watcher.close(); watcher = null; }
  };
  req.on("close", cleanup);

  // If the client already closed during the 404/stat path, bail now.
  if (req.destroyed) { cleanup(); return; }

  res.write(`event: hello\ndata: ${JSON.stringify({ stem })}\n\n`);

  try {
    watcher = fsWatch(projectDir, { persistent: false }, (eventType, filename) => {
      if (filename !== "timeline.json") return;
      if (eventType !== "change" && eventType !== "rename") return;
      try {
        res.write(
          `event: change\ndata: ${JSON.stringify({ stem, ts: Date.now() })}\n\n`,
        );
      } catch {
        // connection closed; ignore
      }
    });
  } catch (err) {
    // Directory watch failed (unlikely). Surface as a one-off SSE error
    // and hold the connection so the client doesn't reconnect-storm.
    res.write(
      `event: error\ndata: ${JSON.stringify({ stem, detail: String(err) })}\n\n`,
    );
  }

  // SSE keep-alive — some intermediaries close idle connections at 30s.
  keepalive = setInterval(() => {
    try { res.write(":keepalive\n\n"); } catch { /* closed */ }
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

const handleAnalyzeEvents = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
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
    if (keepalive) { clearInterval(keepalive); keepalive = null; }
    if (watcher) { watcher.close(); watcher = null; }
  };
  req.on("close", cleanup);
  if (req.destroyed) { cleanup(); return; }

  await emit(); // initial snapshot

  try {
    watcher = fsWatch(projectDir, { persistent: false }, (eventType, filename) => {
      if (filename !== "analysis.json") return;
      if (eventType !== "change" && eventType !== "rename") return;
      void emit();
    });
  } catch (err) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ stem, detail: String(err) })}\n\n`,
    );
  }

  keepalive = setInterval(() => {
    try { res.write(":keepalive\n\n"); } catch { /* closed */ }
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

const handleAnalyzeStatus = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
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
    if (keepalive) { clearInterval(keepalive); keepalive = null; }
    if (watcher) { watcher.close(); watcher = null; }
  };
  req.on("close", cleanup);
  if (req.destroyed) { cleanup(); return; }

  await emit();

  try {
    watcher = fsWatch(projectDir, { persistent: false }, (eventType, filename) => {
      if (filename !== ".analyze-status.json") return;
      if (eventType !== "change" && eventType !== "rename") return;
      void emit();
    });
  } catch (err) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ stem, detail: String(err) })}\n\n`,
    );
  }

  keepalive = setInterval(() => {
    try { res.write(":keepalive\n\n"); } catch { /* closed */ }
  }, 20000);
};

const handleChat = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
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
  )}\n\nUser request:\n${message}\n\nRespond with the JSON object as specified in your system prompt.`;

  const args = [
    "-p",
    "--output-format",
    "json",
    "--append-system-prompt",
    CHAT_SYSTEM,
    userPrompt,
  ];

  // stdin:"ignore" is load-bearing: without it claude waits 3s for piped
  // stdin, prints a warning, then never emits output in the Vite subprocess
  // context. Closing stdin up-front lets it move straight to the API call.
  const child = spawn("claude", args, {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on("data", (c) => out.push(c));
  child.stderr.on("data", (c) => err.push(c));

  const code: number = await new Promise((resolve) =>
    child.on("close", (c) => resolve(c ?? -1)),
  );
  const stdout = Buffer.concat(out).toString("utf8");
  const stderr = Buffer.concat(err).toString("utf8");

  if (code !== 0) {
    // Detect Max-plan rate limiting so the client can show a cooldown banner
    // instead of a generic error. The CLI surfaces these as non-zero exits
    // with known markers in stderr/stdout.
    const combined = `${stderr}\n${stdout}`.toLowerCase();
    const rateLimited =
      /rate[- ]?limit/.test(combined) ||
      /too many requests/.test(combined) ||
      /429/.test(combined);
    if (rateLimited) {
      // Try to pull "retry in Ns" / "retry after Ns" out of the message.
      const match = combined.match(/retry[^0-9]{0,20}(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes)?/);
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

  // claude -p --output-format json returns { result, session_id, ... }
  let result: string;
  try {
    const parsed = JSON.parse(stdout);
    result = typeof parsed === "string" ? parsed : parsed.result ?? stdout;
  } catch {
    result = stdout;
  }

  // Find the JSON object inside `result` (it may contain prose despite the rule).
  const jsonStart = result.indexOf("{");
  const jsonEnd = result.lastIndexOf("}");
  let payload: { reply: string; mutations: unknown[] } = {
    reply: result,
    mutations: [],
  };
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      payload = JSON.parse(result.slice(jsonStart, jsonEnd + 1));
    } catch {
      // keep payload as fallback above
    }
  }

  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

// ---------------------------------------------------------------------------
// Vite plugin wiring
// ---------------------------------------------------------------------------

const wrap = (
  method: "GET" | "POST",
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Connect.NextHandleFunction =>
  (req, res, next) => {
    // Accept HEAD wherever GET is allowed — browsers preload audio via HEAD
    // and falling through to Vite's SPA fallback would 200 with HTML.
    const ok = method === "GET" ? req.method === "GET" || req.method === "HEAD" : req.method === method;
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
    server.middlewares.use("/api/chat", wrap("POST", handleChat));
    server.middlewares.use("/api/songs", wrap("GET", handleSongs));
    server.middlewares.use("/api/out/", wrap("GET", handleOut));
    server.middlewares.use("/api/projects/", wrap("GET", handleProjectFile));
    server.middlewares.use("/api/analyze/events/", wrap("GET", handleAnalyzeEvents));
    server.middlewares.use("/api/analyze/status/", wrap("GET", handleAnalyzeStatus));
    server.middlewares.use("/api/timeline/save", wrap("POST", handleTimelineSave));
    server.middlewares.use("/api/timeline/watch/", wrap("GET", handleTimelineWatch));
    server.middlewares.use("/api/timeline/", wrap("GET", handleTimelineGet));
    server.middlewares.use("/api/current-project", wrap("GET", handleCurrentGet));
    server.middlewares.use("/api/current-project", wrap("POST", handleCurrentSave));
  },
});
