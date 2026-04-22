import { describe, expect, it } from "vitest";
import { buildMediaEffectStyle, buildMediaFilterString } from "./effectStackRuntime";

describe("effectStackRuntime", () => {
  it("joins ordered filter entries into one CSS filter string", () => {
    expect(
      buildMediaFilterString([
        { type: "blur", px: 12 },
        { type: "brightness", amount: 1.5 },
        { type: "hueRotate", deg: 45 },
      ]),
    ).toBe("blur(12px) brightness(1.5) hue-rotate(45deg)");
  });

  it("returns undefined when there are no effect filters", () => {
    expect(buildMediaFilterString([])).toBeUndefined();
  });

  it("builds reusable style blocks for media layers", () => {
    expect(
      buildMediaEffectStyle({
        absoluteFill: true,
        blendMode: "screen",
        opacity: 0.4,
        scale: 1.2,
        effects: [{ type: "contrast", amount: 1.3 }],
      }),
    ).toEqual({
      position: "absolute",
      inset: 0,
      opacity: 0.4,
      transform: "scale(1.2)",
      mixBlendMode: "screen",
      filter: "contrast(1.3)",
    });
  });
});
