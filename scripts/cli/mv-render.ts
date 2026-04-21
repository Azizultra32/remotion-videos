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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  generateCustomElementsBarrel,
  resetCustomElementsBarrel,
} from "./custom-elements-barrel";
import { resolveProjectDir, resolveProjectsDir } from "./paths";

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
  // Breadcrumbs: show the user how to recover. Available stems + the
  // MV_PROJECTS_DIR resolution so a typo or unset-env mistake surfaces
  // immediately instead of at bundle time.
  try {
    const projectsDir = resolveProjectsDir(repoRoot);
    const stems = readdirSync(projectsDir).filter(
      (d) => !d.startsWith(".") && !d.startsWith("_"),
    );
    if (stems.length > 0) {
      console.error(`  available stems in ${projectsDir}:`);
      for (const s of stems) console.error(`    - ${s}`);
    } else {
      console.error(`  no projects under ${projectsDir}.`);
      console.error(`  run: npm run mv:scaffold -- --audio <path/to/track.mp3>`);
    }
    if (process.env.MV_PROJECTS_DIR) {
      console.error(`  MV_PROJECTS_DIR=${process.env.MV_PROJECTS_DIR}`);
    } else {
      console.error(`  (MV_PROJECTS_DIR not set — using default <repo>/projects/)`);
    }
  } catch {
    // listdir can legitimately fail (projects dir missing) — the primary
    // error message is enough in that case.
  }
  process.exit(1);
}

// Parallel-render lockfile. Two concurrent `mv:render` runs clobber the
// same barrel file (src/compositions/elements/_generated-custom-elements.ts)
// mid-flight — one render's Webpack bundle would import the other's
// project modules. Stale-aware: if the lock exists but its PID is dead,
// reclaim it. Removed in safeReset() alongside the barrel reset.
const LOCK_FILE = resolve(repoRoot, ".mv-render.lock");
const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};
// Atomic create-or-fail via O_EXCL (`flag: "wx"`). Two processes racing
// the existsSync→readFileSync→writeFileSync sequence could both see no
// lock and write sequentially — the later writer would silently win and
// both renders would proceed. Using "wx" means only one process ever
// succeeds on the create; the others hit EEXIST and fall into the
// stale-check branch. TOCTOU-safe.
const tryAcquireLock = (): boolean => {
  try {
    writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
};

if (!tryAcquireLock()) {
  // Existing lock: inspect and either refuse or reclaim.
  const raw = (() => {
    try { return readFileSync(LOCK_FILE, "utf8").trim(); } catch { return ""; }
  })();
  const otherPid = Number.parseInt(raw, 10);
  if (Number.isFinite(otherPid) && isPidAlive(otherPid)) {
    console.error(
      `mv:render already running (PID ${otherPid}, lock at ${LOCK_FILE}). Refusing to race — the barrel file would clobber mid-bundle.`,
    );
    console.error("  If you're sure no other render is running, remove the lock manually.");
    process.exit(1);
  }
  // Stale lock from a crashed prior run; reclaim via unlink + retry.
  // If another process reclaims simultaneously, one of us loses the wx
  // race below and refuses — that's acceptable: user retries.
  console.warn(`[mv:render] reclaiming stale lock (PID ${raw || "?"} not alive)`);
  try { unlinkSync(LOCK_FILE); } catch { /* simultaneous reclaim; fall through */ }
  if (!tryAcquireLock()) {
    console.error(`[mv:render] lost race reclaiming stale lock; try again.`);
    process.exit(1);
  }
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

// Generate the per-project custom-elements barrel BEFORE bundling so
// Webpack picks up the project's *.tsx. Reset on exit (success OR
// failure) so the source tree doesn't drift between renders.
const customElementsResult = generateCustomElementsBarrel(repoRoot, projectDir);
if (customElementsResult.moduleCount > 0) {
  console.log(
    `  custom-elements: ${customElementsResult.moduleCount} (${customElementsResult.files.join(", ")})`,
  );
}

// Belt-and-braces: child.on("close") only fires on graceful exit. SIGTERM
// (kill from CI), SIGINT (Ctrl+C), and uncaught throws skip the close
// callback and would leave the barrel populated → next render imports
// stale modules and the working tree is dirty until someone notices.
// These handlers reset the barrel before forwarding the original signal.
let barrelResetDone = false;
const safeReset = () => {
  if (barrelResetDone) return;
  barrelResetDone = true;
  try {
    resetCustomElementsBarrel(repoRoot);
  } catch {
    // Reset is best-effort during a kill; don't mask the original signal.
  }
  try {
    if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
  } catch {
    // Lock removal best-effort; stale-aware reclaim on next run.
  }
};
process.on("SIGINT", () => {
  safeReset();
  process.exit(130);
});
process.on("SIGTERM", () => {
  safeReset();
  process.exit(143);
});
process.on("uncaughtException", (err) => {
  safeReset();
  console.error("[mv:render] uncaught:", err);
  process.exit(1);
});

if (args.dryRun) {
  console.log("--dry-run: would spawn:");
  console.log(`  cwd: ${repoRoot}`);
  console.log(`  cmd: npx ${spawnArgs.join(" ")}`);
  console.log(
    '  tip: if remotion errors with "No composition with the ID <name> found", run `npx remotion compositions src/index.ts` for the registered list.',
  );
  safeReset();
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
      // Atomic write via tmp + rename. The lockfile only protects against
      // SAME-process races; two renders on different projects can both
      // reach this append simultaneously. Without atomic rename, the
      // later writer's read sees the prior content (missing the earlier
      // writer's just-appended entry) and clobbers it. tmp + rename keeps
      // each writer's payload whole even if they race; the loser's entry
      // is the one missing from the manifest, but the file itself is
      // never corrupt.
      const tmpManifestPath = `${manifestPath}.tmp.${process.pid}`;
      writeFileSync(tmpManifestPath, `${JSON.stringify(prior, null, 2)}\n`);
      renameSync(tmpManifestPath, manifestPath);
      console.log(`[mv:render] manifest updated: ${manifestPath}`);
    } catch (err) {
      console.warn("[mv:render] failed to update manifest:", err);
    }
  }
  // Reset the barrel on BOTH success and failure so the source tree never
  // drifts between renders. If we crashed mid-render, the next render (or
  // the editor) would otherwise import stale project modules by path.
  safeReset();
  process.exit(code ?? 1);
});
