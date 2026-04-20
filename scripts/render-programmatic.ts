/**
 * Programmatic batch renderer for Remotion compositions.
 *
 * Usage:
 *   npx tsx scripts/render-programmatic.ts [options]
 *
 * Options:
 *   --compositions <id,id,...>   Comma-separated composition IDs to render
 *   --jobs <path>                Path to a JSON file describing render jobs
 *   --concurrency <n>            Max concurrent renders (default: 2)
 *   --codec <codec>              Video codec (default: h264)
 *   --crf <number>               CRF quality value (default: 23)
 *   --out <dir>                  Output directory (default: out)
 *
 * Jobs JSON format:
 *   [
 *     { "compositionId": "MyComp", "props": { "title": "Hello" }, "outputFile": "custom.mp4" },
 *     { "compositionId": "OtherComp" }
 *   ]
 */

import { bundle } from "@remotion/bundler";
import { getCompositions, type RenderMediaOnProgress, renderMedia } from "@remotion/renderer";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface RenderJob {
  compositionId: string;
  props?: Record<string, unknown>;
  outputFile?: string;
}

interface CliOptions {
  compositions: string[];
  jobsFile: string | null;
  concurrency: number;
  codec: "h264" | "h265" | "vp8" | "vp9";
  crf: number;
  outDir: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    compositions: [],
    jobsFile: null,
    concurrency: 2,
    codec: "h264",
    crf: 23,
    outDir: "out",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--compositions":
        opts.compositions = args[++i].split(",").map((s) => s.trim());
        break;
      case "--jobs":
        opts.jobsFile = args[++i];
        break;
      case "--concurrency":
        opts.concurrency = parseInt(args[++i], 10);
        break;
      case "--codec":
        opts.codec = args[++i] as CliOptions["codec"];
        break;
      case "--crf":
        opts.crf = parseInt(args[++i], 10);
        break;
      case "--out":
        opts.outDir = args[++i];
        break;
      default:
        console.warn(`Unknown argument: ${args[i]}`);
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Progress reporter
// ---------------------------------------------------------------------------

function makeProgressHandler(label: string): RenderMediaOnProgress {
  let lastPercent = -1;
  return ({ progress }) => {
    const percent = Math.floor(progress * 100);
    if (percent !== lastPercent && percent % 10 === 0) {
      lastPercent = percent;
      console.log(`  [${label}] ${percent}%`);
    }
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const entryPoint = path.resolve(__dirname, "..", "src", "index.ts");

  // 1. Bundle once
  console.log("Bundling project...");
  const bundleLocation = await bundle({
    entryPoint,
    onProgress: (pct) => {
      if (Math.floor(pct * 100) % 25 === 0) {
        process.stdout.write(`\r  Bundle: ${Math.floor(pct * 100)}%`);
      }
    },
  });
  console.log("\n  Bundle complete.");

  // 2. Resolve compositions from bundle
  const allCompositions = await getCompositions(bundleLocation);
  const compositionMap = new Map(allCompositions.map((c) => [c.id, c]));

  // 3. Build the job list
  let jobs: RenderJob[] = [];

  if (opts.jobsFile) {
    const raw = fs.readFileSync(path.resolve(opts.jobsFile), "utf-8");
    jobs = JSON.parse(raw) as RenderJob[];
  } else if (opts.compositions.length > 0) {
    jobs = opts.compositions.map((id) => ({ compositionId: id }));
  } else {
    // Render everything
    jobs = allCompositions.map((c) => ({ compositionId: c.id }));
  }

  // Validate
  for (const job of jobs) {
    if (!compositionMap.has(job.compositionId)) {
      console.error(
        `Composition "${job.compositionId}" not found. Available: ${allCompositions.map((c) => c.id).join(", ")}`,
      );
      process.exit(1);
    }
  }

  // Ensure output directory
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(
    `\nRendering ${jobs.length} composition(s) with concurrency ${opts.concurrency}...\n`,
  );

  // 4. Render with concurrency control
  const results: { job: RenderJob; ok: boolean; error?: string }[] = [];
  let idx = 0;

  async function runNext(): Promise<void> {
    while (idx < jobs.length) {
      const current = idx++;
      const job = jobs[current];
      const composition = compositionMap.get(job.compositionId)!;
      const outputFile = path.join(outDir, job.outputFile ?? `${job.compositionId}.mp4`);

      console.log(
        `Starting [${current + 1}/${jobs.length}]: ${job.compositionId} -> ${outputFile}`,
      );

      try {
        await renderMedia({
          composition,
          serveUrl: bundleLocation,
          codec: opts.codec,
          crf: opts.crf,
          outputLocation: outputFile,
          inputProps: job.props ?? {},
          onProgress: makeProgressHandler(job.compositionId),
        });
        results.push({ job, ok: true });
        console.log(`  Done: ${job.compositionId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ job, ok: false, error: msg });
        console.error(`  FAILED: ${job.compositionId} - ${msg}`);
      }
    }
  }

  // Launch concurrent workers
  const workers: Promise<void>[] = [];
  for (let w = 0; w < opts.concurrency; w++) {
    workers.push(runNext());
  }
  await Promise.all(workers);

  // 5. Summary
  console.log("\n=== Render Summary ===");
  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  for (const r of succeeded) {
    const outFile = path.join(outDir, r.job.outputFile ?? `${r.job.compositionId}.mp4`);
    const stat = fs.statSync(outFile);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`  OK   ${r.job.compositionId} (${sizeMB} MB)`);
  }
  for (const r of failed) {
    console.log(`  FAIL ${r.job.compositionId}: ${r.error}`);
  }

  console.log(
    `\n${succeeded.length} succeeded, ${failed.length} failed out of ${jobs.length} total.`,
  );

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
