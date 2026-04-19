import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  parseFileArg,
  sanitizeEditorPath,
} from "../../scripts/cli/editorPath";

const REPO = "/repo";

describe("parseFileArg", () => {
  it("parses bare path", () => {
    expect(parseFileArg("src/foo.ts")).toEqual({
      filePath: "src/foo.ts",
      line: undefined,
      column: undefined,
    });
  });

  it("parses path with line", () => {
    expect(parseFileArg("src/foo.ts:42")).toEqual({
      filePath: "src/foo.ts",
      line: 42,
      column: undefined,
    });
  });

  it("parses path with line and column", () => {
    expect(parseFileArg("src/foo.ts:42:7")).toEqual({
      filePath: "src/foo.ts",
      line: 42,
      column: 7,
    });
  });

  it("strips trailing garbage after column", () => {
    expect(parseFileArg("src/foo.ts:42:7:junk")).toEqual({
      filePath: "src/foo.ts",
      line: 42,
      column: 7,
    });
  });

  it("returns null for empty or missing input", () => {
    expect(parseFileArg("")).toBeNull();
    expect(parseFileArg(undefined)).toBeNull();
  });
});

describe("sanitizeEditorPath", () => {
  it("accepts a plain repo-relative path", () => {
    expect(sanitizeEditorPath("src/compositions/MusicVideo.tsx", REPO)).toBe(
      path.join(REPO, "src/compositions/MusicVideo.tsx"),
    );
  });

  it("rejects absolute paths outside the repo", () => {
    expect(sanitizeEditorPath("/etc/passwd", REPO)).toBeNull();
    expect(sanitizeEditorPath("/tmp/evil.sh", REPO)).toBeNull();
  });

  it("accepts absolute paths that resolve inside the repo", () => {
    expect(sanitizeEditorPath("/repo/src/foo.ts", REPO)).toBe(
      path.join(REPO, "src/foo.ts"),
    );
  });

  it("rejects .. traversal that escapes the repo", () => {
    expect(sanitizeEditorPath("../../etc/passwd", REPO)).toBeNull();
    expect(sanitizeEditorPath("src/../../etc/passwd", REPO)).toBeNull();
  });

  it("normalizes and accepts benign .. that stays inside the repo", () => {
    expect(sanitizeEditorPath("src/../editor/src/main.tsx", REPO)).toBe(
      path.join(REPO, "editor/src/main.tsx"),
    );
  });

  it("rejects empty / whitespace input", () => {
    expect(sanitizeEditorPath("", REPO)).toBeNull();
    expect(sanitizeEditorPath("   ", REPO)).toBeNull();
  });
});
