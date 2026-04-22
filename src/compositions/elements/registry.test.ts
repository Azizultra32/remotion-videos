import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@remotion/lottie", () => ({
  Lottie: () => null,
}));

describe("element registry", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("exposes built-in modules through lookup and category listings", async () => {
    const { getElementModule, listByCategory } = await import("./registry");

    expect(getElementModule("overlay.staticImage")?.id).toBe("overlay.staticImage");
    expect(getElementModule("missing.type")).toBeNull();

    const grouped = listByCategory();
    expect(grouped.overlay.some((module) => module.id === "overlay.staticImage")).toBe(true);
    expect(grouped.audio.some((module) => module.id === "audio.oscilloscope")).toBe(true);
  }, 15000);

  it("lets later project custom elements override built-ins by id", async () => {
    vi.doMock("./_generated-custom-elements", () => ({
      PROJECT_CUSTOM_ELEMENTS: [
        {
          id: "overlay.staticImage",
          category: "overlay",
          label: "Custom Static",
          description: "override",
          defaultDurationSec: 1,
          defaultTrack: 1,
          schema: z.object({}),
          defaults: {},
          Renderer: () => null,
        },
      ],
    }));

    const { ELEMENT_MODULES, getElementModule, listByCategory } = await import("./registry");
    const lastModule = ELEMENT_MODULES[ELEMENT_MODULES.length - 1];
    const overlayModules = listByCategory().overlay;
    const lastOverlayModule = overlayModules[overlayModules.length - 1];

    expect(lastModule?.label).toBe("Custom Static");
    expect(getElementModule("overlay.staticImage")?.label).toBe("Custom Static");
    expect(lastOverlayModule?.label).toBe("Custom Static");
  });
});
