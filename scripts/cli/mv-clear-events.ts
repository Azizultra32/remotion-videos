#!/usr/bin/env tsx
// scripts/cli/mv-clear-events.ts
//
// Remove Phase 1 + Phase 2 events from a project's analysis.json. Keeps
// beats/downbeats/energy_bands/etc. intact — this is an events-only wipe.
// On-disk artifacts in analysis/ (the PNGs, segment json) are NOT touched.
//
// Mirrors POST /api/analyze/clear from the sidecar.
//
// Usage:
//   npm run mv:clear-events -- --project <stem>
//
// Refuses to run while mv:analyze is in flight (same 409-equivalent as the
// sidecar endpoint) — clearing mid-run would race the pipeline's final
// phase2-events overwrite.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveProjectDir, resolveProjectsDir, ensureProjectsDir } from "./paths";

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
  console.error("usage: mv:clear-events --project <stem>");
  process.exit(1);
}

const stem = args.project;
const projectDir = resolveProjectDir(repoRoot, stem);
const analysisFile = resolve(projectDir, "analysis.json");
const statusFile = resolve(projectDir, ".analyze-status.json");

if (!existsSync(projectDir)) {
  console.error(`project not found: projects/${stem}/`);
  process.exit(1);
}

// Refuse if analysis is running.
if (existsSync(statusFile)) {
  try {
    const st = JSON.parse(readFileSync(statusFile, "utf8"));
    if (st && st.startedAt && !st.endedAt) {
      console.error(`[mv:clear-events] refusing: mv:analyze is running for ${stem}`);
      console.error(`  wait for it to finish (check .analyze-status.json) or kill it first`);
      process.exit(1);
    }
  } catch { /* status file corrupt — proceed; the clear is harmless */ }
}

// Merge, don't overwrite. Preserve everything except the event arrays.
let existing: Record<string, unknown> = {};
if (existsSync(analysisFile)) {
  try {
    existing = JSON.parse(readFileSync(analysisFile, "utf8")) as Record<string, unknown>;
  } catch { /* corrupt/missing — emit a minimal file */ }
}
const merged = {
  ...existing,
  phase1_events_sec: [],
  phase2_events_sec: [],
};

const tmp = analysisFile + ".tmp";
writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n");
renameSync(tmp, analysisFile);

const beatsLen = Array.isArray((existing as Record<string, unknown>).beats)
  ? ((existing as Record<string, unknown>).beats as unknown[]).length
  : 0;
console.log(`[mv:clear-events] cleared phase events in projects/${stem}/analysis.json`);
console.log(`  preserved: ${beatsLen} beats + other fields`);
