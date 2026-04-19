import { describe, it, expect } from "vitest";
import {
  ELEMENT_SOURCE_PATHS,
  getElementSourcePath,
} from "@compositions/elements/registry";
import { ELEMENT_MODULES } from "@compositions/elements/registry";

describe("ELEMENT_SOURCE_PATHS", () => {
  it("has an entry for every registered element module", () => {
    for (const mod of ELEMENT_MODULES) {
      expect(
        ELEMENT_SOURCE_PATHS[mod.id],
        `missing source path for ${mod.id}`,
      ).toMatch(/^src\/compositions\/elements\/.+\.tsx$/);
    }
  });

  it("getElementSourcePath returns the path for known ids", () => {
    expect(getElementSourcePath("text.typing")).toBe(
      "src/compositions/elements/text/TypingText.tsx",
    );
    expect(getElementSourcePath("audio.bassGlow")).toBe(
      "src/compositions/elements/audio/BassGlowOverlay.tsx",
    );
  });

  it("getElementSourcePath returns null for unknown ids", () => {
    expect(getElementSourcePath("does.not.exist")).toBeNull();
    expect(getElementSourcePath("")).toBeNull();
  });
});
