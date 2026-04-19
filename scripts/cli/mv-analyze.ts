#!/usr/bin/env tsx
// scripts/cli/mv-analyze.ts
//
// Kicks off the waveform-analysis workflow for a project. Does Setup
// automatically (runs energy-bands.py + plot-pioneer.py to produce
// analysis.json + full.png), then spawns `claude -p "<prompt>"` to run
// Phases 1 and 2 (the multi-agent visual review steps) end-to-end.
//
// The child claude process runs the multi-agent workflow autonomously,
// emulating fresh-subagent isolation via per-zoom reads (proven pattern
// from the Task-agent run on as-the-rush-comes).
//
// On child exit 0, copies <OUT_DIR>/<stem>-phase2-events.json to
// projects/<stem>/analysis.json so the editor's Scrubber picks up the
// new events on next refresh. --no-copy opts out.
//
// Usage:
//   npm run mv:analyze -- --project love-in-traffic
//   npm run mv:analyze -- --project love-in-traffic --setup-only
//   npm run mv:analyze -- --project love-in-traffic --no-copy
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "..", "..");

type Args = { project?: string; setupOnly?: boolean; noCopy?: boolean };

const parseArgs = (): Args => {
  const a: Args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const tok = process.argv[i];
    const next = process.argv[i + 1];
    if (tok === "--project" && next) { a.project = next; i++; }
    else if (tok === "--setup-only") a.setupOnly = true;
    else if (tok === "--no-copy") a.noCopy = true;
  }
  return a;
};

const args = parseArgs();
if (!args.project) {
  console.error("usage: mv:analyze --project <stem> [--setup-only] [--no-copy]");
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

// ---- Phase 1 + 2: spawn `claude -p` with placeholder-resolved prompt ----
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

// The master prompt in docs/waveform-analysis-protocol.md is authoritative
// protocol, not a per-run invocation. It contains <audio-stem> as a literal
// illustrative token in filename EXAMPLES — we don't substitute those; they
// stay as documentation. Instead we APPEND a concrete "run now" directive
// with resolved paths + an explicit instruction to proceed autonomously.
// Without this footer, claude -p reads the protocol as a role definition
// and politely asks what track to analyze instead of starting.
prompt = prompt + `

---

## Run-specific parameters for THIS invocation

- Repo root: ${repoRoot}
- AUDIO_PATH = ${audioPath}
- AUDIO_STEM = ${stem}
- OUT_DIR = ${analysisDir}
- MODE = production (complete Phase 1 and Phase 2)

Setup is ALREADY complete — ${stem}-full.png and source.json are at
OUT_DIR/. Do NOT re-run energy-bands.py or plot-pioneer.py --hide-events;
proceed directly to Phase 1 visual review of the unmarked full PNG.

All artifacts MUST land in OUT_DIR with filenames from the Filenames
table in the protocol above. When generating Phase 1 zoom PNGs or
Phase 2 segment slices/zooms, call plot-pioneer.py and
slice-pioneer-png.py (the slicer accepts --stem for compliant names).
Use absolute paths for --audio, --beats, --out, --out-dir.

When dispatching fresh subagents for zoom confirmation, give each one
ONLY the absolute path to its zoom PNG and its [t_start, t_end]
window. Each subagent replies \`confirmed_sec: <float>\`. If Task is
unavailable in this context, emulate isolation by reading each zoom
in its own Read call and treating that reading as the confirmation.

After Phase 2 completes and ${stem}-phase2-events.json is written to
OUT_DIR, the CLI wrapper will copy it to
${projectDir}/analysis.json. No action required from you.

Begin now. Do NOT ask for confirmation or clarification. Proceed
autonomously through Phase 1 then Phase 2.
`;

console.log("");
console.log("[mv:analyze] spawning claude -p (multi-agent Phase 1 + Phase 2; this takes 5-10 min)");

// --permission-mode bypassPermissions lets the child execute Read/Bash/Write
// without per-call approval prompts. Without this, claude -p sits waiting
// on stdin for approvals the CLI has no way to answer.
const child = spawn(
  "claude",
  ["-p", "--permission-mode", "bypassPermissions", prompt],
  { stdio: "inherit", cwd: repoRoot },
);

child.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "ENOENT") {
    console.error("[mv:analyze] claude CLI not installed or not on PATH");
    console.error("install from https://docs.claude.com/en/docs/claude-code");
    process.exit(2);
  }
  console.error(`[mv:analyze] failed to spawn claude: ${err.message}`);
  process.exit(2);
});

child.on("close", (code) => {
  const phase1Full = resolve(analysisDir, `${stem}-phase1-full.png`);
  const phase2Events = resolve(analysisDir, `${stem}-phase2-events.json`);
  const phase2Full = resolve(analysisDir, `${stem}-phase2-confirmed-full.png`);

  if (code !== 0) {
    console.error(`[mv:analyze] claude exited with code ${code}`);
    const gotPhase1 = existsSync(phase1Full);
    const gotPhase2 = existsSync(phase2Events);
    console.error(`  phase1 artifacts present: ${gotPhase1}`);
    console.error(`  phase2 artifacts present: ${gotPhase2}`);
    process.exit(code ?? 1);
  }

  // Success path
  if (args.noCopy) {
    console.log("[mv:analyze] --no-copy passed; skipping analysis.json copy");
  } else if (existsSync(phase2Events)) {
    const dest = resolve(projectDir, "analysis.json");
    try {
      copyFileSync(phase2Events, dest);
      console.log(`[mv:analyze] copied phase2-events -> projects/${stem}/analysis.json`);
    } catch (err) {
      console.warn(`[mv:analyze] warning: failed to copy phase2-events: ${(err as Error).message}`);
    }
  } else {
    console.warn(`[mv:analyze] warning: ${stem}-phase2-events.json not found; skipping analysis.json copy`);
    console.warn("  (run may have been test-mode / Phase 1 only)");
  }

  // Summary
  let eventCount: number | null = null;
  if (existsSync(phase2Events)) {
    try {
      const parsed = JSON.parse(readFileSync(phase2Events, "utf8"));
      if (Array.isArray(parsed)) eventCount = parsed.length;
      else if (Array.isArray(parsed?.events)) eventCount = parsed.events.length;
    } catch {
      /* ignore parse errors in summary */
    }
  }

  console.log("");
  console.log(`[mv:analyze] done`);
  if (eventCount !== null) console.log(`  events: ${eventCount}`);
  if (existsSync(phase2Full)) console.log(`  confirmed-full: ${phase2Full}`);
  process.exit(0);
});
