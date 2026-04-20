import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildOpenInEditorUrl, openInEditor } from "../src/utils/openInEditor";

describe("buildOpenInEditorUrl", () => {
  it("encodes a bare path into the 'file' query param", () => {
    expect(buildOpenInEditorUrl("src/compositions/MusicVideo.tsx")).toBe(
      "/__open-in-editor?file=src%2Fcompositions%2FMusicVideo.tsx",
    );
  });

  it("appends :line when line is supplied", () => {
    expect(buildOpenInEditorUrl("editor/src/App.tsx", 42)).toBe(
      "/__open-in-editor?file=editor%2Fsrc%2FApp.tsx%3A42",
    );
  });

  it("appends :line:col when both supplied", () => {
    expect(buildOpenInEditorUrl("editor/src/App.tsx", 42, 7)).toBe(
      "/__open-in-editor?file=editor%2Fsrc%2FApp.tsx%3A42%3A7",
    );
  });
});

describe("openInEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to the /__open-in-editor endpoint", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    await openInEditor("src/foo.ts", 10);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain("/__open-in-editor?file=src%2Ffoo.ts%3A10");
    expect(init?.method).toBe("POST");
  });

  it("swallows fetch rejections (fire-and-forget)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("nope"));
    await expect(openInEditor("src/foo.ts")).resolves.toBeUndefined();
  });
});
