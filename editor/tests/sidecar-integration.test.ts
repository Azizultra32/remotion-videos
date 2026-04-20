// editor/tests/sidecar-integration.test.ts
//
// Integration test for the vite sidecar HTTP surface. Spawns vite as a
// subprocess against a throwaway MV_PROJECTS_DIR, hits the real endpoints
// with fetch(), asserts the on-disk side effects. Closes the gap from the
// audit: before this, every test was a pure-function unit test; zero
// coverage on /api/analyze/*, /api/timeline/*, /api/songs, etc. — the
// most-changed code path this session.
//
// Scope is intentionally narrow — one representative smoke for each of
// the critical ops. The goal is proving the pattern + catching
// regressions on the handlers we hardened (clear, events/update, songs,
// reconcile-on-boot). Exhaustive coverage is out of scope; add more
// cases as specific bugs surface.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const editorRoot = resolve(__dirname, "..");
const PORT = 4521; // off the user's primary :4000

let viteProc: ChildProcessWithoutNullStreams | null = null;
let tmpProjects = "";
const STEM = "integ-test-track";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const waitForPort = async (port: number, timeoutMs = 25_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${port}/`);
      if (r.ok || r.status === 404) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error(`vite did not bind :${port} within ${timeoutMs}ms`);
};

beforeAll(async () => {
  tmpProjects = mkdtempSync(join(tmpdir(), "mv-integ-"));
  // Seed a minimal project so /api/songs has something to enumerate.
  const projectDir = join(tmpProjects, STEM);
  mkdirSync(join(projectDir, "analysis"), { recursive: true });
  writeFileSync(join(projectDir, "audio.mp3"), Buffer.alloc(16, 0)); // tiny placeholder
  writeFileSync(
    join(projectDir, "analysis.json"),
    JSON.stringify(
      {
        source_audio: "stub",
        duration_sec: 60,
        beats: [0, 0.5, 1.0, 1.5, 2.0],
        downbeats: [0, 2.0],
        bpm_global: 120,
        energy_bands: { low: [], mid: [], high: [] },
        phase1_events_sec: [10, 20, 30],
        phase2_events_sec: [10, 20, 30],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(projectDir, "timeline.json"),
    JSON.stringify(
      { version: 1, stem: STEM, fps: 24, compositionDuration: 60, elements: [] },
      null,
      2,
    ),
  );
  // Stale orphan status file: should get reconciled at sidecar boot.
  writeFileSync(
    join(projectDir, ".analyze-status.json"),
    JSON.stringify(
      {
        startedAt: Date.now() - 600_000,
        phase: "phase1-review",
        stage: null,
        updatedAt: Date.now() - 600_000,
        endedAt: null,
      },
      null,
      2,
    ),
  );

  viteProc = spawn("npx", ["vite", "--port", String(PORT)], {
    cwd: editorRoot,
    env: {
      ...process.env,
      MV_PROJECTS_DIR: tmpProjects,
      CLAUDE_BIN: resolve(editorRoot, "tests/fixtures/claude-stub.sh"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  // Drain streams so vite's buffers don't block on a full pipe.
  viteProc.stdout.on("data", () => {});
  viteProc.stderr.on("data", () => {});
  await waitForPort(PORT);
}, 30_000);

afterAll(async () => {
  if (viteProc && !viteProc.killed) {
    viteProc.kill("SIGTERM");
    // Give vite 2s to shut down gracefully, then SIGKILL if still alive.
    await sleep(1500);
    if (!viteProc.killed) viteProc.kill("SIGKILL");
  }
  if (tmpProjects && existsSync(tmpProjects)) {
    rmSync(tmpProjects, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe("sidecar integration", () => {
  it("GET /api/songs lists stems from MV_PROJECTS_DIR", async () => {
    const r = await fetch(`http://localhost:${PORT}/api/songs`);
    expect(r.ok).toBe(true);
    const data = (await r.json()) as Array<{ stem: string }>;
    expect(data.some((s) => s.stem === STEM)).toBe(true);
  });

  it("orphan .analyze-status.json is reconciled on boot", async () => {
    // By the time vite is serving, the boot hook has already run.
    const raw = readFileSync(join(tmpProjects, STEM, ".analyze-status.json"), "utf8");
    const status = JSON.parse(raw);
    expect(status.phase).toBe("orphaned-at-boot");
    expect(status.endedAt).not.toBeNull();
  });

  it("POST /api/analyze/clear wipes events, preserves beats", async () => {
    const r = await fetch(`http://localhost:${PORT}/api/analyze/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stem: STEM }),
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`clear failed: ${r.status} ${txt}`);
    }
    const body = (await r.json()) as { cleared: boolean };
    expect(body.cleared).toBe(true);

    const raw = readFileSync(join(tmpProjects, STEM, "analysis.json"), "utf8");
    const data = JSON.parse(raw);
    expect(data.phase1_events_sec).toEqual([]);
    expect(data.phase2_events_sec).toEqual([]);
    // Beats + duration survive (the pre-fix bug nuked these).
    expect(data.beats).toEqual([0, 0.5, 1.0, 1.5, 2.0]);
    expect(data.duration_sec).toBe(60);
    expect(data.bpm_global).toBe(120);
  });

  it("POST /api/analyze/events/update writes new events list", async () => {
    const r = await fetch(`http://localhost:${PORT}/api/analyze/events/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stem: STEM, events: [5.0, 15.5, 42.7] }),
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`events/update failed: ${r.status} ${txt}`);
    }
    const body = (await r.json()) as { events: number[] };
    // Endpoint dedupes within 50 ms and sorts ascending — already
    // sorted + spaced here, so round-trip is identity.
    expect(body.events).toEqual([5.0, 15.5, 42.7]);

    const raw = readFileSync(join(tmpProjects, STEM, "analysis.json"), "utf8");
    const data = JSON.parse(raw);
    expect(data.phase2_events_sec).toEqual([5.0, 15.5, 42.7]);
  });

  it("GET /api/analyze/runs lists snapshots newest-first", async () => {
    // Trigger a snapshot by calling clear (which snapshots before wiping).
    // The first clear in the earlier test already triggered one; listing
    // should now return >= 1 run.
    const r = await fetch(`http://localhost:${PORT}/api/analyze/runs/${STEM}`);
    expect(r.ok).toBe(true);
    const data = (await r.json()) as { runs: Array<{ id: string; events: number }> };
    expect(data.runs.length).toBeGreaterThan(0);
    // The first snapshot should capture the PRE-CLEAR events (3 phase2).
    const firstSnapshot = data.runs[data.runs.length - 1]; // oldest
    expect(firstSnapshot.events).toBe(3);
  });

  it("POST /api/analyze/runs/:stem/restore round-trips events", async () => {
    // Get the list again and pick the oldest snapshot (3 events, pre-clear).
    const list = await (await fetch(`http://localhost:${PORT}/api/analyze/runs/${STEM}`)).json();
    const oldest = list.runs[list.runs.length - 1];

    const r = await fetch(`http://localhost:${PORT}/api/analyze/runs/${STEM}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: oldest.id }),
    });
    expect(r.ok).toBe(true);
    const body = (await r.json()) as { restored: string; phase2: number };
    expect(body.restored).toBe(oldest.id);
    // Restored snapshot had phase2: 3 (pre-clear state).
    expect(body.phase2).toBe(3);

    // analysis.json should now have the restored events.
    const raw = readFileSync(join(tmpProjects, STEM, "analysis.json"), "utf8");
    const data = JSON.parse(raw);
    expect(data.phase2_events_sec.length).toBe(3);
  });

  it("POST /api/chat parses the stub's <final> block into reply + mutations", {
    timeout: 15_000,
  }, async () => {
    const r = await fetch(`http://localhost:${PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "seek to 12.5",
        state: {
          currentTimeSec: 0,
          compositionDuration: 60,
          fps: 24,
          audioSrc: null,
          beatsSrc: null,
          elements: [],
        },
      }),
    });
    expect(r.ok).toBe(true);
    const body = (await r.json()) as {
      reply: string;
      mutations: Array<{ op: string; sec: number }>;
    };
    expect(body.reply).toBe("stub ack");
    expect(body.mutations).toEqual([{ op: "seekTo", sec: 12.5 }]);
  });

  it("GET /api/current-project returns 404 for a stem missing under MV_PROJECTS_DIR", async () => {
    const { writeFileSync: wfs, readFileSync: rfs, existsSync: ex } = await import("node:fs");
    const cpFile = resolve(editorRoot, "..", ".current-project");
    const backup = ex(cpFile) ? rfs(cpFile, "utf8") : null;
    wfs(cpFile, "stem-that-does-not-exist\n");
    try {
      const r = await fetch(`http://localhost:${PORT}/api/current-project`);
      expect(r.status).toBe(404);
      const body = await r.json();
      expect(body.stale).toBe("stem-that-does-not-exist");
    } finally {
      if (backup !== null) wfs(cpFile, backup);
    }
  });

  it("rejects malformed stems with 400", async () => {
    const r = await fetch(`http://localhost:${PORT}/api/analyze/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stem: "../evil" }),
    });
    expect(r.status).toBe(400);
  });
});
