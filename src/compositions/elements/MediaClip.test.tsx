import type React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaClip } from "./MediaClip";

vi.mock("remotion", () => ({
  Img: ({ src, style }: { src: string; style?: React.CSSProperties }) => (
    <div
      data-kind="image"
      data-src={src}
      data-style={JSON.stringify(style ?? {})}
      data-testid="media-clip"
    />
  ),
  OffthreadVideo: ({
    src,
    startFrom,
    playbackRate,
    muted,
    volume,
    style,
  }: {
    src: string;
    startFrom?: number;
    playbackRate?: number;
    muted?: boolean;
    volume?: number;
    style?: React.CSSProperties;
  }) => (
    <div
      data-kind="video"
      data-muted={muted == null ? "" : String(muted)}
      data-playback-rate={playbackRate == null ? "" : String(playbackRate)}
      data-src={src}
      data-start-from={startFrom == null ? "" : String(startFrom)}
      data-style={JSON.stringify(style ?? {})}
      data-testid="media-clip"
      data-volume={volume == null ? "" : String(volume)}
    />
  ),
}));

vi.mock("@remotion/gif", () => ({
  Gif: ({
    src,
    fit,
    playbackRate,
    loopBehavior,
    style,
  }: {
    src: string;
    fit?: string;
    playbackRate: number;
    loopBehavior: string;
    style?: React.CSSProperties;
  }) => (
    <div
      data-fit={fit ?? ""}
      data-kind="gif"
      data-loop-behavior={loopBehavior}
      data-playback-rate={String(playbackRate)}
      data-src={src}
      data-style={JSON.stringify(style ?? {})}
      data-testid="media-clip"
    />
  ),
}));

const readStyle = (node: Element | null) => {
  const value = node?.getAttribute("data-style");
  expect(value).toBeTruthy();
  return JSON.parse(value ?? "{}") as Record<string, unknown>;
};

describe("MediaClip", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders still images through the image branch with fit-aware style", async () => {
    await act(async () => {
      root.render(
        <MediaClip
          source={{ kind: "image", src: "/static/poster.png" }}
          fit="contain"
          style={{ opacity: 0.5, position: "absolute" }}
        />,
      );
    });

    const node = container.querySelector('[data-testid="media-clip"]');
    expect(node?.getAttribute("data-kind")).toBe("image");
    expect(node?.getAttribute("data-src")).toBe("/static/poster.png");
    expect(readStyle(node)).toMatchObject({
      width: "100%",
      height: "100%",
      objectFit: "contain",
      opacity: 0.5,
      position: "absolute",
    });
  });

  it("renders GIF clips through the gif branch and preserves playback props", async () => {
    await act(async () => {
      root.render(
        <MediaClip
          source={{
            kind: "gif",
            src: "/static/clip.gif",
            playbackRate: 1.5,
            loopBehavior: "pause-after-finish",
          }}
          fit="cover"
        />,
      );
    });

    const node = container.querySelector('[data-testid="media-clip"]');
    expect(node?.getAttribute("data-kind")).toBe("gif");
    expect(node?.getAttribute("data-src")).toBe("/static/clip.gif");
    expect(node?.getAttribute("data-fit")).toBe("cover");
    expect(node?.getAttribute("data-playback-rate")).toBe("1.5");
    expect(node?.getAttribute("data-loop-behavior")).toBe("pause-after-finish");
    expect(readStyle(node)).toMatchObject({
      width: "100%",
      height: "100%",
    });
  });

  it("renders video clips through the video branch and preserves timing/audio props", async () => {
    await act(async () => {
      root.render(
        <MediaClip
          source={{
            kind: "video",
            src: "/static/clip.mp4",
            startFromFrame: 42,
            playbackRate: 0.75,
            muted: false,
            volume: 0.6,
          }}
          fit="fill"
        />,
      );
    });

    const node = container.querySelector('[data-testid="media-clip"]');
    expect(node?.getAttribute("data-kind")).toBe("video");
    expect(node?.getAttribute("data-src")).toBe("/static/clip.mp4");
    expect(node?.getAttribute("data-start-from")).toBe("42");
    expect(node?.getAttribute("data-playback-rate")).toBe("0.75");
    expect(node?.getAttribute("data-muted")).toBe("false");
    expect(node?.getAttribute("data-volume")).toBe("0.6");
    expect(readStyle(node)).toMatchObject({
      width: "100%",
      height: "100%",
      objectFit: "fill",
    });
  });
});
