import type React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBeatsAPI } from "../../../hooks/useBeats";
import { GifClipModule } from "./GifClip";
import { SpeedVideoModule } from "./SpeedVideo";
import { StaticImageModule } from "./StaticImage";
import { VideoClipModule } from "./VideoClip";

const remotionState = vi.hoisted(() => ({
  currentFrame: 0,
  videoConfig: {
    durationInFrames: 120,
    fps: 30,
  },
}));

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
  continueRender: vi.fn(),
  delayRender: vi.fn(() => 1),
  Img: ({ src, style }: { src: string; style?: React.CSSProperties }) => (
    <div data-src={src} data-style={JSON.stringify(style ?? {})} data-testid="img" />
  ),
  OffthreadVideo: ({
    muted,
    playbackRate,
    src,
    startFrom,
    style,
    volume,
  }: {
    muted?: boolean;
    playbackRate?: number;
    src: string;
    startFrom?: number;
    style?: React.CSSProperties;
    volume?: number;
  }) => (
    <div
      data-muted={muted == null ? "" : String(muted)}
      data-playback-rate={playbackRate == null ? "" : String(playbackRate)}
      data-src={src}
      data-start-from={startFrom == null ? "" : String(startFrom)}
      data-style={JSON.stringify(style ?? {})}
      data-testid="video"
      data-volume={volume == null ? "" : String(volume)}
    />
  ),
  interpolate: (
    value: number,
    input: [number, number],
    output: [number, number],
    options?: { extrapolateLeft?: "clamp" | "extend"; extrapolateRight?: "clamp" | "extend" },
  ) => {
    const [inputStart, inputEnd] = input;
    const [outputStart, outputEnd] = output;

    if (inputStart === inputEnd) {
      throw new Error("interpolateMock received a zero-length input range");
    }

    let progress = (value - inputStart) / (inputEnd - inputStart);

    if (value < inputStart && options?.extrapolateLeft === "clamp") {
      progress = 0;
    }

    if (value > inputEnd && options?.extrapolateRight === "clamp") {
      progress = 1;
    }

    return outputStart + (outputEnd - outputStart) * progress;
  },
  staticFile: (src: string) => `/static/${src}`,
  useCurrentFrame: () => remotionState.currentFrame,
  useVideoConfig: () => remotionState.videoConfig,
}));

vi.mock("@remotion/gif", () => ({
  Gif: ({
    fit,
    loopBehavior,
    playbackRate,
    src,
    style,
  }: {
    fit: string;
    loopBehavior: string;
    playbackRate: number;
    src: string;
    style?: React.CSSProperties;
  }) => (
    <div
      data-fit={fit}
      data-loop-behavior={loopBehavior}
      data-playback-rate={String(playbackRate)}
      data-src={src}
      data-style={JSON.stringify(style ?? {})}
      data-testid="gif"
    />
  ),
}));

const baseCtx = {
  absTimeSec: 0,
  assetRegistry: null,
  audioSrc: null,
  beats: makeBeatsAPI(null),
  beatsSrc: null,
  elementLocalSec: 0,
  elementProgress: 0,
  events: [],
  fps: 30,
  frame: 0,
  height: 1080,
  width: 1920,
};

const baseElement = {
  durationSec: 4,
  id: "element-1",
  label: "Media",
  startSec: 0,
  trackIndex: 6,
};

const readDataStyle = (node: Element | null) => {
  const value = node?.getAttribute("data-style");
  expect(value).toBeTruthy();
  return JSON.parse(value ?? "{}") as Record<string, unknown>;
};

