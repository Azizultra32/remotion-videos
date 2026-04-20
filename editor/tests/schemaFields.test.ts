import { describe, expect, it } from "vitest";
import { isEasingField } from "../src/utils/schemaFields";

describe("isEasingField", () => {
  it("matches the bare 'easing' name", () => {
    expect(isEasingField("easing")).toBe(true);
    expect(isEasingField("Easing")).toBe(true);
    expect(isEasingField("EASING")).toBe(true);
  });

  it("matches names ending in 'Easing'", () => {
    expect(isEasingField("openEasing")).toBe(true);
    expect(isEasingField("closeEasing")).toBe(true);
    expect(isEasingField("zoomInEasing")).toBe(true);
  });

  it("matches names starting with 'ease'", () => {
    expect(isEasingField("easeIn")).toBe(true);
    expect(isEasingField("easeOut")).toBe(true);
    expect(isEasingField("easeInOut")).toBe(true);
  });

  it("does not match unrelated names", () => {
    expect(isEasingField("color")).toBe(false);
    expect(isEasingField("fontSize")).toBe(false);
    expect(isEasingField("startSec")).toBe(false);
    expect(isEasingField("increase")).toBe(false); // contains "ease" but not as prefix/suffix word
    expect(isEasingField("decrease")).toBe(false);
  });

  it("does not match empty or invalid input", () => {
    expect(isEasingField("")).toBe(false);
  });
});
