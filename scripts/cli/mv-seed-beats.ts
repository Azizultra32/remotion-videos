#!/usr/bin/env tsx
// scripts/cli/mv-seed-beats.ts
//
// Fast "just compute beats" capability. Runs librosa beat tracking on a
// project's audio and merges the result into projects/<stem>/analysis.json
// WITHOUT running the full mv:analyze pipeline (energy bands, plot, Phase 1+2).
//
// Use when:
//   - A pre-existing project's analysis.json was produced before beats were
//     part of the pipeline (projects shipped before the ead3c3a fix).
//   - You want to re-compute beats without disturbing existing phase events
//     or energy bands.
//
// Takes ~30-60s on a 5-10 min track. All other fields in analysis.json are
// preserved (merge, not overwrite). Atomic write via tmp + rename.
//
// Usage:
//   npm run mv:seed-beats -- --project <stem>

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "..", "..");

type Args = { project?: string };
const parseArgs = (): Args => {
  const a: Args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const tok = process.argv[i];
    const next = process.argv[i + 1];
    if (tok === "--project" && next) { a.project = next; i++; }
  }
  return a;
};

const args = parseArgs();
if (!args.project) {
  console.error("usage: mv:seed-beats --project <stem>");
  process.exit(1);
}

const stem = args.project;
const projectDir = resolve(repoRoot, "projects", stem);
const audioPath = resolve(projectDir, "audio.mp3");
if (!existsSync(audioPath)) {
  console.error(`missing audio: projects/${stem}/audio.mp3`);
  process.exit(1);
}

const analysisDir = resolve(projectDir, "analysis");
const beatsJson = resolve(analysisDir, "beats.json");

console.log(`[mv:seed-beats] running detect-beats.py for ${stem} (~30-60s)`);
const r = spawnSync(
  "python3",
  [
    resolve(repoRoot, "scripts/detect-beats.py"),
    "--audio", audioPath,
    "--out", beatsJson,
  ],
  { stdio: "inherit", cwd: repoRoot },
);
if (r.status !== 0) {
  console.error("[mv:seed-beats] detect-beats.py failed");
  process.exit(r.status ?? 1);
}

// Merge beats fields into projects/<stem>/analysis.json. Preserve
// everything else — phase events, energy bands, source metadata.
const destAnalysis = resolve(projectDir, "analysis.json");
const beats = JSON.parse(readFileSync(beatsJson, "utf8"));
let existing: Record<string, unknown> = {};
if (existsSync(destAnalysis)) {
  try { existing = JSON.parse(readFileSync(destAnalysis, "utf8")); } catch { /* will overwrite */ }
}
const merged: Record<string, unknown> = {
  ...existing,
  bpm_global: beats.bpm_global,
  beats: beats.beats,
  downbeats: beats.downbeats,
  tempo_curve: beats.tempo_curve,
};
// Fill duration if missing — detect-beats.py produces `duration`; the full
// pipeline uses `duration_sec`. Prefer whichever key already exists.
if (existing.duration_sec == null && existing.duration == null) {
  merged.duration_sec = beats.duration;
}

const tmp = destAnalysis + ".tmp";
writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n");
renameSync(tmp, destAnalysis);

console.log(
  `[mv:seed-beats] merged ${beats.beats.length} beats + ${beats.downbeats.length} downbeats into projects/${stem}/analysis.json`,
);
console.log(`  BPM: ${beats.bpm_global}`);
