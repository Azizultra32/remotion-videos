#!/usr/bin/env tsx
// scripts/cli/mv-project-init-repo.ts
//
// Initialize a per-project git repository inside a track's project
// directory. Designed for the "any project content separately saved and
// potentially available on GitHub" workflow: each track becomes its own
// repo, independently shareable, independently versioned.
//
// The engine repo remains project-data-free (gitignored projects/); each
// project gets its own git history. Users pick which tracks to publish
// publicly vs keep local.
//
// Usage:
//   npm run mv:project-init-repo -- --project <stem>
//   npm run mv:project-init-repo -- --project <stem> --remote <git-url>
//
// Idempotent: if projectDir is already a git repo, prints the current
// remote + branch and exits cleanly. Does NOT commit on your behalf —
// the user runs `git add . && git commit -m "..."` explicitly so they
// pick their own first-commit message.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveProjectDir } from "./paths";

const repoRoot = resolve(__dirname, "..", "..");

type Args = { project?: string; remote?: string };
const args: Args = {};
for (let i = 2; i < process.argv.length; i++) {
  const t = process.argv[i];
  const n = process.argv[i + 1];
  if (t === "--project" && n) {
    args.project = n;
    i++;
  } else if (t === "--remote" && n) {
    args.remote = n;
    i++;
  }
}

if (!args.project) {
  console.error("[mv:project-init-repo] --project <stem> is required");
  process.exit(1);
}

const stem = args.project;
if (!/^[a-z0-9_-]+$/i.test(stem)) {
  console.error(
    `[mv:project-init-repo] invalid stem "${stem}" (must match /^[a-z0-9_-]+$/i)`,
  );
  process.exit(1);
}

const projectDir = resolveProjectDir(repoRoot, stem);
if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
  console.error(`[mv:project-init-repo] project directory not found: ${projectDir}`);
  console.error("  Run `npm run mv:scaffold -- --audio /path/to/track.mp3` first.");
  process.exit(1);
}

const gitDir = resolve(projectDir, ".git");
if (existsSync(gitDir)) {
  // Already initialized — print current state + exit.
  const branch =
    spawnSync("git", ["-C", projectDir, "branch", "--show-current"], {
      encoding: "utf8",
    }).stdout.trim() || "(detached)";
  const remote = spawnSync("git", ["-C", projectDir, "remote", "get-url", "origin"], {
    encoding: "utf8",
  }).stdout.trim();
  console.log(`[mv:project-init-repo] ${stem}: already a git repo`);
  console.log(`  branch: ${branch}`);
  console.log(`  remote: ${remote || "(none set)"}`);
  if (args.remote && !remote) {
    execSync(`git -C "${projectDir}" remote add origin "${args.remote}"`);
    console.log(`  added remote: ${args.remote}`);
  }
  process.exit(0);
}

// Fresh init. Default branch "main" avoids the older "master" default.
execSync(`git -C "${projectDir}" init -b main`, { stdio: "inherit" });

// Per-project .gitignore. Transient files the pipeline creates at runtime
// that shouldn't be versioned.
const gitignore = `# Per-run transient status file — sidecar SSE target, not history.
.analyze-status.json
# mv:analyze / mv:seed-beats stdout log (rotates at 10 MB).
.analyze.log
# macOS metadata.
.DS_Store
`;
writeFileSync(resolve(projectDir, ".gitignore"), gitignore);

// Per-project README so anyone browsing the repo on GitHub gets orientation.
const now = new Date().toISOString().slice(0, 10);
const readme = `# ${stem}

Music-video project. Consumed by the [remotion-videos engine](https://github.com/Azizultra32/remotion-videos).

## Contents

- \`audio.mp3\` — source audio
- \`analysis.json\` — canonical event list (Phase 1 candidate events, Phase 2 confirmed events, beats, downbeats, BPM, energy bands)
- \`timeline.json\` — editor state (elements, fps, composition duration)
- \`analysis/\` — analysis pipeline artifacts (source.json, full.png, phase1/2 PNGs, per-segment zooms, manifest)

## Usage with the engine

\`\`\`bash
# In the engine repo (clone from remotion-videos):
MV_PROJECTS_DIR=/path/to/this/repo/parent-dir npm run dev
\`\`\`

The editor picks up this project automatically as long as the engine can resolve \`<MV_PROJECTS_DIR>/${stem}/\`.

## Initialized

${now} via \`npm run mv:project-init-repo -- --project ${stem}\`.
`;
writeFileSync(resolve(projectDir, "README.md"), readme);

if (args.remote) {
  execSync(`git -C "${projectDir}" remote add origin "${args.remote}"`, {
    stdio: "inherit",
  });
  console.log(`[mv:project-init-repo] remote origin -> ${args.remote}`);
}

console.log(`[mv:project-init-repo] initialized git repo at ${projectDir}`);
console.log("\nNext steps:");
console.log(`  cd "${projectDir}"`);
console.log("  git add .");
console.log(`  git commit -m "initial: ${stem}"`);
if (args.remote) {
  console.log("  git push -u origin main");
} else {
  console.log("  # (set a remote if you want to push to GitHub:)");
  console.log(`  # git remote add origin git@github.com:<you>/${stem}.git`);
  console.log("  # git push -u origin main");
}