describe("media runtime primitives", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    remotionState.currentFrame = 0;
    remotionState.videoConfig = {
      durationInFrames: 120,
      fps: 30,
    };

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

  it("keeps centered percent-box layout consistent across StaticImage, GifClip, and SpeedVideo", async () => {
    const layoutProps = {
      heightPct: 24,
      widthPct: 40,
      x: 35,
      y: 65,
    };

    await act(async () => {
      root.render(
        <>
          <StaticImageModule.Renderer
            ctx={baseCtx}
            element={{
              ...baseElement,
              props: {
                ...layoutProps,
                fadeInSec: 0.3,
                fadeOutSec: 0.3,
                fit: "contain",
                imageSrc: "poster.png",
                opacity: 1,
              },
              type: "overlay.staticImage",
            }}
          />
          <GifClipModule.Renderer
            ctx={baseCtx}
            element={{
              ...baseElement,
              props: {
                ...layoutProps,
                fadeInSec: 0.2,
                fadeOutSec: 0.2,
                fit: "contain",
                gifSrc: "clip.gif",
                loopBehavior: "loop",
                playbackRate: 1,
              },
              type: "overlay.gif",
            }}
          />
          <SpeedVideoModule.Renderer
            ctx={baseCtx}
            element={{
              ...baseElement,
              props: {
                ...layoutProps,
                fit: "cover",
                muted: true,
                opacity: 1,
                playbackRate: 1,
                scale: 1,
                startFromSec: 0,
                videoSrc: "speed.mp4",
                volume: 0,
              },
              type: "overlay.speedVideo",
            }}
          />
        </>,
      );
    });

    const wrappers = [
      container.querySelector('[data-testid="img"]')?.parentElement,
      container.querySelector('[data-testid="gif"]')?.parentElement,
      container.querySelector('[data-testid="video"]')?.parentElement,
    ];

    for (const wrapper of wrappers) {
      expect(wrapper).not.toBeNull();
      expect(wrapper?.style.position).toBe("absolute");
      expect(wrapper?.style.left).toBe("15%");
      expect(wrapper?.style.top).toBe("53%");
      expect(wrapper?.style.width).toBe("40%");
      expect(wrapper?.style.height).toBe("24%");
    }
  });

  it("keeps fill-media sizing/object-fit aligned across image and video renderers", async () => {
    await act(async () => {
      root.render(
        <>
          <StaticImageModule.Renderer
            ctx={baseCtx}
            element={{
              ...baseElement,
              props: {
                fadeInSec: 0.3,
                fadeOutSec: 0.3,
                fit: "contain",
                heightPct: 80,
                imageSrc: "poster.png",
                opacity: 1,
                widthPct: 80,
                x: 50,
                y: 50,
              },
              type: "overlay.staticImage",
            }}
          />
          <VideoClipModule.Renderer
            ctx={baseCtx}
            element={{
              ...baseElement,
              props: {
                beatBrightnessBoost: 0,
                beatBrightnessDecay: 5,
                muted: true,
                objectFit: "fill",
                opacity: 1,
                scale: 1,
                videoSrc: "clip.mp4",
                videoStartSec: 0,
              },
              type: "overlay.videoClip",
            }}
          />
          <SpeedVideoModule.Renderer
            ctx={baseCtx}
            element={{
              ...baseElement,
              props: {
                fit: "fill",
                heightPct: 100,
                muted: true,
                opacity: 1,
                playbackRate: 1,
                scale: 1,
                startFromSec: 0,
                videoSrc: "speed.mp4",
                volume: 0,
                widthPct: 100,
                x: 50,
                y: 50,
              },
              type: "overlay.speedVideo",
            }}
          />
        </>,
      );
    });

    const imageStyle = readDataStyle(container.querySelector('[data-testid="img"]'));
    const videoStyle = readDataStyle(
      container.querySelectorAll('[data-testid="video"]')[0] ?? null,
    );
    const speedVideoStyle = readDataStyle(
      container.querySelectorAll('[data-testid="video"]')[1] ?? null,
    );

    expect(imageStyle).toMatchObject({
      height: "100%",
      inset: 0,
      objectFit: "contain",
      position: "absolute",
      width: "100%",
    });
    expect(videoStyle).toEqual({
      height: "100%",
      objectFit: "fill",
      width: "100%",
    });
    expect(speedVideoStyle).toEqual({
      height: "100%",
      objectFit: "fill",
      width: "100%",
    });
  });

  it("uses GifClip's clamped fade envelope and treats zero fade windows as no fade", async () => {
    await act(async () => {
      root.render(
        <>
          <GifClipModule.Renderer
            ctx={{
              ...baseCtx,
              elementLocalSec: 0.5,
            }}
            element={{
              ...baseElement,
              durationSec: 4,
              props: {
                fadeInSec: 1,
                fadeOutSec: 1,
                fit: "contain",
                gifSrc: "clip.gif",
                heightPct: 80,
                loopBehavior: "loop",
                playbackRate: 1,
                widthPct: 80,
                x: 50,
                y: 50,
              },
              type: "overlay.gif",
            }}
          />
          <GifClipModule.Renderer
            ctx={{
              ...baseCtx,
              elementLocalSec: 2,
            }}
            element={{
              ...baseElement,
              durationSec: 4,
              props: {
                fadeInSec: 0,
                fadeOutSec: 0,
                fit: "cover",
                gifSrc: "full.gif",
                heightPct: 80,
                loopBehavior: "loop",
                playbackRate: 1,
                widthPct: 80,
                x: 50,
                y: 50,
              },
              type: "overlay.gif",
            }}
          />
        </>,
      );
    });

    const wrappers = Array.from(container.querySelectorAll('[data-testid="gif"]')).map(
      (node) => node.parentElement,
    );

    expect(wrappers[0]?.style.opacity).toBe("0.5");
    expect(wrappers[1]?.style.opacity).toBe("1");
  });

  it("uses StaticImage's delayed fade-out start when fade-in and fade-out overlap", async () => {
    await act(async () => {
      root.render(
        <StaticImageModule.Renderer
          ctx={{
            ...baseCtx,
            elementLocalSec: 1.25,
          }}
          element={{
            ...baseElement,
            durationSec: 1.5,
            props: {
              fadeInSec: 1,
              fadeOutSec: 1,
              fit: "cover",
              heightPct: 100,
              imageSrc: "poster.png",
              opacity: 1,
              widthPct: 100,
              x: 50,
              y: 50,
            },
            type: "overlay.staticImage",
          }}
        />,
      );
    });

    const imageStyle = readDataStyle(container.querySelector('[data-testid="img"]'));
    expect(imageStyle.opacity).toBeCloseTo(0.5, 9);
  });

  it("normalizes seconds to start frames by rounding, with SpeedVideo clamping negatives to zero", async () => {
    await act(async () => {
      root.render(
        <>
          <VideoClipModule.Renderer
            ctx={baseCtx}
            element={{
              ...baseElement,
              props: {
                beatBrightnessBoost: 0,
                beatBrightnessDecay: 5,
                muted: true,
                objectFit: "cover",
                opacity: 1,
                scale: 1,
                videoSrc: "clip.mp4",
                videoStartSec: 1.26,
              },
              type: "overlay.videoClip",
            }}
          />
          <SpeedVideoModule.Renderer
            ctx={baseCtx}
            element={{
              ...baseElement,
              props: {
                fit: "cover",
                heightPct: 100,
                muted: false,
                opacity: 1,
                playbackRate: 1,
                scale: 1,
                startFromSec: -0.4,
                videoSrc: "speed.mp4",
                volume: 0.6,
                widthPct: 100,
                x: 50,
                y: 50,
              },
              type: "overlay.speedVideo",
            }}
          />
        </>,
      );
    });

    const videos = container.querySelectorAll('[data-testid="video"]');

    expect(videos[0]?.getAttribute("data-start-from")).toBe("38");
    expect(videos[1]?.getAttribute("data-start-from")).toBe("0");
  });

  it("clamps SpeedVideo playbackRate to a minimum and forces muted volume to zero", async () => {
    await act(async () => {
      root.render(
        <>
          <SpeedVideoModule.Renderer
            ctx={baseCtx}
            element={{
              ...baseElement,
              props: {
                ...SpeedVideoModule.defaults,
                muted: true,
                playbackRate: 0,
                startFromSec: 1.24,
                videoSrc: "muted.mp4",
                volume: 0.8,
              },
              type: "overlay.speedVideo",
            }}
          />
          <SpeedVideoModule.Renderer
            ctx={baseCtx}
            element={{
              ...baseElement,
              props: {
                ...SpeedVideoModule.defaults,
                muted: false,
                playbackRate: 2,
                startFromSec: 0,
                videoSrc: "audible.mp4",
                volume: 0.65,
              },
              type: "overlay.speedVideo",
            }}
          />
        </>,
      );
    });

    const videos = container.querySelectorAll('[data-testid="video"]');

    expect(videos[0]?.getAttribute("data-playback-rate")).toBe("0.001");
    expect(videos[0]?.getAttribute("data-start-from")).toBe("37");
    expect(videos[0]?.getAttribute("data-volume")).toBe("0");

    expect(videos[1]?.getAttribute("data-playback-rate")).toBe("2");
    expect(videos[1]?.getAttribute("data-volume")).toBe("0.65");
  });

  it("applies SpeedVideo opacity and scale through the shared wrapper effect style", async () => {
    await act(async () => {
      root.render(
        <SpeedVideoModule.Renderer
          ctx={baseCtx}
          element={{
            ...baseElement,
            props: {
              ...SpeedVideoModule.defaults,
              fit: "cover",
              heightPct: 60,
              opacity: 0.35,
              playbackRate: 1,
              scale: 1.25,
              startFromSec: 0,
              videoSrc: "styled.mp4",
              volume: 0.8,
              widthPct: 60,
              x: 50,
              y: 50,
            },
            type: "overlay.speedVideo",
          }}
        />,
      );
    });

    const wrapper = container.querySelector('[data-testid="video"]')?.parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.style.opacity).toBe("0.35");
    expect(wrapper?.style.transform).toBe("scale(1.25)");
  });

  it("applies VideoClip beat brightness as a wrapper filter after the last beat", async () => {
    await act(async () => {
      root.render(
        <VideoClipModule.Renderer
          ctx={{
            ...baseCtx,
            absTimeSec: 1.25,
            beats: makeBeatsAPI({
              beats: [1],
            }),
          }}
          element={{
            ...baseElement,
            startSec: 0.5,
            props: {
              ...VideoClipModule.defaults,
              beatBrightnessBoost: 2,
              beatBrightnessDecay: 4,
              muted: true,
              objectFit: "cover",
              opacity: 1,
              scale: 1,
              videoSrc: "clip.mp4",
              videoStartSec: 0,
            },
            type: "overlay.videoClip",
          }}
        />,
      );
    });

    const wrapper = container.querySelector('[data-testid="video"]')?.parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.style.filter).toBe(`brightness(${1 + 2 * Math.exp(-1)})`);
  });
});
