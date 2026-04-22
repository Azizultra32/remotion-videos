import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStatic } from "./_helpers";

describe("resolveStatic", () => {
  const staticFileMock = vi.fn((src: string) => `/static/${src}`);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  afterEach(() => {
    staticFileMock.mockClear();
    warnSpy.mockClear();
  });

  it("passes through http and absolute sources", () => {
    expect(resolveStatic("https://example.com/demo.mp4", staticFileMock)).toBe(
      "https://example.com/demo.mp4",
    );
    expect(resolveStatic("/absolute/path.png", staticFileMock)).toBe("/absolute/path.png");
    expect(staticFileMock).not.toHaveBeenCalled();
  });

  it("resolves canonical and alias asset ids through the registry", () => {
    const registry = [
      {
        id: "ast_00000000000000aa",
        path: "projects/demo/image.png",
        aliases: ["ast_00000000000000bb"],
      },
    ];

    expect(resolveStatic("ast_00000000000000aa", staticFileMock, registry)).toBe(
      "/static/projects/demo/image.png",
    );
    expect(resolveStatic("ast_00000000000000bb", staticFileMock, registry)).toBe(
      "/static/projects/demo/image.png",
    );
  });

  it("warns and returns the original asset id when the registry is missing or incomplete", () => {
    expect(resolveStatic("ast_00000000000000aa", staticFileMock, null)).toBe(
      "ast_00000000000000aa",
    );
    expect(resolveStatic("ast_00000000000000cc", staticFileMock, [
      { id: "ast_00000000000000aa", path: "projects/demo/image.png" },
    ])).toBe("ast_00000000000000cc");

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
