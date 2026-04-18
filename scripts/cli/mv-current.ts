#!/usr/bin/env tsx
// scripts/cli/mv-current.ts
//
// Prints the active project stem from .current-project at the repo root.
// Written by the editor whenever SongPicker selects a track. Lets external
// Claude Code sessions (or shell one-liners) learn which project the user
// is working on without needing browser state.
//
// Exit codes:
//   0  success, stem printed to stdout
//   1  .current-project missing or empty (no active project yet)
//
// Usage:
//   npm run mv:current
//   $(npm run --silent mv:current)   # capture the stem in a shell var
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "..", "..");
const file = resolve(repoRoot, ".current-project");

try {
  const stem = readFileSync(file, "utf8").trim();
  if (!stem) {
    console.error("no active project (.current-project is empty)");
    process.exit(1);
  }
  process.stdout.write(stem + "\n");
} catch {
  console.error("no active project (.current-project not found)");
  console.error("Open the editor and pick a track to set this file.");
  process.exit(1);
}
