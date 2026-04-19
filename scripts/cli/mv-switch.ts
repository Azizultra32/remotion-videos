#!/usr/bin/env tsx
// scripts/cli/mv-switch.ts
//
// Set the active project (writes stem to .current-project). External
// Claude Code sessions consult this via `npm run mv:current`; the editor
// also reads it on startup to resume the last-selected track across
// dev-server restarts.
//
// Validates the project exists (projects/<stem>/ must be a directory) so
// downstream consumers don't get handed a stem that will 404.
//
// Usage:
//   npm run mv:switch -- --project <stem>

import { existsSync, statSync, writeFileSync } from "node:fs";
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
  console.error("usage: mv:switch --project <stem>");
  process.exit(1);
}

const stem = args.project;
if (!/^[a-z0-9_-]+$/i.test(stem)) {
  console.error(`invalid stem: "${stem}" (must match /^[a-z0-9_-]+$/i)`);
  process.exit(1);
}

const projectDir = resolveProjectDir(repoRoot, stem);
if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
  console.error(`project not found: projects/${stem}/`);
  console.error(`list available: ls projects/`);
  process.exit(1);
}

const currentFile = resolve(repoRoot, ".current-project");
writeFileSync(currentFile, stem + "\n");
console.log(`[mv:switch] active project -> ${stem}`);
