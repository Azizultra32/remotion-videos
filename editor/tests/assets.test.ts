import { describe, expect, it } from "vitest";
import {
  describeMediaFieldAction,
  findMediaFieldForKind,
  mediaFieldLabel,
} from "../src/utils/assets";

describe("asset media-field helpers", () => {
  it("prefers explicit field labels over humanized names", () => {
    expect(
      mediaFieldLabel({
        name: "videos",
        label: "Video collection",
      }),
    ).toBe("Video collection");
  });

  it("describes collection fields as add-to actions", () => {
    expect(
      describeMediaFieldAction({
        name: "images",
        label: "Image collection",
        multi: true,
        role: "collection",
      }),
    ).toBe("Add to Image collection");
  });

  it("keeps append/replace wording for regular fields", () => {
    expect(
      describeMediaFieldAction({
        name: "images",
        multi: true,
      }),
    ).toBe("Append to Images");

    expect(
      describeMediaFieldAction({
        name: "videoSrc",
        multi: false,
      }),
    ).toBe("Replace Video Src");
  });

  it("prefers a requested collection role when multiple same-kind fields exist", () => {
    expect(
      findMediaFieldForKind(
        [
          { name: "imageSrc", kind: "image" },
          { name: "images", kind: "image", multi: true, role: "collection" },
        ],
        "image",
        true,
        "collection",
      )?.name,
    ).toBe("images");
  });
});
