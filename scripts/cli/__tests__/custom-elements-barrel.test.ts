// Unit tests for scripts/cli/custom-elements-barrel.ts.
//
// These tests pin down the contract the pre-commit hook depends on: the
// generator emits `_proj_*` identifiers for per-project imports, and the
// empty-stub output is byte-identical to the tracked file. If someone
// renames the identifier convention without updating scripts/hooks/pre-
// commit, this test file screams before the hook silently becomes a
// false-negative.

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  BARREL_PATH_FROM_REPO_ROOT,
  generateCustomElementsBarrel,
  resetCustomElementsBarrel,
} from "../custom-elements-barrel";

describe("custom-elements-barrel", () => {
  let fakeRepo: string;
  let fakeProject: string;
  let barrelPath: string;

  beforeEach(() => {
    fakeRepo = mkdtempSync(resolve(tmpdir(), "mv-barrel-test-"));
    fakeProject = resolve(fakeRepo, "fake-project");
    mkdirSync(resolve(fakeRepo, "src/compositions/elements"), { recursive: true });
    mkdirSync(fakeProject, { recursive: true });
    barrelPath = resolve(fakeRepo, BARREL_PATH_FROM_REPO_ROOT);
  });

  afterEach(() => {
    rmSync(fakeRepo, { recursive: true, force: true });
  });

  it("resets to an empty stub with no _proj_ identifiers", () => {
    resetCustomElementsBarrel(fakeRepo);
    const body = readFileSync(barrelPath, "utf8");
    expect(body).toContain("PROJECT_CUSTOM_ELEMENTS: ElementModule<any>[] = [];");
    expect(body).not.toContain("_proj_");
  });

  it("returns moduleCount: 0 when the custom-elements dir is missing", () => {
    const result = generateCustomElementsBarrel(fakeRepo, fakeProject);
    expect(result.moduleCount).toBe(0);
    expect(result.files).toEqual([]);
  });

  it("skips .tsx.example templates", () => {
    const customDir = resolve(fakeProject, "custom-elements");
    mkdirSync(customDir);
    writeFileSync(resolve(customDir, "Example.tsx.example"), "// placeholder");
    const result = generateCustomElementsBarrel(fakeRepo, fakeProject);
    expect(result.moduleCount).toBe(0);
    expect(result.files).toEqual([]);
    expect(readFileSync(barrelPath, "utf8")).not.toContain("_proj_");
  });

  it("skips dotfiles", () => {
    const customDir = resolve(fakeProject, "custom-elements");
    mkdirSync(customDir);
    writeFileSync(resolve(customDir, ".DS_Store.tsx"), "// dotfile");
    const result = generateCustomElementsBarrel(fakeRepo, fakeProject);
    expect(result.moduleCount).toBe(0);
  });

  it("emits _proj_* imports for real .tsx files — this is the contract the pre-commit hook depends on", () => {
    const customDir = resolve(fakeProject, "custom-elements");
    mkdirSync(customDir);
    writeFileSync(resolve(customDir, "Alpha.tsx"), "// alpha");
    writeFileSync(resolve(customDir, "Beta.tsx"), "// beta");
    const result = generateCustomElementsBarrel(fakeRepo, fakeProject);
    expect(result.moduleCount).toBe(2);
    expect(result.files.sort()).toEqual(["Alpha.tsx", "Beta.tsx"]);
    const body = readFileSync(barrelPath, "utf8");
    // The hook grep `_proj_` is load-bearing; this assertion fails if the
    // identifier convention is ever changed without updating the hook.
    expect(body).toMatch(/_proj_0_Alpha/);
    expect(body).toMatch(/_proj_1_Beta/);
    expect(body).toContain("PROJECT_CUSTOM_ELEMENTS: ElementModule<any>[] = [");
  });

  it("sanitizes non-identifier characters in filenames", () => {
    const customDir = resolve(fakeProject, "custom-elements");
    mkdirSync(customDir);
    writeFileSync(resolve(customDir, "my-element.tsx"), "// dash");
    writeFileSync(resolve(customDir, "My Element.tsx"), "// space");
    const result = generateCustomElementsBarrel(fakeRepo, fakeProject);
    expect(result.moduleCount).toBe(2);
    const body = readFileSync(barrelPath, "utf8");
    // Dash + space → underscore; files differentiated by index prefix.
    expect(body).toMatch(/_proj_\d+_my_element/);
    expect(body).toMatch(/_proj_\d+_My_Element/);
  });

  it("produces a deterministic order (alphabetical by filename)", () => {
    const customDir = resolve(fakeProject, "custom-elements");
    mkdirSync(customDir);
    writeFileSync(resolve(customDir, "Zeta.tsx"), "");
    writeFileSync(resolve(customDir, "Alpha.tsx"), "");
    writeFileSync(resolve(customDir, "Mu.tsx"), "");
    const result = generateCustomElementsBarrel(fakeRepo, fakeProject);
    expect(result.files).toEqual(["Alpha.tsx", "Mu.tsx", "Zeta.tsx"]);
    const body = readFileSync(barrelPath, "utf8");
    const alphaIdx = body.indexOf("_proj_0_Alpha");
    const muIdx = body.indexOf("_proj_1_Mu");
    const zetaIdx = body.indexOf("_proj_2_Zeta");
    expect(alphaIdx).toBeLessThan(muIdx);
    expect(muIdx).toBeLessThan(zetaIdx);
  });

  it("reset after generate restores the empty stub (no _proj_ leaks)", () => {
    const customDir = resolve(fakeProject, "custom-elements");
    mkdirSync(customDir);
    writeFileSync(resolve(customDir, "Foo.tsx"), "");
    generateCustomElementsBarrel(fakeRepo, fakeProject);
    expect(readFileSync(barrelPath, "utf8")).toContain("_proj_0_Foo");
    resetCustomElementsBarrel(fakeRepo);
    expect(readFileSync(barrelPath, "utf8")).not.toContain("_proj_");
  });
});
