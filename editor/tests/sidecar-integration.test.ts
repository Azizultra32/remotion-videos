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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateAssetId, isCanonicalAssetId } from "../src/types/assetRecord";

const __dirname = dirname(fileURLToPath(import.meta.url));
const editorRoot = resolve(__dirname, "..");

let viteProc: ChildProcessWithoutNullStreams | null = null;
let tmpProjects = "";
let tmpEscapes = "";
let port = 0;
const STEM = "integ-test-track";
const COVER_ASSET_PATH = `projects/${STEM}/images/cover.png`;
const ENRICH_IMAGE_ASSET_PATH = `projects/${STEM}/images/probe.png`;
const ENSURE_ASSET_PATH = `projects/${STEM}/videos/scene.mp4`;
const RECONCILE_IMAGE_ASSET_PATH = `projects/${STEM}/images/reconcile-source.png`;
const RECONCILE_RENAMED_ASSET_PATH = `projects/${STEM}/images/reconcile-renamed.png`;
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aMcAAAAASUVORK5CYII=",
  "base64",
);

const registryFileForStem = (stem: string) => join(tmpProjects, stem, "assets.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getAvailablePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  const address = server.address();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((err) => (err ? rejectPromise(err) : resolvePromise()));
  });

  if (!address || typeof address === "string") {
    throw new Error("failed to allocate test port");
  }

  return address.port;
};

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
  tmpEscapes = mkdtempSync(join(tmpdir(), "mv-integ-escape-"));
  port = await getAvailablePort();
  // Seed a minimal project so /api/songs has something to enumerate.
  const projectDir = join(tmpProjects, STEM);
  mkdirSync(join(projectDir, "analysis"), { recursive: true });
  mkdirSync(join(projectDir, "images"), { recursive: true });
  mkdirSync(join(projectDir, "videos"), { recursive: true });
  writeFileSync(join(projectDir, "audio.mp3"), Buffer.alloc(16, 0)); // tiny placeholder
  writeFileSync(join(projectDir, "images", "cover.png"), ONE_BY_ONE_PNG);
  writeFileSync(join(projectDir, "images", "probe.png"), ONE_BY_ONE_PNG);
  writeFileSync(join(projectDir, "images", "reconcile-source.png"), ONE_BY_ONE_PNG);
  writeFileSync(join(projectDir, "videos", "scene.mp4"), Buffer.from("scene-video-bytes"));
  mkdirSync(join(projectDir, "images", "escape"), { recursive: true });
  writeFileSync(join(tmpEscapes, "outside.png"), Buffer.from("outside-bytes"));
  rmSync(join(projectDir, "images", "escape"), { recursive: true, force: true });
  symlinkSync(tmpEscapes, join(projectDir, "images", "escape"), "dir");
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

  viteProc = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
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
  await waitForPort(port);
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
  if (tmpEscapes && existsSync(tmpEscapes)) {
    rmSync(tmpEscapes, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe("sidecar integration", () => {
  it("GET /api/songs lists stems from MV_PROJECTS_DIR", {
    timeout: 15_000,
  }, async () => {
    const r = await fetch(`http://localhost:${port}/api/songs`);
    expect(r.ok).toBe(true);
    const data = (await r.json()) as Array<{ stem: string }>;
    expect(data.some((s) => s.stem === STEM)).toBe(true);
  });

  it("POST /api/assets/registry/:stem rejects malformed payloads without creating assets.json", {
    timeout: 15_000,
  }, async () => {
    const r = await fetch(`http://localhost:${port}/api/assets/registry/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 2 }),
    });

    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "invalid-body" });
    expect(existsSync(registryFileForStem(STEM))).toBe(false);
  });

  it("POST /api/assets/registry/:stem persists a normalized registry that GET returns", {
    timeout: 15_000,
  }, async () => {
    const legacyId = generateAssetId(COVER_ASSET_PATH);
    const payload = {
      version: 1 as const,
      records: [
        {
          id: legacyId,
          path: COVER_ASSET_PATH,
          pathHistory: [COVER_ASSET_PATH, `projects/${STEM}/images/cover-old.png`],
          kind: "image" as const,
          scope: "project" as const,
          stem: STEM,
          sizeBytes: 5,
          mtimeMs: 111,
          createdAt: 222,
          updatedAt: 333,
          metadata: { width: 1280, height: 720 },
          label: "Cover",
        },
      ],
    };

    const post = await fetch(`http://localhost:${port}/api/assets/registry/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(post.ok).toBe(true);
    const written = (await post.json()) as {
      version: number;
      records: Array<{
        id: string;
        aliases?: string[];
        path: string;
        pathHistory: string[];
        label?: string;
      }>;
    };
    expect(written.version).toBe(2);
    expect(written.records).toHaveLength(1);
    expect(isCanonicalAssetId(written.records[0].id)).toBe(true);
    expect(written.records[0].aliases).toEqual([legacyId]);
    expect(written.records[0].path).toBe(COVER_ASSET_PATH);
    expect(written.records[0].pathHistory).toEqual([`projects/${STEM}/images/cover-old.png`]);
    expect(written.records[0].label).toBe("Cover");

    const onDisk = JSON.parse(readFileSync(registryFileForStem(STEM), "utf8"));
    expect(onDisk).toEqual(written);

    const get = await fetch(`http://localhost:${port}/api/assets/registry/${STEM}`);
    expect(get.ok).toBe(true);
    expect(await get.json()).toEqual(written);
  });

  it("POST /api/assets/ensure/:stem creates one canonical record and reuses it on repeat calls", {
    timeout: 15_000,
  }, async () => {
    const first = await fetch(`http://localhost:${port}/api/assets/ensure/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ENSURE_ASSET_PATH, label: "Scene" }),
    });

    expect(first.ok).toBe(true);
    const firstBody = (await first.json()) as {
      changed: boolean;
      count: number;
      record: {
        id: string;
        aliases?: string[];
        path: string;
        pathHistory: string[];
        kind: string;
        scope: string;
        stem: string | null;
        label?: string;
      };
    };
    expect(firstBody.changed).toBe(true);
    expect(firstBody.count).toBeGreaterThanOrEqual(1);
    expect(isCanonicalAssetId(firstBody.record.id)).toBe(true);
    expect(firstBody.record.aliases).toEqual([generateAssetId(ENSURE_ASSET_PATH)]);
    expect(firstBody.record.path).toBe(ENSURE_ASSET_PATH);
    expect(firstBody.record.pathHistory).toEqual([]);
    expect(firstBody.record.kind).toBe("video");
    expect(firstBody.record.scope).toBe("project");
    expect(firstBody.record.stem).toBe(STEM);
    expect(firstBody.record.label).toBe("Scene");
    expect(firstBody.record.metadata ?? {}).toEqual({});

    const second = await fetch(`http://localhost:${port}/api/assets/ensure/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ENSURE_ASSET_PATH, label: "Scene" }),
    });

    expect(second.ok).toBe(true);
    const secondBody = (await second.json()) as {
      changed: boolean;
      count: number;
      record: {
        id: string;
        path: string;
        metadata?: Record<string, unknown>;
      };
    };
    expect(secondBody.changed).toBe(false);
    expect(secondBody.count).toBe(firstBody.count);
    expect(secondBody.record.id).toBe(firstBody.record.id);
    expect(secondBody.record.path).toBe(ENSURE_ASSET_PATH);
    expect(secondBody.record.metadata ?? {}).toEqual({});

    const stored = JSON.parse(readFileSync(registryFileForStem(STEM), "utf8")) as {
      version: number;
      records: Array<{ id: string; path: string; metadata?: Record<string, unknown> }>;
    };
    expect(stored.version).toBe(2);
    expect(stored.records.filter((record) => record.path === ENSURE_ASSET_PATH)).toHaveLength(1);
    expect(stored.records.find((record) => record.path === ENSURE_ASSET_PATH)?.id).toBe(
      firstBody.record.id,
    );
    expect(stored.records.find((record) => record.path === ENSURE_ASSET_PATH)?.metadata ?? {}).toEqual({});
  });

  it("POST /api/assets/enrich/:stem populates metadata for one existing record without changing identity", {
    timeout: 30_000,
  }, async () => {
    const ensure = await fetch(`http://localhost:${port}/api/assets/ensure/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ENRICH_IMAGE_ASSET_PATH, label: "Probe" }),
    });

    expect(ensure.ok).toBe(true);
    const ensureBody = (await ensure.json()) as {
      record: {
        id: string;
        path: string;
        metadata?: Record<string, unknown>;
      };
    };
    expect(ensureBody.record.path).toBe(ENRICH_IMAGE_ASSET_PATH);
    expect(ensureBody.record.metadata ?? {}).toEqual({});

    const enrich = await fetch(`http://localhost:${port}/api/assets/enrich/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [ensureBody.record.id] }),
    });

    expect(enrich.ok).toBe(true);
    const enrichBody = (await enrich.json()) as {
      changed: boolean;
      enrichedCount: number;
      records: Array<{
        id: string;
        metadata: {
          width?: number;
          height?: number;
          hasAlpha?: boolean;
        };
      }>;
    };
    expect(enrichBody.changed).toBe(true);
    expect(enrichBody.enrichedCount).toBeGreaterThan(0);
    expect(enrichBody.records).toHaveLength(1);
    expect(enrichBody.records[0].id).toBe(ensureBody.record.id);
    expect(enrichBody.records[0].metadata).toMatchObject({ width: 1, height: 1, hasAlpha: true });

    const repeat = await fetch(`http://localhost:${port}/api/assets/enrich/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [ensureBody.record.id] }),
    });

    expect(repeat.ok).toBe(true);
    const repeatBody = (await repeat.json()) as {
      changed: boolean;
      enrichedCount: number;
      records: Array<{
        id: string;
        metadata: {
          width?: number;
          height?: number;
          hasAlpha?: boolean;
        };
      }>;
    };
    expect(repeatBody.changed).toBe(false);
    expect(repeatBody.enrichedCount).toBeGreaterThanOrEqual(0);
    expect(repeatBody.records).toHaveLength(1);
    expect(repeatBody.records[0].id).toBe(ensureBody.record.id);
    expect(repeatBody.records[0].metadata).toMatchObject({ width: 1, height: 1, hasAlpha: true });

    const stored = JSON.parse(readFileSync(registryFileForStem(STEM), "utf8")) as {
      version: number;
      records: Array<{
        id: string;
        path: string;
        metadata?: {
          width?: number;
          height?: number;
          hasAlpha?: boolean;
        };
      }>;
    };
    expect(stored.version).toBe(2);
    expect(stored.records.filter((record) => record.path === ENRICH_IMAGE_ASSET_PATH)).toHaveLength(1);
    expect(stored.records.find((record) => record.id === ensureBody.record.id)?.metadata).toMatchObject({
      width: 1,
      height: 1,
      hasAlpha: true,
    });
  });

  it("POST /api/assets/reconcile/:stem preserves identity across a rename under the registry lock", {
    timeout: 30_000,
  }, async () => {
    const ensure = await fetch(`http://localhost:${port}/api/assets/ensure/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: RECONCILE_IMAGE_ASSET_PATH, label: "Reconcile Source" }),
    });

    expect(ensure.ok).toBe(true);
    const ensureBody = (await ensure.json()) as {
      record: {
        id: string;
        path: string;
      };
    };
    expect(ensureBody.record.path).toBe(RECONCILE_IMAGE_ASSET_PATH);

    const enrich = await fetch(`http://localhost:${port}/api/assets/enrich/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [ensureBody.record.id] }),
    });

    expect(enrich.ok).toBe(true);

    renameSync(
      join(tmpProjects, STEM, "images", "reconcile-source.png"),
      join(tmpProjects, STEM, "images", "reconcile-renamed.png"),
    );

    const reconcile = await fetch(`http://localhost:${port}/api/assets/reconcile/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(reconcile.ok).toBe(true);
    const reconcileBody = (await reconcile.json()) as {
      changed: boolean;
      wrote: boolean;
      stats: {
        added: number;
        missing: number;
        moved: number;
      };
      registry: {
        version: number;
        records: Array<{
          id: string;
          path: string;
          pathHistory: string[];
          status: string;
        }>;
      };
    };
    expect(reconcileBody.changed).toBe(true);
    expect(reconcileBody.wrote).toBe(true);
    expect(reconcileBody.stats.moved).toBeGreaterThanOrEqual(1);
    expect(reconcileBody.registry.version).toBe(2);

    const renamedRecord = reconcileBody.registry.records.find(
      (record) => record.id === ensureBody.record.id,
    );
    expect(renamedRecord).toMatchObject({
      id: ensureBody.record.id,
      path: RECONCILE_RENAMED_ASSET_PATH,
      status: "active",
    });
    expect(renamedRecord?.pathHistory).toContain(RECONCILE_IMAGE_ASSET_PATH);

    const stored = JSON.parse(readFileSync(registryFileForStem(STEM), "utf8")) as {
      version: number;
      records: Array<{
        id: string;
        path: string;
        pathHistory: string[];
        status: string;
      }>;
    };
    expect(stored.version).toBe(2);
    expect(stored.records.find((record) => record.id === ensureBody.record.id)).toMatchObject({
      id: ensureBody.record.id,
      path: RECONCILE_RENAMED_ASSET_PATH,
      status: "active",
    });
    expect(
      stored.records.some(
        (record) => record.id !== ensureBody.record.id && record.path === RECONCILE_RENAMED_ASSET_PATH,
      ),
    ).toBe(false);
    expect(stored.records.find((record) => record.id === ensureBody.record.id)?.pathHistory).toContain(
      RECONCILE_IMAGE_ASSET_PATH,
    );
  });

  it("POST /api/assets/enrich/:stem leaves metadata untouched when probing yields nothing safe", {
    timeout: 30_000,
  }, async () => {
    const ensure = await fetch(`http://localhost:${port}/api/assets/ensure/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ENSURE_ASSET_PATH, label: "Scene" }),
    });

    expect(ensure.ok).toBe(true);
    const ensureBody = (await ensure.json()) as {
      record: {
        id: string;
        metadata?: Record<string, unknown>;
      };
    };

    const enrich = await fetch(`http://localhost:${port}/api/assets/enrich/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [ensureBody.record.id] }),
    });

    expect(enrich.ok).toBe(true);
    const enrichBody = (await enrich.json()) as {
      changed: boolean;
      enrichedCount: number;
      records: Array<{
        id: string;
        metadata?: Record<string, unknown>;
        contentHash?: string | null;
        hashVersion?: string | null;
      }>;
    };
    expect(enrichBody.enrichedCount).toBeGreaterThanOrEqual(0);
    expect(enrichBody.records).toHaveLength(1);
    expect(enrichBody.records[0].id).toBe(ensureBody.record.id);
    expect(enrichBody.records[0].metadata ?? {}).toEqual(ensureBody.record.metadata ?? {});
    expect(typeof enrichBody.records[0].contentHash === "string" || enrichBody.records[0].contentHash === null).toBe(true);
    expect(enrichBody.records[0].hashVersion === "sha256" || enrichBody.records[0].hashVersion === null).toBe(true);

    const stored = JSON.parse(readFileSync(registryFileForStem(STEM), "utf8")) as {
      version: number;
      records: Array<{
        id: string;
        metadata?: Record<string, unknown>;
        contentHash?: string | null;
        hashVersion?: string | null;
      }>;
    };
    expect(stored.version).toBe(2);
    const storedRecord = stored.records.find((record) => record.id === ensureBody.record.id);
    expect(storedRecord?.metadata ?? {}).toEqual(ensureBody.record.metadata ?? {});
    expect(typeof storedRecord?.contentHash === "string" || storedRecord?.contentHash === null).toBe(true);
    expect(storedRecord?.hashVersion === "sha256" || storedRecord?.hashVersion === null).toBe(true);
  });

  it("POST /api/assets/ensure/:stem rejects symlinked directory escapes", {
    timeout: 15_000,
  }, async () => {
    const r = await fetch(`http://localhost:${port}/api/assets/ensure/${STEM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: `projects/${STEM}/images/escape/outside.png` }),
    });

    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "invalid-asset-target" });

    const stored = JSON.parse(readFileSync(registryFileForStem(STEM), "utf8")) as {
      records: Array<{ path: string }>;
    };
    expect(
      stored.records.some((record) => record.path === `projects/${STEM}/images/escape/outside.png`),
    ).toBe(false);
  });

  it("orphan .analyze-status.json is reconciled on boot", async () => {
    // By the time vite is serving, the boot hook has already run.
    const raw = readFileSync(join(tmpProjects, STEM, ".analyze-status.json"), "utf8");
    const status = JSON.parse(raw);
    expect(status.phase).toBe("orphaned-at-boot");
    expect(status.endedAt).not.toBeNull();
  });

  it("POST /api/analyze/clear wipes events, preserves beats", async () => {
    const r = await fetch(`http://localhost:${port}/api/analyze/clear`, {
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
    const r = await fetch(`http://localhost:${port}/api/analyze/events/update`, {
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
    const r = await fetch(`http://localhost:${port}/api/analyze/runs/${STEM}`);
    expect(r.ok).toBe(true);
    const data = (await r.json()) as { runs: Array<{ id: string; events: number }> };
    expect(data.runs.length).toBeGreaterThan(0);
    // The first snapshot should capture the PRE-CLEAR events (3 phase2).
    const firstSnapshot = data.runs[data.runs.length - 1]; // oldest
    expect(firstSnapshot.events).toBe(3);
  });

  it("POST /api/analyze/runs/:stem/restore round-trips events", async () => {
    // Get the list again and pick the oldest snapshot (3 events, pre-clear).
    const list = await (await fetch(`http://localhost:${port}/api/analyze/runs/${STEM}`)).json();
    const oldest = list.runs[list.runs.length - 1];

    const r = await fetch(`http://localhost:${port}/api/analyze/runs/${STEM}/restore`, {
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
    const r = await fetch(`http://localhost:${port}/api/chat`, {
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
      const r = await fetch(`http://localhost:${port}/api/current-project`);
      expect(r.status).toBe(404);
      const body = await r.json();
      expect(body.stale).toBe("stem-that-does-not-exist");
    } finally {
      if (backup !== null) wfs(cpFile, backup);
    }
  });

  it("rejects malformed stems with 400", async () => {
    const r = await fetch(`http://localhost:${port}/api/analyze/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stem: "../evil" }),
    });
    expect(r.status).toBe(400);
  });
});
