#!/usr/bin/env tsx
// scripts/cli/mv-analyze.ts
//
// Kicks off the waveform-analysis workflow for a project. Does Setup
// automatically (runs energy-bands.py + plot-pioneer.py to produce
// analysis.json + full.png), then prints the master-prompt text with
// paths substituted in so you can paste it into a fresh `claude` session
// to run Phases 1 and 2 (the multi-agent visual review steps that need
// Task-tool access).
//
// Why not one-shot automate everything? The master prompt's Phases 1
// and 2 spawn fresh subagents with per-zoom images and require full
// Task/Bash/Read tool access. `claude -p` is non-interactive and
// doesn't spawn subagents in the same way. So Setup runs here, and the
// prompt text is printed with all `<AUDIO_STEM>` / `<OUT_DIR>` /
// `<AUDIO_PATH>` placeholders resolved — paste into a live Claude Code
// session (or your editor's chat pane) to kick off Phase 1.
//
// Usage:
//   npm run mv:analyze -- --project love-in-traffic
//   npm run mv:analyze -- --project love-in-traffic --setup-only
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "..", "..");

type Args = { project?: string; setupOnly?: boolean };

const parseArgs = (): Args => {
  const a: Args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const tok = process.argv[i];
    const next = process.argv[i + 1];
    if (tok === "--project" && next) { a.project = next; i++; }
    else if (tok === "--setup-only") a.setupOnly = true;
  }
  return a;
};

const args = parseArgs();
if (!args.project) {
  console.error("usage: mv:analyze --project <stem> [--setup-only]");
  console.error("       tip: use `npm run --silent mv:current` to auto-fill --project");
  process.exit(1);
}

const stem = args.project;
const projectDir = resolve(repoRoot, "projects", stem);
const audioPath = resolve(projectDir, "audio.mp3");
if (!existsSync(audioPath)) {
  console.error(`missing audio: projects/${stem}/audio.mp3`);
  console.error(`run mv:scaffold first to create the project`);
  process.exit(1);
}

const analysisDir = resolve(projectDir, "analysis");
const analysisJson = resolve(analysisDir, "source.json");
const fullPng = resolve(analysisDir, "full.png");

// ---- Setup: Steps 1-3 of the master prompt ----
console.log(`[mv:analyze] running Setup for ${stem}`);
console.log(`  step 1/2: energy-bands.py -> projects/${stem}/analysis/source.json`);

const r1 = spawnSync(
  "python3",
  [
    resolve(repoRoot, "scripts/energy-bands.py"),
    "--audio", audioPath,
    "--out", analysisJson,
  ],
  { stdio: "inherit", cwd: repoRoot },
);
if (r1.status !== 0) {
  console.error("[mv:analyze] energy-bands.py failed");
  process.exit(r1.status ?? 1);
}

console.log(`  step 2/2: plot-pioneer.py -> projects/${stem}/analysis/full.png`);
const r2 = spawnSync(
  "python3",
  [
    resolve(repoRoot, "scripts/plot-pioneer.py"),
    "--audio", audioPath,
    "--beats", analysisJson,
    "--out", fullPng,
    "--hide-events",
  ],
  { stdio: "inherit", cwd: repoRoot },
);
if (r2.status !== 0) {
  console.error("[mv:analyze] plot-pioneer.py failed");
  process.exit(r2.status ?? 1);
}

console.log(`[mv:analyze] Setup complete:`);
console.log(`  projects/${stem}/analysis/source.json`);
console.log(`  projects/${stem}/analysis/full.png`);

if (args.setupOnly) {
  console.log("");
  console.log("--setup-only passed; stopping before Phase 1.");
  process.exit(0);
}

// ---- Phase 1 + 2: print the master prompt with placeholders resolved ----
const promptFile = resolve(repoRoot, "docs/waveform-analysis-protocol.md");
if (!existsSync(promptFile)) {
  console.error(`master prompt not found at docs/waveform-analysis-protocol.md`);
  process.exit(1);
}

const raw = readFileSync(promptFile, "utf8");
// Extract the ```text fenced block that contains the prompt
const match = raw.match(/```text\n([\s\S]+?)```/);
if (!match) {
  console.error("could not extract prompt block (no ```text fence) from docs/waveform-analysis-protocol.md");
  process.exit(1);
}
let prompt = match[1];

// Simple placeholder substitution. The prompt uses `<audio-stem>` in
// example filenames; those remain as documentation (showing the pattern).
// We only substitute the three real placeholders at the top:
//   <AUDIO_PATH>, <AUDIO_STEM>, <OUT_DIR>
prompt = prompt
  .replace(/<AUDIO_PATH>/g, audioPath)
  .replace(/<AUDIO_STEM>/g, stem)
  .replace(/<OUT_DIR>/g, analysisDir);

console.log("");
console.log("=".repeat(78));
console.log("[mv:analyze] Phases 1-2 require a live Claude session.");
console.log("Paste the prompt below into a fresh `claude` session or the editor's");
console.log("chat pane. The subagent fan-out needs Task/Read/Bash tool access.");
console.log("=".repeat(78));
console.log("");
console.log(prompt);
