#!/usr/bin/env tsx
// scripts/cli/mv-render.ts
//
// CLI equivalent of the editor's Render button. Reads timeline.json + audio
// from <MV_PROJECTS_DIR>/<stem>/, builds composition props, spawns
// `npx remotion render`. Output: out/<stem>-<timestamp>.mp4 (or --out path).
//
// Also appends to out/.renders.json after a successful render so past
// renders are traceable back to the (timeline, analysis) snapshot that
// produced them. Answers "which inputs made this MP4?" six months later.
//
// Usage:
//   npm run mv:render -- --project love-in-traffic
//   npm run mv:render -- --project love-in-traffic --composition TextOverlay
//   npm run mv:render -- --project love-in-traffic --out out/my-cut.mp4
//   npm run mv:render -- --project love-in-traffic --fps 24
//   npm run mv:render -- --project love-in-traffic --composition Foo --props-file my.json
//   npm run mv:render -- --project love-in-traffic --dry-run    # print cmd, skip spawn
import { spawn } from "node:child_process";
import {
  createHash,
  // keep import shape for node:crypto
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { resolveProjectDir } from "./paths";

const repoRoot = resolve(__dirname, "..", "..");

type Args = {
  project?: string;
  out?: string;
  fps?: number;
  composition?: string;
  propsFile?: string;
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
    } else if (tok === "--out" && next) {
      a.out = next;
      i++;
    } else if (tok === "--fps" && next) {
      a.fps = Number(next);
      i++;
    } else if (tok === "--composition" && next) {
      a.composition = next;
      i++;
    } else if (tok === "--props-file" && next) {
      a.propsFile = next;
      i++;
    } else if (tok === "--dry-run") {
      a.dryRun = true;
    }
  }
  return a;
};

const args = parseArgs();
if (!args.project) {
  console.error(
    "usage: mv:render --project <stem> [--out path] [--fps N] [--composition ID] [--props-file path] [--dry-run]",
  );
  console.error("       tip: use `npm run --silent mv:current` to auto-fill --project");
  process.exit(1);
}

const stem = args.project;
const composition = args.composition ?? "MusicVideo";
const isMusicVideo = composition === "MusicVideo";

const projectDir = resolveProjectDir(repoRoot, stem);
if (!existsSync(projectDir)) {
  console.error(`project not found: ${projectDir}`);
  process.exit(1);
}

const timelinePath = resolve(projectDir, "timeline.json");
const audioPath = resolve(projectDir, "audio.mp3");
const analysisPath = resolve(projectDir, "analysis.json");

// Read timeline state. Only required for MusicVideo rendering — other
// compositions either get defaultProps or the user's --props-file.
let timeline: { fps?: number; compositionDuration?: number; elements?: unknown[] } = {};
if (isMusicVideo) {
  if (!existsSync(audioPath)) {
    console.error(`missing audio: ${audioPath}`);
    process.exit(1);
  }
  if (existsSync(timelinePath)) {
    try {
      timeline = JSON.parse(readFileSync(timelinePath, "utf8"));
    } catch (err) {
      console.error(`failed to parse ${timelinePath}:`, err);
      process.exit(1);
    }
  }
}

const fps = args.fps ?? timeline.fps ?? 24;

const outDir = resolve(repoRoot, "out");
mkdirSync(outDir, { recursive: true });
const outBase = isMusicVideo ? `${stem}-${Date.now()}.mp4` : `${composition}-${Date.now()}.mp4`;
const outPath = args.out ? resolve(args.out) : resolve(outDir, outBase);

// Build props. MusicVideo: from timeline.json. Non-MusicVideo: user-supplied
// --props-file or defaultProps (Remotion falls back when --props not passed).
let inputProps: unknown;
let propsSource = "defaultProps from Root.tsx";
if (isMusicVideo) {
  inputProps = {
    audioSrc: `projects/${stem}/audio.mp3`,
    beatsSrc: `projects/${stem}/analysis.json`,
    fps,
    elements: Array.isArray(timeline.elements) ? timeline.elements : [],
  };
  propsSource = "built from timeline.json";
}
if (args.propsFile) {
  const pf = resolve(args.propsFile);
  if (!existsSync(pf)) {
    console.error(`missing --props-file: ${pf}`);
    process.exit(1);
  }
  try {
    inputProps = JSON.parse(readFileSync(pf, "utf8"));
    propsSource = `from ${args.propsFile}`;
  } catch (err) {
    console.error(`failed to parse ${pf}:`, err);
    process.exit(1);
  }
}

console.log(`rendering composition=${composition} project=${stem} → ${basename(outPath)}`);
if (isMusicVideo) {
  console.log(`  audio:    projects/${stem}/audio.mp3`);
  console.log(`  analysis: projects/${stem}/analysis.json`);
  console.log(`  fps:      ${fps}`);
  console.log(`  elements: ${Array.isArray(timeline.elements) ? timeline.elements.length : 0}`);
}
console.log(`  props:    ${propsSource}`);
if (!isMusicVideo) {
  console.log(
    "  note:     non-MusicVideo renders ignore timeline.json. Pass --props-file <path> for custom props.",
  );
}

const spawnArgs = ["remotion", "render", "src/index.ts", composition, outPath];
if (inputProps !== undefined) {
  spawnArgs.push(`--props=${JSON.stringify(inputProps)}`);
}

if (args.dryRun) {
  console.log("--dry-run: would spawn:");
  console.log(`  cwd: ${repoRoot}`);
  console.log(`  cmd: npx ${spawnArgs.join(" ")}`);
  console.log(
    '  tip: if remotion errors with "No composition with the ID <name> found", run `npx remotion compositions src/index.ts` for the registered list.',
  );
  process.exit(0);
}

// Compute sha256 of the timeline + analysis blobs so the render manifest
// records exactly which input state produced this output. This is THE
// answer to "which JSON made this MP4?" months later.
const sha = (p: string): string | null => {
  if (!existsSync(p)) return null;
  try {
    return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
};

const child = spawn("npx", spawnArgs, { cwd: repoRoot, stdio: "inherit" });
child.on("close", (code) => {
  if (code === 0) {
    // Append to out/.renders.json on success. Ignore write failures — the
    // render itself is what matters; manifest is best-effort telemetry.
    try {
      const manifestPath = resolve(outDir, ".renders.json");
      const prior = existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, "utf8"))
        : { renders: [] };
      const entry = {
        timestamp: new Date().toISOString(),
        composition,
        stem,
        output: outPath,
        fps,
        elementCount: Array.isArray(timeline.elements) ? timeline.elements.length : 0,
        timelineSha: sha(timelinePath),
        analysisSha: sha(analysisPath),
        propsSource,
      };
      prior.renders = [...(prior.renders ?? []), entry];
      // Cap history at 500 entries so the file doesn't grow unbounded.
      if (prior.renders.length > 500) {
        prior.renders = prior.renders.slice(-500);
      }
      writeFileSync(manifestPath, `${JSON.stringify(prior, null, 2)}\n`);
      console.log(`[mv:render] manifest updated: ${manifestPath}`);
    } catch (err) {
      console.warn("[mv:render] failed to update manifest:", err);
    }
  }
  process.exit(code ?? 1);
});
