import type React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBeatsAPI } from "../../../hooks/useBeats";
import { MediaBlendCompositeModule } from "./MediaBlendComposite";

vi.mock("remotion", () => ({
  AbsoluteFill: ({
    children,
    style,
  }: {
    children: React.ReactNode;
    style?: React.CSSProperties;
  }) => (
    <div data-testid="absolute-fill" style={style}>
      {children}
    </div>
  ),
  Img: ({ src, style }: { src: string; style?: React.CSSProperties }) => (
    <div data-src={src} data-style={JSON.stringify(style ?? {})} data-testid="img" />
  ),
  OffthreadVideo: () => null,
  staticFile: (src: string) => `/static/${src}`,
}));

vi.mock("@remotion/gif", () => ({
  Gif: () => null,
}));

const ctx = {
  absTimeSec: 0,
  assetRegistry: null,
  audioSrc: null,
  beats: makeBeatsAPI(null),
  beatsSrc: null,
  elementLocalSec: 0.4,
  elementProgress: 0,
  events: [],
  fps: 30,
  frame: 12,
  height: 1080,
  width: 1920,
};

describe("MediaBlendComposite", () => {
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

  it("renders base and blend layers with routed blend effects", async () => {
    await act(async () => {
      root.render(
        <MediaBlendCompositeModule.Renderer
          ctx={ctx}
          element={{
            id: "blend-1",
            type: "overlay.mediaBlend",
            label: "Blend",
            trackIndex: 8,
            startSec: 0,
            durationSec: 4,
            props: {
              baseImageSrc: "base.png",
              blendImageSrc: "blend.png",
              fit: "cover",
              x: 50,
              y: 50,
              widthPct: 100,
              heightPct: 100,
              fadeInSec: 0.2,
              fadeOutSec: 0.2,
              blendMode: "screen",
              blendOpacity: 0.6,
              effects: [
                { type: "blur", px: 8 },
                { type: "brightness", amount: 1.4 },
              ],
            },
          }}
        />,
      );
    });

    const images = Array.from(container.querySelectorAll('[data-testid="img"]'));
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute("data-src")).toBe("/static/base.png");
    expect(images[1]?.getAttribute("data-src")).toBe("/static/blend.png");

    const layerWrappers = images.map((node) => node.parentElement);
    expect(layerWrappers[0]?.style.position).toBe("absolute");
    expect(layerWrappers[0]?.style.inset).toBe("0px");
    expect(layerWrappers[1]?.style.mixBlendMode).toBe("screen");
    expect(layerWrappers[1]?.style.opacity).toBe("0.6");
    expect(layerWrappers[1]?.style.filter).toBe("blur(8px) brightness(1.4)");
  });

  it("resolves asset ids and aliases through the registry", async () => {
    await act(async () => {
      root.render(
        <MediaBlendCompositeModule.Renderer
          ctx={{
            ...ctx,
            assetRegistry: [
              {
                id: "ast_00000000000000aa",
                path: "projects/demo/images/base.png",
                aliases: ["ast_00000000000000bb"],
              },
              {
                id: "ast_00000000000000cc",
                path: "projects/demo/images/blend.png",
              },
            ],
          }}
          element={{
            id: "blend-2",
            type: "overlay.mediaBlend",
            label: "Blend",
            trackIndex: 8,
            startSec: 0,
            durationSec: 4,
            props: {
              ...MediaBlendCompositeModule.defaults,
              baseImageSrc: "ast_00000000000000bb",
              blendImageSrc: "ast_00000000000000cc",
            },
          }}
        />,
      );
    });

    const images = Array.from(container.querySelectorAll('[data-testid="img"]'));
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute("data-src")).toBe("/static/projects/demo/images/base.png");
    expect(images[1]?.getAttribute("data-src")).toBe("/static/projects/demo/images/blend.png");
  });
});
