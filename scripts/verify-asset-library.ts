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
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncStaticProjectsSymlink } from "./cli/paths";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
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

async function postJson(base: string, route: string, body: unknown): Promise<Response> {
  return fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

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

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => reject(new Error("could not determine reserved port")));
        return;
      }
      const { port } = addr;
      server.close((err) => {
        if (err) reject(err);
        else resolvePort(port);
      });
    });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveStop) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolveStop();
    };
    child.once("exit", finish);
    try { child.kill("SIGTERM"); } catch { finish(); return; }
    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      finish();
    }, 500);
  });
}

async function main(): Promise<void> {
  mkdirSync(ASSETS_IMG, { recursive: true });
  mkdirSync(ASSETS_GIF, { recursive: true });
  mkdirSync(ASSETS_VID, { recursive: true });

  const verifyTempRoot = join(tmpdir(), "mv-verify-asset-library");
  mkdirSync(verifyTempRoot, { recursive: true });
  const isolatedProjectsRoot = join(
    verifyTempRoot,
    `run-${process.pid}-${Date.now()}`,
  );
  mkdirSync(isolatedProjectsRoot, { recursive: true });
  const devPort = await reservePort();
  const testPng = join(ASSETS_IMG, "__verify_asset_library.png");
  const testGif = join(ASSETS_GIF, "__verify_asset_library.gif");
  const evilGifSymlink = join(ASSETS_GIF, "__verify_symlink_should_be_rejected.gif");
  const uploadedName = "__verify_uploaded.png";
  const uploadedGifName = "__verify_uploaded.gif";
  const projectStem = "__verify-project-assets";
  const projectDir = join(isolatedProjectsRoot, projectStem);
  const projectUploadedName = "__verify_project_uploaded.png";
  const projectUploadedGifName = "__verify_project_uploaded.gif";

  // Cleanup previous run
  for (const p of [testPng, testGif, evilGifSymlink, join(ASSETS_IMG, uploadedName), join(ASSETS_GIF, uploadedGifName)]) {
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
    symlinkSync("/etc/hosts", evilGifSymlink);
    ok("planted evil GIF symlink → /etc/hosts");
  } catch (err) {
    console.warn(`could not plant symlink (${String(err)}); skipping traversal test`);
  }

  // Spawn the dev server in a child process.
  const editorDir = join(REPO, "editor");
  const childLogs: string[] = [];
  const child: ChildProcess = spawn("npm", ["run", "dev", "--", "--port", String(devPort), "--strictPort"], {
    cwd: editorDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      MV_PROJECTS_DIR: isolatedProjectsRoot,
    },
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      childLogs.push(chunk.trimEnd());
      if (childLogs.length > 20) childLogs.shift();
    });
  }

  let failureMessage: string | null = null;
  try {
    const base = `http://localhost:${devPort}`;
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
    if (existsSync(evilGifSymlink)) {
      const sneaky = list.find((e) => e.path.endsWith("__verify_symlink_should_be_rejected.gif"));
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

    // 9. Thumbnail endpoint returns PNG for global GIF assets.
    const thumbRes = await fetch(
      `${base}/api/assets/thumb?path=${encodeURIComponent(uploadedGif.path)}`,
    );
    if (!thumbRes.ok) fail(`thumb endpoint returned HTTP ${thumbRes.status}`);
    const thumbCt = thumbRes.headers.get("content-type") ?? "";
    if (!thumbCt.startsWith("image/png")) {
      fail(`thumb endpoint returned wrong content-type: ${thumbCt} (expected image/png)`);
    }
    const thumbCache = thumbRes.headers.get("cache-control") ?? "";
    if (!thumbCache.includes("immutable")) {
      fail(`thumb endpoint missing immutable cache header: ${thumbCache}`);
    }
    const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
    if (thumbBuf.length < 100) {
      fail(`thumb endpoint returned suspiciously small PNG: ${thumbBuf.length} bytes`);
    }
    ok("thumb endpoint returns cached PNG for global GIF asset");

    // 10. Thumbnail endpoint also supports project-scope GIF assets.
    const projectThumbRes = await fetch(
      `${base}/api/assets/thumb?path=${encodeURIComponent(projectUploadedGif.path)}`,
    );
    if (!projectThumbRes.ok) fail(`project thumb endpoint returned HTTP ${projectThumbRes.status}`);
    const projectThumbCt = projectThumbRes.headers.get("content-type") ?? "";
    if (!projectThumbCt.startsWith("image/png")) {
      fail(`project thumb endpoint returned wrong content-type: ${projectThumbCt} (expected image/png)`);
    }
    const projectThumbBuf = Buffer.from(await projectThumbRes.arrayBuffer());
    if (projectThumbBuf.length < 100) {
      fail(`project thumb endpoint returned suspiciously small PNG: ${projectThumbBuf.length} bytes`);
    }
    ok("thumb endpoint returns PNG for project GIF asset");

    // 11. Thumbnail endpoint rejects non-GIF asset kinds.
    const thumbImageRes = await fetch(
      `${base}/api/assets/thumb?path=${encodeURIComponent(uploaded.path)}`,
    );
    if (thumbImageRes.status !== 400) {
      fail(`thumb endpoint accepted non-GIF asset (image): HTTP ${thumbImageRes.status} (expected 400)`);
    }
    ok("thumb endpoint rejects non-GIF assets with 400");

    // 12. Thumbnail endpoint rejects invalid and traversal-style paths.
    const thumbInvalidRes = await fetch(
      `${base}/api/assets/thumb?path=${encodeURIComponent("assets/gifs/nonexistent.gif")}`,
    );
    if (thumbInvalidRes.status !== 404) {
      fail(`thumb endpoint accepted invalid path: HTTP ${thumbInvalidRes.status} (expected 404)`);
    }
    ok("thumb endpoint rejects invalid path");

    const thumbTraversalRes = await fetch(
      `${base}/api/assets/thumb?path=${encodeURIComponent("../../../etc/hosts")}`,
    );
    if (thumbTraversalRes.status !== 404) {
      fail(`thumb endpoint accepted path traversal: HTTP ${thumbTraversalRes.status} (expected 404)`);
    }
    ok("thumb endpoint rejects path traversal");

    const thumbBackslashRes = await fetch(
      `${base}/api/assets/thumb?path=${encodeURIComponent("assets\\gifs\\evil.gif")}`,
    );
    if (thumbBackslashRes.status !== 404) {
      fail(`thumb endpoint accepted backslash path: HTTP ${thumbBackslashRes.status} (expected 404)`);
    }
    ok("thumb endpoint rejects backslash-separated paths");

    // 13. Thumbnail endpoint rejects symlink traversal.
    if (existsSync(evilGifSymlink)) {
      const thumbSymlinkRes = await fetch(
        `${base}/api/assets/thumb?path=${encodeURIComponent("assets/gifs/__verify_symlink_should_be_rejected.gif")}`,
      );
      if (thumbSymlinkRes.status !== 404) {
        fail(`thumb endpoint accepted symlink traversal: HTTP ${thumbSymlinkRes.status} (expected 404)`);
      }
      ok("thumb endpoint rejects symlink traversal");
    }

    // 14. Delete endpoint removes uploaded global assets and returns JSON metadata.
    const deleteRes = await postJson(base, "/api/assets/delete", { path: uploaded.path });
    if (!deleteRes.ok) fail(`delete endpoint returned HTTP ${deleteRes.status}`);
    const deleteCt = deleteRes.headers.get("content-type") ?? "";
    if (!deleteCt.startsWith("application/json")) {
      fail(`delete endpoint returned wrong content-type: ${deleteCt}`);
    }
    const deleted = await deleteRes.json() as {
      ok: boolean;
      id: string;
      path: string;
      deletedAt: number;
    };
    if (
      deleted.ok !== true
      || deleted.path !== uploaded.path
      || typeof deleted.id !== "string"
      || deleted.id.length === 0
      || typeof deleted.deletedAt !== "number"
      || !Number.isFinite(deleted.deletedAt)
    ) {
      fail(`delete endpoint returned wrong payload: ${JSON.stringify(deleted)}`);
    }
    ok(`delete endpoint removed ${uploaded.path} and returned delete metadata`);

    if (existsSync(join(ASSETS_IMG, uploadedName))) {
      fail(`deleted asset still exists on disk: ${join(ASSETS_IMG, uploadedName)}`);
    }
    ok("deleted global asset removed from disk");

    // 15. Deleted global asset no longer appears in list.
    const listAfterDelete = await fetch(`${base}/api/assets/list`);
    if (!listAfterDelete.ok) fail(`list returned HTTP ${listAfterDelete.status} after delete`);
    const listAfterDeleteData = (await listAfterDelete.json()) as Array<{ path: string }>;
    const deletedEntry = listAfterDeleteData.find((e) => e.path === uploaded.path);
    if (deletedEntry) fail(`deleted asset still appears in list: ${uploaded.path}`);
    ok("deleted global asset removed from list");

    const deleteAgainRes = await postJson(base, "/api/assets/delete", { path: uploaded.path });
    if (deleteAgainRes.status !== 404) {
      fail(`delete endpoint did not turn repeated delete into 404: HTTP ${deleteAgainRes.status}`);
    }
    ok("delete endpoint returns 404 for repeated delete");

    // 16. Delete endpoint also removes uploaded project assets.
    const projectDeleteRes = await postJson(base, "/api/assets/delete", { path: projectUploaded.path });
    if (!projectDeleteRes.ok) fail(`project delete endpoint returned HTTP ${projectDeleteRes.status}`);
    const projectDeleted = await projectDeleteRes.json() as {
      ok: boolean;
      path: string;
      deletedAt: number;
    };
    if (
      projectDeleted.ok !== true
      || projectDeleted.path !== projectUploaded.path
      || typeof projectDeleted.deletedAt !== "number"
    ) {
      fail(`project delete endpoint returned wrong payload: ${JSON.stringify(projectDeleted)}`);
    }
    ok(`delete endpoint removed project asset ${projectUploaded.path}`);

    if (existsSync(join(projectDir, "images", projectUploadedName))) {
      fail(`deleted project asset still exists on disk: ${join(projectDir, "images", projectUploadedName)}`);
    }
    ok("deleted project asset removed from disk");

    const listAfterProjectDelete = await fetch(`${base}/api/assets/list`);
    if (!listAfterProjectDelete.ok) fail(`list returned HTTP ${listAfterProjectDelete.status} after project delete`);
    const listAfterProjectDeleteData = (await listAfterProjectDelete.json()) as Array<{ path: string }>;
    const deletedProjectEntry = listAfterProjectDeleteData.find((e) => e.path === projectUploaded.path);
    if (deletedProjectEntry) fail(`deleted project asset still appears in list: ${projectUploaded.path}`);
    ok("deleted project asset removed from list");

    // 17. Delete endpoint rejects missing, invalid, and traversal-style paths.
    const deleteMissingRes = await postJson(base, "/api/assets/delete", {});
    if (deleteMissingRes.status !== 400) {
      fail(`delete endpoint accepted missing path: HTTP ${deleteMissingRes.status} (expected 400)`);
    }
    const deleteMissingBody = await deleteMissingRes.json() as { error?: string };
    if (deleteMissingBody.error !== "missing-path") {
      fail(`delete endpoint returned wrong missing-path payload: ${JSON.stringify(deleteMissingBody)}`);
    }
    ok("delete endpoint rejects missing path with 400");

    const deleteInvalidRes = await postJson(base, "/api/assets/delete", { path: "assets/images/nonexistent.png" });
    if (deleteInvalidRes.status !== 404) {
      fail(`delete endpoint accepted invalid path: HTTP ${deleteInvalidRes.status} (expected 404)`);
    }
    ok("delete endpoint rejects invalid path with 404");

    const deleteTraversalRes = await postJson(base, "/api/assets/delete", { path: "../../../etc/hosts" });
    if (deleteTraversalRes.status !== 404) {
      fail(`delete endpoint accepted path traversal: HTTP ${deleteTraversalRes.status} (expected 404)`);
    }
    ok("delete endpoint rejects path traversal");

    const deleteBackslashRes = await postJson(base, "/api/assets/delete", { path: "assets\\images\\evil.png" });
    if (deleteBackslashRes.status !== 404) {
      fail(`delete endpoint accepted backslash path: HTTP ${deleteBackslashRes.status} (expected 404)`);
    }
    ok("delete endpoint rejects backslash-separated paths");

    if (existsSync(evilGifSymlink)) {
      const deleteSymlinkRes = await postJson(base, "/api/assets/delete", {
        path: "assets/gifs/__verify_symlink_should_be_rejected.gif",
      });
      if (deleteSymlinkRes.status !== 404) {
        fail(`delete endpoint accepted symlink traversal: HTTP ${deleteSymlinkRes.status} (expected 404)`);
      }
      ok("delete endpoint rejects symlink traversal");
    }

  } catch (err) {
    const detail = childLogs.filter(Boolean).join("\n");
    failureMessage = String((err as Error)?.message ?? err);
    if (detail) failureMessage = `${failureMessage}\n${detail}`;
  } finally {
    // Cleanup
    for (const p of [testPng, testGif, evilGifSymlink, join(ASSETS_IMG, uploadedName), join(ASSETS_GIF, uploadedGifName)]) {
      try { unlinkSync(p); } catch { /* none */ }
    }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* none */ }
    await stopChild(child);
    try { syncStaticProjectsSymlink(REPO); } catch { /* ignore */ }
    try { rmSync(isolatedProjectsRoot, { recursive: true, force: true }); } catch { /* none */ }
  }

  if (failureMessage) fail(failureMessage);
  console.log("\nverify-asset-library: ALL CHECKS PASSED");
}

main().catch((err) => { console.error(err); process.exit(1); });
