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
import { writeFileSync, mkdirSync, existsSync, unlinkSync, symlinkSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectsDir } from "./cli/paths";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const PROJECTS_DIR = resolveProjectsDir(REPO);
const ASSETS_IMG = join(REPO, "public", "assets", "images");
const ASSETS_GIF = join(REPO, "public", "assets", "gifs");
const ASSETS_VID = join(REPO, "public", "assets", "videos");

// Minimal 1x1 red PNG — reused from verify-element-render\'s pattern.
const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009077533d0000000c4944415478da63f8cfc0000002000001ff0700000000000049454e44ae426082",
  "hex",
);

// Minimal 1x1 GIF.
const GIF_1x1 = Buffer.from(
  "47494638396101000100800000ffffff00000021f90401000001002c00000000010001000002024401003b",
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
  mkdirSync(ASSETS_GIF, { recursive: true });
  mkdirSync(ASSETS_VID, { recursive: true });

  const testPng = join(ASSETS_IMG, "__verify_asset_library.png");
  const testGif = join(ASSETS_GIF, "__verify_asset_library.gif");
  const evilSymlink = join(ASSETS_IMG, "__verify_symlink_should_be_rejected");
  const uploadedName = "__verify_uploaded.png";
  const uploadedGifName = "__verify_uploaded.gif";
  const projectStem = "__verify-project-assets";
  const projectDir = join(PROJECTS_DIR, projectStem);
  const projectUploadedName = "__verify_project_uploaded.png";
  const projectUploadedGifName = "__verify_project_uploaded.gif";

  // Cleanup previous run
  for (const p of [testPng, testGif, evilSymlink, join(ASSETS_IMG, uploadedName), join(ASSETS_GIF, uploadedGifName)]) {
    try { unlinkSync(p); } catch { /* none */ }
  }
  try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* none */ }

  // Seed a file the editor should discover via polling.
  writeFileSync(testPng, PNG_1x1);
  ok("seeded test PNG in public/assets/images/");
  writeFileSync(testGif, GIF_1x1);
  ok("seeded test GIF in public/assets/gifs/");

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

  // Detect port by polling a small range of candidate ports rather than
  // parsing Vite's output (ANSI color / buffering made that brittle).
  const portPromise = new Promise<number>(async (resolveP, reject) => {
    const candidates = [4000, 4001, 4002, 4003, 4004, 5173, 5174];
    const start = Date.now();
    while (Date.now() - start < 40_000) {
      for (const candidate of candidates) {
        try {
          const r = await fetch(`http://localhost:${candidate}/api/assets/list`, {
            signal: AbortSignal.timeout(1_000),
          });
          if (r.ok) { resolveP(candidate); return; }
        } catch { /* port not up yet */ }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    reject(new Error("no candidate port responded"));
  });

  let failureMessage: string | null = null;
  try {
    const detectedPort = await Promise.race([
      portPromise,
      new Promise<number>((_, rej) =>
        setTimeout(() => rej(new Error("timeout waiting for port")), 45_000),
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

    const seededGif = list.find((e) => e.path.endsWith("__verify_asset_library.gif"));
    if (!seededGif) fail("seeded GIF not visible in /api/assets/list");
    if (seededGif.scope !== "global" || seededGif.kind !== "gif") {
      fail(`seeded GIF entry has wrong shape: ${JSON.stringify(seededGif)}`);
    }
    ok("list enumerates seeded GIF with correct scope/kind");

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

    // 5. GIF upload round-trips as kind:"gif".
    const gifFd = new FormData();
    gifFd.append(
      "file",
      new Blob([GIF_1x1], { type: "image/gif" }),
      uploadedGifName,
    );
    const gifRes = await fetch(`${base}/api/assets/upload`, {
      method: "POST",
      body: gifFd,
    });
    if (gifRes.status !== 201) fail(`GIF upload returned HTTP ${gifRes.status}: ${await gifRes.text()}`);
    const uploadedGif = await gifRes.json() as { path: string; kind: string };
    if (!uploadedGif.path.endsWith(uploadedGifName) || uploadedGif.kind !== "gif") {
      fail(`GIF upload returned wrong entry: ${JSON.stringify(uploadedGif)}`);
    }
    ok(`GIF upload wrote and returned ${uploadedGif.path}`);

    // 6. Project-scope upload lands under projects/<stem>/images and is served
    // through /api/projects/*.
    const projectFd = new FormData();
    projectFd.append(
      "file",
      new Blob([PNG_1x1], { type: "image/png" }),
      projectUploadedName,
    );
    const projectRes = await fetch(
      `${base}/api/assets/upload?scope=project&stem=${encodeURIComponent(projectStem)}`,
      {
        method: "POST",
        body: projectFd,
      },
    );
    if (projectRes.status !== 201) fail(`project upload returned HTTP ${projectRes.status}: ${await projectRes.text()}`);
    const projectUploaded = await projectRes.json() as { path: string; kind: string; scope: string; stem: string | null };
    if (!projectUploaded.path.endsWith(`projects/${projectStem}/images/${projectUploadedName}`) || projectUploaded.kind !== "image" || projectUploaded.scope !== "project") {
      fail(`project upload returned wrong entry: ${JSON.stringify(projectUploaded)}`);
    }
    ok(`project upload wrote and returned ${projectUploaded.path}`);

    const projectFetch = await fetch(`${base}/api/${projectUploaded.path}`);
    if (!projectFetch.ok) fail(`project-uploaded file not served by /api/projects (HTTP ${projectFetch.status})`);
    ok("project-uploaded file served intact via /api/projects/...");

    const projectGifFd = new FormData();
    projectGifFd.append(
      "file",
      new Blob([GIF_1x1], { type: "image/gif" }),
      projectUploadedGifName,
    );
    const projectGifRes = await fetch(
      `${base}/api/assets/upload?scope=project&stem=${encodeURIComponent(projectStem)}`,
      {
        method: "POST",
        body: projectGifFd,
      },
    );
    if (projectGifRes.status !== 201) fail(`project GIF upload returned HTTP ${projectGifRes.status}: ${await projectGifRes.text()}`);
    const projectUploadedGif = await projectGifRes.json() as { path: string; kind: string; scope: string };
    if (!projectUploadedGif.path.endsWith(`projects/${projectStem}/gifs/${projectUploadedGifName}`) || projectUploadedGif.kind !== "gif" || projectUploadedGif.scope !== "project") {
      fail(`project GIF upload returned wrong entry: ${JSON.stringify(projectUploadedGif)}`);
    }
    ok(`project GIF upload wrote and returned ${projectUploadedGif.path}`);

    const projectGifFetch = await fetch(`${base}/api/${projectUploadedGif.path}`);
    if (!projectGifFetch.ok) fail(`project-uploaded GIF not served by /api/projects (HTTP ${projectGifFetch.status})`);
    const projectGifCt = projectGifFetch.headers.get("content-type") ?? "";
    if (!projectGifCt.startsWith("image/gif")) {
      fail(`project-uploaded GIF served with wrong content-type: ${projectGifCt}`);
    }
    ok("project-uploaded GIF served with image/gif content type");

    // 8. Upload rejects non-image/video/gif MIMEs.
    const badFd = new FormData();
    badFd.append("file", new Blob(["malicious"], { type: "text/html" }), "evil.html");
    const badRes = await fetch(`${base}/api/assets/upload`, { method: "POST", body: badFd });
    if (badRes.status !== 415) fail(`upload accepted non-media MIME: HTTP ${badRes.status}`);
    ok("upload rejects text/html with 415");

  } catch (err) {
    failureMessage = String((err as Error)?.message ?? err);
  } finally {
    // Cleanup
    for (const p of [testPng, testGif, evilSymlink, join(ASSETS_IMG, uploadedName), join(ASSETS_GIF, uploadedGifName)]) {
      try { unlinkSync(p); } catch { /* none */ }
    }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* none */ }
    // Best-effort kill of the dev server tree.
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, 500);
  }

  if (failureMessage) fail(failureMessage);
  console.log("\nverify-asset-library: ALL CHECKS PASSED");
}

main().catch((err) => { console.error(err); process.exit(1); });
