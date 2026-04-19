#!/usr/bin/env tsx
// scripts/cli/mv-render.ts
//
// CLI equivalent of the editor's Render button. Reads timeline.json and audio
// from projects/<stem>/, builds MusicVideo props, spawns `npx remotion render`.
// Output: out/<stem>-<timestamp>.mp4 (or --out path).
//
// Same engine as the GUI path — one render pipeline, two drivers. Identical
// output for identical (code + props + audio) per Remotion's determinism.
//
// Usage:
//   npm run mv:render -- --project love-in-traffic
//   npm run mv:render -- --project love-in-traffic --out out/my-cut.mp4
//   npm run mv:render -- --project love-in-traffic --fps 24
//   $(npm run --silent mv:current) | xargs -I {} npm run mv:render -- --project {}
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { resolveProjectDir, resolveProjectsDir, ensureProjectsDir } from "./paths";

const repoRoot = resolve(__dirname, "..", "..");

type Args = { project?: string; out?: string; fps?: number };

const parseArgs = (): Args => {
  const a: Args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const tok = process.argv[i];
    const next = process.argv[i + 1];
    if (tok === "--project" && next) { a.project = next; i++; }
    else if (tok === "--out" && next) { a.out = next; i++; }
    else if (tok === "--fps" && next) { a.fps = Number(next); i++; }
  }
  return a;
};

const args = parseArgs();
if (!args.project) {
  console.error("usage: mv:render --project <stem> [--out path] [--fps N]");
  console.error("       tip: use `npm run --silent mv:current` to auto-fill --project");
  process.exit(1);
}

const stem = args.project;
const projectDir = resolveProjectDir(repoRoot, stem);
if (!existsSync(projectDir)) {
  console.error(`project not found: projects/${stem}/`);
  process.exit(1);
}

const timelinePath = resolve(projectDir, "timeline.json");
const audioPath = resolve(projectDir, "audio.mp3");
if (!existsSync(audioPath)) {
  console.error(`missing audio: projects/${stem}/audio.mp3`);
  process.exit(1);
}

// Read timeline state. If it's missing, render an empty timeline over the
// audio (useful for a quick "does the audio play?" check).
let timeline: { fps?: number; compositionDuration?: number; elements?: unknown[] } = {};
if (existsSync(timelinePath)) {
  try {
    timeline = JSON.parse(readFileSync(timelinePath, "utf8"));
  } catch (err) {
    console.error(`failed to parse projects/${stem}/timeline.json:`, err);
    process.exit(1);
  }
}

const fps = args.fps ?? timeline.fps ?? 24;

const outDir = resolve(repoRoot, "out");
mkdirSync(outDir, { recursive: true });
const outPath = args.out
  ? resolve(args.out)
  : resolve(outDir, `${stem}-${Date.now()}.mp4`);

// These paths are the same form the editor passes — Remotion resolves them
// through staticFile() against public/, and public/projects is symlinked
// to ../projects so projects/<stem>/audio.mp3 is reachable.
const inputProps = {
  audioSrc: `projects/${stem}/audio.mp3`,
  beatsSrc: `projects/${stem}/analysis.json`,
  fps,
  elements: Array.isArray(timeline.elements) ? timeline.elements : [],
};

console.log(`rendering project=${stem} → ${basename(outPath)}`);
console.log(`  audio:    projects/${stem}/audio.mp3`);
console.log(`  analysis: projects/${stem}/analysis.json`);
console.log(`  fps:      ${fps}`);
console.log(`  elements: ${inputProps.elements.length}`);

const args2 = [
  "remotion",
  "render",
  "src/index.ts",
  "MusicVideo",
  outPath,
  `--props=${JSON.stringify(inputProps)}`,
];
const child = spawn("npx", args2, { cwd: repoRoot, stdio: "inherit" });
child.on("close", (code) => process.exit(code ?? 1));
