#!/usr/bin/env -S npx tsx
//
// scripts/verify-asset-library.ts
//
// Self-check for the asset-library surface. Boots the editor dev-server on
// an ephemeral port, exercises the three surfaces (list, upload, symlink
// safety), and exits non-zero on any failure.
//
// Called by: agents after any edit touching AssetLibrary.tsx, AssetPicker.tsx,
// or the /api/assets/* sidecar handlers. Also reasonable to wire into CI.
//
// Why a separate script from verify-element-render.ts (the other terminal\'s
// render-verify loop): that one renders a single MusicVideo element and
// asserts the PNG is non-blank — a correctness test on the renderer. This
// one asserts on the asset-pipeline (drop file → panel sees it → click →
// upload round-trips → symlink attack blocked).

import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, unlinkSync, symlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const ASSETS_IMG = join(REPO, "public", "assets", "images");
const ASSETS_VID = join(REPO, "public", "assets", "videos");

// Minimal 1x1 red PNG — reused from verify-element-render\'s pattern.
const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009077533d0000000c4944415478da63f8cfc0000002000001ff0700000000000049454e44ae426082",
  "hex",
);

const fail = (msg: string): never => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const ok = (msg: string): void => console.log(`OK   ${msg}`);

async function waitForPort(base: string, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${base}/api/assets/list`);
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  fail(`dev server did not come up on ${base}`);
}

async function main(): Promise<void> {
  mkdirSync(ASSETS_IMG, { recursive: true });
  mkdirSync(ASSETS_VID, { recursive: true });

  const testPng = join(ASSETS_IMG, "__verify_asset_library.png");
  const evilSymlink = join(ASSETS_IMG, "__verify_symlink_should_be_rejected");
  const uploadedName = "__verify_uploaded.png";

  // Cleanup previous run
  for (const p of [testPng, evilSymlink, join(ASSETS_IMG, uploadedName)]) {
    try { unlinkSync(p); } catch { /* none */ }
  }

  // Seed a file the editor should discover via polling.
  writeFileSync(testPng, PNG_1x1);
  ok("seeded test PNG in public/assets/images/");

  // Plant a symlink to /etc/hosts. The pre-fix code path would enumerate
  // this and its URL would be served by Vite. Post-fix: must be skipped.
  try {
    symlinkSync("/etc/hosts", evilSymlink);
    ok("planted evil symlink → /etc/hosts");
  } catch (err) {
    console.warn(`could not plant symlink (${String(err)}); skipping traversal test`);
  }

  // Spawn the dev server in a child process.
  const editorDir = join(REPO, "editor");
  const child: ChildProcess = spawn("npm", ["run", "dev"], {
    cwd: editorDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  let port: number | null = null;
  const portPromise = new Promise<number>((resolveP) => {
    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      const m = text.match(/localhost:(\d+)/);
      if (m) {
        port = Number(m[1]);
        resolveP(port);
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
  });

  let failureMessage: string | null = null;
  try {
    const detectedPort = await Promise.race([
      portPromise,
      new Promise<number>((_, rej) =>
        setTimeout(() => rej(new Error("timeout waiting for port")), 20_000),
      ),
    ]);
    const base = `http://localhost:${detectedPort}`;
    ok(`dev server on ${base}`);
    await waitForPort(base);

    // 1. /api/assets/list returns the seeded PNG.
    const listRes = await fetch(`${base}/api/assets/list`);
    if (!listRes.ok) fail(`list returned HTTP ${listRes.status}`);
    const list = (await listRes.json()) as Array<{ path: string; kind: string; scope: string }>;
    const seeded = list.find((e) => e.path.endsWith("__verify_asset_library.png"));
    if (!seeded) fail("seeded PNG not visible in /api/assets/list");
    if (seeded.scope !== "global" || seeded.kind !== "image") {
      fail(`seeded entry has wrong shape: ${JSON.stringify(seeded)}`);
    }
    ok("list enumerates seeded PNG with correct scope/kind");

    // 2. Symlink traversal must be blocked.
    if (existsSync(evilSymlink)) {
      const sneaky = list.find((e) => e.path.includes("__verify_symlink_should_be_rejected"));
      if (sneaky) fail(`symlink traversal leaked: ${JSON.stringify(sneaky)}`);
      ok("symlink entry correctly excluded from /api/assets/list");
    }

    // 3. Upload endpoint round-trips a file.
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([PNG_1x1], { type: "image/png" }),
      uploadedName,
    );
    const upRes = await fetch(`${base}/api/assets/upload`, {
      method: "POST",
      body: fd,
    });
    if (upRes.status !== 201) fail(`upload returned HTTP ${upRes.status}: ${await upRes.text()}`);
    const uploaded = await upRes.json() as { path: string; kind: string };
    if (!uploaded.path.endsWith(uploadedName) || uploaded.kind !== "image") {
      fail(`upload returned wrong entry: ${JSON.stringify(uploaded)}`);
    }
    ok(`upload wrote and returned ${uploaded.path}`);

    // 4. Uploaded file is reachable via Vite.
    const fetchBack = await fetch(`${base}/${uploaded.path}`);
    if (!fetchBack.ok) fail(`uploaded file not served by Vite (HTTP ${fetchBack.status})`);
    const buf = Buffer.from(await fetchBack.arrayBuffer());
    if (buf.length !== PNG_1x1.length) {
      fail(`uploaded PNG roundtrip size mismatch: ${buf.length} vs ${PNG_1x1.length}`);
    }
    ok("uploaded file served intact via /assets/...");

    // 5. Upload rejects non-image/video MIMEs.
    const badFd = new FormData();
    badFd.append("file", new Blob(["malicious"], { type: "text/html" }), "evil.html");
    const badRes = await fetch(`${base}/api/assets/upload`, { method: "POST", body: badFd });
    if (badRes.status !== 415) fail(`upload accepted non-media MIME: HTTP ${badRes.status}`);
    ok("upload rejects text/html with 415");

  } catch (err) {
    failureMessage = String((err as Error)?.message ?? err);
  } finally {
    // Cleanup
    for (const p of [testPng, evilSymlink, join(ASSETS_IMG, uploadedName)]) {
      try { unlinkSync(p); } catch { /* none */ }
    }
    // Best-effort kill of the dev server tree.
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, 500);
  }

  if (failureMessage) fail(failureMessage);
  console.log("\nverify-asset-library: ALL CHECKS PASSED");
}

main().catch((err) => { console.error(err); process.exit(1); });

// Stop the type-checker complaining about unused readFile — kept in case
// future checks want to read a file from disk.
void readFile;
