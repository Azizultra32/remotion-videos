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
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "out");

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
  const outPath = path.join(OUT_DIR, `${name}.mp4`);

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  sendSseEvent(res, "start", { outPath });

  const args = [
    "remotion",
    "render",
    "src/index.ts",
    "MusicVideo",
    outPath,
    `--props=${JSON.stringify(props)}`,
  ];
  const child = spawn("npx", args, { cwd: REPO_ROOT });

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
    sendSseEvent(res, "done", { code, outPath, ok: code === 0 });
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

  const child = spawn("claude", args, { cwd: REPO_ROOT });
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
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Connect.NextHandleFunction =>
  (req, res, next) => {
    if (req.method !== "POST") {
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
    server.middlewares.use("/api/render", wrap(handleRender));
    server.middlewares.use("/api/chat", wrap(handleChat));
  },
});
