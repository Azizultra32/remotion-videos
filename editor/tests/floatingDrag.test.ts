import { describe, it, expect } from "vitest";
import { computeDragPosition } from "../src/utils/floatingDrag";

const bounds = { viewportW: 1440, viewportH: 900, width: 800, height: 482 };

describe("computeDragPosition", () => {
  it("returns startPos when delta is zero", () => {
    expect(
      computeDragPosition({ x: 100, y: 50 }, { x: 0, y: 0 }, bounds),
    ).toEqual({ x: 100, y: 50 });
  });

  it("applies positive delta", () => {
    expect(
      computeDragPosition({ x: 100, y: 50 }, { x: 30, y: 40 }, bounds),
    ).toEqual({ x: 130, y: 90 });
  });

  it("applies negative delta", () => {
    expect(
      computeDragPosition({ x: 100, y: 50 }, { x: -20, y: -10 }, bounds),
    ).toEqual({ x: 80, y: 40 });
  });

  it("clamps x to 0 when dragged left past the edge", () => {
    expect(
      computeDragPosition({ x: 10, y: 50 }, { x: -100, y: 0 }, bounds),
    ).toEqual({ x: 0, y: 50 });
  });

  it("clamps y to 0 when dragged above the viewport", () => {
    expect(
      computeDragPosition({ x: 100, y: 10 }, { x: 0, y: -100 }, bounds),
    ).toEqual({ x: 100, y: 0 });
  });

  it("clamps x so the window's right edge stays inside viewport", () => {
    // max x = 1440 - 800 = 640
    expect(
      computeDragPosition({ x: 600, y: 50 }, { x: 500, y: 0 }, bounds),
    ).toEqual({ x: 640, y: 50 });
  });

  it("clamps y so the window's bottom edge stays inside viewport", () => {
    // max y = 900 - 482 = 418
    expect(
      computeDragPosition({ x: 100, y: 400 }, { x: 0, y: 500 }, bounds),
    ).toEqual({ x: 100, y: 418 });
  });

  it("allows x=0 when the window is wider than the viewport (no negative clamp)", () => {
    const small = { viewportW: 600, viewportH: 400, width: 800, height: 482 };
    expect(
      computeDragPosition({ x: 0, y: 0 }, { x: 50, y: 50 }, small),
    ).toEqual({ x: 0, y: 0 });
  });
});
