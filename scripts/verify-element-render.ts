#!/usr/bin/env -S npx tsx
//
// scripts/verify-element-render.ts
//
// Self-check for the per-project custom-elements pipeline. Sister script to
// verify-asset-library.ts. The asset-library script asserts on the
// drop-file → panel pipeline; this one asserts on the
// per-project custom-element file → barrel generator → Webpack bundle →
// non-blank PNG pipeline.
//
// Why this exists: agents touching MusicVideo dispatch, the registry split,
// scripts/cli/custom-elements-barrel.ts, mv-render.ts, the @engine alias
// in remotion.config.ts, or editor/vite-plugin-custom-elements.ts ALL need
// to know whether their change broke the closed loop. Running this script
// is the answer — non-zero exit on any failure, and it cleans up after
// itself so it can be wired into CI or a pre-commit hook.
//
// What it asserts (each step exits non-zero on failure):
//   1. The barrel generator picks up *.tsx files under
//      <projectDir>/custom-elements/ and emits a valid TS module.
//   2. The Webpack bundle resolves "@engine/types" via the alias.
//   3. A composition that includes a custom element renders to a
//      non-blank PNG (>1KB heuristic; pure-black would be ~1.1KB at
//      848x480 from compression overhead).
//   4. The barrel is reset to the empty stub on exit.
//   5. The tracked stub on disk is the same content as EMPTY_BARREL — no
//      drift between the generator's reset output and the committed file.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync, rmdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BARREL_PATH_FROM_REPO_ROOT,
  generateCustomElementsBarrel,
  resetCustomElementsBarrel,
} from "./cli/custom-elements-barrel";
import { resolveProjectDir } from "./cli/paths";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const TEST_STEM = process.env.MV_VERIFY_STEM || "dubfire-short";
const TEST_ELEMENT_FILE = "VerifyElementRender.tsx";
const TEST_ELEMENT_ID = "custom.verify.element.render";
const STILL_OUT = "/tmp/verify-element-render.png";
const STILL_MIN_BYTES = 2000; // black 848x480 PNG ≈ 1.1KB; magenta one ≈ 8KB

const fail = (msg: string): never => {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
};
const ok = (msg: string): void => console.log(`OK   ${msg}`);

const projectDir = resolveProjectDir(REPO, TEST_STEM);
const customElementsDir = resolve(projectDir, "custom-elements");
const elementPath = resolve(customElementsDir, TEST_ELEMENT_FILE);
const barrelPath = resolve(REPO, BARREL_PATH_FROM_REPO_ROOT);

let createdCustomDir = false;

const cleanup = (): void => {
  try {
    if (existsSync(elementPath)) unlinkSync(elementPath);
    if (createdCustomDir && existsSync(customElementsDir)) {
      try { rmdirSync(customElementsDir); } catch { /* not empty, leave alone */ }
    }
    resetCustomElementsBarrel(REPO);
    if (existsSync(STILL_OUT)) unlinkSync(STILL_OUT);
  } catch (e) {
    console.warn(`(cleanup warning: ${(e as Error).message})`);
  }
};

const writeTestElement = (): void => {
  if (!existsSync(customElementsDir)) {
    mkdirSync(customElementsDir, { recursive: true });
    createdCustomDir = true;
  }
  writeFileSync(
    elementPath,
    `// Auto-written by scripts/verify-element-render.ts. Safe to delete.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "@engine/types";

const schema = z.object({});
type Props = z.infer<typeof schema>;

const Renderer: React.FC<ElementRendererProps<Props>> = () => (
  <AbsoluteFill style={{ background: "#ff00ff" }} />
);

const Module: ElementModule<Props> = {
  id: "${TEST_ELEMENT_ID}",
  category: "overlay",
  label: "verify-element-render",
  description: "scratch element for the verify script — not for production use",
  defaultDurationSec: 1,
  defaultTrack: 9,
  schema,
  defaults: {},
  Renderer,
};

export default Module;
`,
  );
};

const main = (): void => {
  if (!existsSync(projectDir)) {
    fail(`project '${TEST_STEM}' not found at ${projectDir}; set MV_VERIFY_STEM to an existing project stem`);
  }

  // --- Step 1: barrel generator picks up the test element ---
  writeTestElement();
  const result = generateCustomElementsBarrel(REPO, projectDir);
  if (!result.files.includes(TEST_ELEMENT_FILE)) {
    fail(`barrel generator did not pick up ${TEST_ELEMENT_FILE} — got ${JSON.stringify(result.files)}`);
  }
  ok(`barrel generator picked up ${TEST_ELEMENT_FILE} (${result.moduleCount} module${result.moduleCount === 1 ? "" : "s"})`);

  const barrelBody = readFileSync(barrelPath, "utf8");
  if (!barrelBody.includes("VerifyElementRender")) {
    fail(`barrel body missing import for VerifyElementRender:\n${barrelBody}`);
  }
  ok("barrel body contains the test element import");

  // --- Step 2 + 3: Webpack bundle resolves @engine + render produces non-blank PNG ---
  const inputProps = {
    audioSrc: null,
    beatsSrc: null,
    fps: 24,
    elements: [
      {
        id: "verify-test-el",
        type: TEST_ELEMENT_ID,
        trackIndex: 9,
        startSec: 0,
        durationSec: 5,
        label: "verify",
        props: {},
      },
    ],
    events: [],
    muteAudioTag: true,
    analysisAudioSrc: null,
    backgroundColor: "#000000",
  };

  const spawn = spawnSync(
    "npx",
    [
      "remotion",
      "still",
      "src/index.ts",
      "MusicVideo",
      STILL_OUT,
      "--frame=24",
      `--props=${JSON.stringify(inputProps)}`,
    ],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );

  if (spawn.status !== 0) {
    console.error(spawn.stdout);
    console.error(spawn.stderr);
    fail(`remotion still exited with code ${spawn.status}`);
  }
  ok("remotion still rendered (Webpack accepted @engine alias + custom element)");

  if (!existsSync(STILL_OUT)) fail(`still PNG not written to ${STILL_OUT}`);
  const size = statSync(STILL_OUT).size;
  if (size < STILL_MIN_BYTES) {
    fail(`still PNG suspiciously small (${size} bytes < ${STILL_MIN_BYTES}) — element likely didn't render`);
  }
  ok(`still PNG is ${size} bytes (>${STILL_MIN_BYTES} threshold — element rendered visible content)`);

  // --- Step 4: barrel resets cleanly ---
  resetCustomElementsBarrel(REPO);
  const afterReset = readFileSync(barrelPath, "utf8");
  if (afterReset.includes("VerifyElementRender")) {
    fail(`barrel still references test element after reset:\n${afterReset}`);
  }
  if (!afterReset.includes("PROJECT_CUSTOM_ELEMENTS: ElementModule<any>[] = [];")) {
    fail(`barrel after reset doesn't match expected empty stub:\n${afterReset}`);
  }
  ok("barrel reset to empty stub");

  // --- Step 5: tracked stub on disk matches the generator's reset output ---
  const headOutput = spawnSync("git", ["show", `HEAD:${BARREL_PATH_FROM_REPO_ROOT}`], {
    cwd: REPO, encoding: "utf8",
  });
  if (headOutput.status === 0 && headOutput.stdout !== afterReset) {
    fail(`tracked stub != generator's reset output → every render leaves working tree dirty`);
  }
  ok("tracked stub matches generator output (clean git status after render)");

  cleanup();
  console.log("");
  console.log("verify-element-render: 5/5 PASS");
};

try {
  main();
} catch (err) {
  console.error("verify-element-render crashed:", err);
  cleanup();
  process.exit(1);
}
