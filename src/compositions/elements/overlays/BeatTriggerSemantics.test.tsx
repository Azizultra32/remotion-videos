import type React from "react";
import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBeatsAPI } from "../../../hooks/useBeats";
import { BeatColorFlashModule } from "./BeatColorFlash";
import { BeatImageCycleModule } from "./BeatImageCycle";
import { BeatVideoCycleModule } from "./BeatVideoCycle";

const remotionMockState = vi.hoisted(() => ({
  nextVideoInstanceId: 1,
  videoMounts: [] as number[],
  videoUnmounts: [] as number[],
}));

vi.mock("remotion", () => ({
  Img: ({ src, style }: { src: string; style?: React.CSSProperties }) => (
    <div data-src={src} data-style={JSON.stringify(style ?? {})} data-testid="img" />
  ),
  OffthreadVideo: ({
    muted,
    src,
    startFrom,
    style,
    volume,
  }: {
    muted?: boolean;
    src: string;
    startFrom?: number;
    style?: React.CSSProperties;
    volume?: number;
  }) => {
    const instanceIdRef = useRef<number | null>(null);
    if (instanceIdRef.current == null) {
      instanceIdRef.current = remotionMockState.nextVideoInstanceId++;
    }

    useEffect(() => {
      const instanceId = instanceIdRef.current;
      expect(instanceId).not.toBeNull();
      remotionMockState.videoMounts.push(instanceId as number);
      return () => {
        remotionMockState.videoUnmounts.push(instanceId as number);
      };
    }, []);

    return (
      <div
        data-instance-id={String(instanceIdRef.current)}
        data-muted={muted == null ? "" : String(muted)}
        data-src={src}
        data-start-from={startFrom == null ? "" : String(startFrom)}
        data-style={JSON.stringify(style ?? {})}
        data-testid="video"
        data-volume={volume == null ? "" : String(volume)}
      />
    );
  },
  Sequence: ({ children, from }: { children: React.ReactNode; from?: number }) => (
    <div data-sequence-from={from == null ? "" : String(from)} data-testid="sequence">
      {children}
    </div>
  ),
  staticFile: (src: string) => `/static/${src}`,
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
  fps: 20,
  frame: 0,
  height: 1080,
  width: 1920,
};

const baseElement = {
  durationSec: 10,
  id: "element-1",
  label: "Beat Test",
  startSec: 0,
  trackIndex: 7,
};

const buildCtx = ({
  beats = [],
  downbeats = beats,
  drops = beats,
  fps = 20,
  tSec,
}: {
  beats?: number[];
  downbeats?: number[];
  drops?: number[];
  fps?: number;
  tSec: number;
}) => ({
  ...baseCtx,
  absTimeSec: tSec,
  beats: makeBeatsAPI({ beats, downbeats, drops }),
  fps,
  frame: tSec * fps,
});

const readMockStyle = (node: Element | null) => {
  const value = node?.getAttribute("data-style");
  expect(value).toBeTruthy();
  return JSON.parse(value ?? "{}") as Record<string, unknown>;
};

describe("beat trigger helper contract", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    remotionMockState.nextVideoInstanceId = 1;
    remotionMockState.videoMounts = [];
    remotionMockState.videoUnmounts = [];
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

  describe("BeatColorFlash", () => {
    it("renders nothing when the trigger array is empty", async () => {
      await act(async () => {
        root.render(
          <BeatColorFlashModule.Renderer
            ctx={buildCtx({ beats: [], tSec: 0.4 })}
            element={{
              ...baseElement,
              props: {
                ...BeatColorFlashModule.defaults,
                color: "#ff0000",
                flashDurationSec: 0.2,
                maxOpacity: 0.8,
                triggerOn: "beats",
              },
              type: BeatColorFlashModule.id,
            }}
          />,
        );
      });

      expect(container.firstElementChild).toBeNull();
    });

    it("renders nothing before the first eligible trigger", async () => {
      await act(async () => {
        root.render(
          <BeatColorFlashModule.Renderer
            ctx={buildCtx({ beats: [0.5, 1], tSec: 0.25 })}
            element={{
              ...baseElement,
              props: {
                ...BeatColorFlashModule.defaults,
                flashDurationSec: 0.2,
                maxOpacity: 0.8,
                triggerOn: "beats",
              },
              type: BeatColorFlashModule.id,
            }}
          />,
        );
      });

      expect(container.firstElementChild).toBeNull();
    });

    it("skips non-everyNth triggers and fades from the most recent eligible trigger", async () => {
      await act(async () => {
        root.render(
          <BeatColorFlashModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3, 0.4, 0.5], tSec: 0.5 })}
            element={{
              ...baseElement,
              props: {
                ...BeatColorFlashModule.defaults,
                everyN: 2,
                flashDurationSec: 0.2,
                maxOpacity: 0.8,
                triggerOn: "beats",
              },
              type: BeatColorFlashModule.id,
            }}
          />,
        );
      });

      const flash = container.firstElementChild as HTMLDivElement | null;
      expect(flash).not.toBeNull();
      expect(Number(flash?.style.opacity ?? 0)).toBeCloseTo(0.4);
    });

    it("hits max opacity on the exact trigger frame", async () => {
      await act(async () => {
        root.render(
          <BeatColorFlashModule.Renderer
            ctx={buildCtx({ beats: [0.5], tSec: 0.5 })}
            element={{
              ...baseElement,
              props: {
                ...BeatColorFlashModule.defaults,
                flashDurationSec: 0.2,
                maxOpacity: 0.8,
                triggerOn: "beats",
              },
              type: BeatColorFlashModule.id,
            }}
          />,
        );
      });

      const flash = container.firstElementChild as HTMLDivElement | null;
      expect(flash).not.toBeNull();
      expect(Number(flash?.style.opacity ?? 0)).toBeCloseTo(0.8, 9);
    });
  });

  describe("BeatImageCycle", () => {
    it("renders nothing when the image list is empty", async () => {
      await act(async () => {
        root.render(
          <BeatImageCycleModule.Renderer
            ctx={buildCtx({ beats: [0.2], tSec: 0.3 })}
            element={{
              ...baseElement,
              props: {
                ...BeatImageCycleModule.defaults,
                images: [],
              },
              type: BeatImageCycleModule.id,
            }}
          />,
        );
      });

      expect(container.firstElementChild).toBeNull();
    });

    it("keeps the first image selected with zero opacity when the trigger array is empty", async () => {
      await act(async () => {
        root.render(
          <BeatImageCycleModule.Renderer
            ctx={buildCtx({ beats: [], tSec: 0.5 })}
            element={{
              ...baseElement,
              props: {
                ...BeatImageCycleModule.defaults,
                fadeSec: 0.4,
                images: ["a.png", "b.png"],
                triggerOn: "beats",
              },
              type: BeatImageCycleModule.id,
            }}
          />,
        );
      });

      const images = Array.from(container.querySelectorAll('[data-testid="img"]'));
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute("data-src")).toBe("/static/a.png");
      expect(Number(readMockStyle(images[0]).opacity)).toBe(0);
    });

    it("treats pre-first-trigger time as time since zero for the first image", async () => {
      await act(async () => {
        root.render(
          <BeatImageCycleModule.Renderer
            ctx={buildCtx({ beats: [0.5, 1], tSec: 0.2 })}
            element={{
              ...baseElement,
              props: {
                ...BeatImageCycleModule.defaults,
                fadeSec: 0.5,
                images: ["a.png", "b.png"],
                triggerOn: "beats",
              },
              type: BeatImageCycleModule.id,
            }}
          />,
        );
      });

      const images = Array.from(container.querySelectorAll('[data-testid="img"]'));
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute("data-src")).toBe("/static/a.png");
      expect(Number(readMockStyle(images[0]).opacity)).toBeCloseTo(0.4);
    });

    it("advances current and previous indices only on eligible everyNth triggers", async () => {
      const element = {
        ...baseElement,
        props: {
          ...BeatImageCycleModule.defaults,
          everyN: 2,
          fadeSec: 0.1,
          images: ["a.png", "b.png", "c.png"],
          triggerOn: "beats" as const,
        },
        type: BeatImageCycleModule.id,
      };

      await act(async () => {
        root.render(
          <BeatImageCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3, 0.4, 0.5], tSec: 0.25 })}
            element={element}
          />,
        );
      });

      let images = Array.from(container.querySelectorAll('[data-testid="img"]'));
      expect(images).toHaveLength(2);
      expect(images[0]?.getAttribute("data-src")).toBe("/static/a.png");
      expect(Number(readMockStyle(images[0]).opacity)).toBeCloseTo(0.5);
      expect(images[1]?.getAttribute("data-src")).toBe("/static/b.png");
      expect(Number(readMockStyle(images[1]).opacity)).toBeCloseTo(0.5);

      await act(async () => {
        root.render(
          <BeatImageCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3, 0.4, 0.5], tSec: 0.45 })}
            element={element}
          />,
        );
      });

      images = Array.from(container.querySelectorAll('[data-testid="img"]'));
      expect(images).toHaveLength(2);
      expect(images[0]?.getAttribute("data-src")).toBe("/static/b.png");
      expect(Number(readMockStyle(images[0]).opacity)).toBeCloseTo(0.5);
      expect(images[1]?.getAttribute("data-src")).toBe("/static/c.png");
      expect(Number(readMockStyle(images[1]).opacity)).toBeCloseTo(0.5);
    });

    it("uses downbeats by default instead of beats", async () => {
      await act(async () => {
        root.render(
          <BeatImageCycleModule.Renderer
            ctx={buildCtx({
              beats: [0.1, 0.2, 0.3],
              downbeats: [0.25],
              tSec: 0.26,
            })}
            element={{
              ...baseElement,
              props: {
                ...BeatImageCycleModule.defaults,
                fadeSec: 0,
                images: ["a.png", "b.png"],
              },
              type: BeatImageCycleModule.id,
            }}
          />,
        );
      });

      const images = Array.from(container.querySelectorAll('[data-testid="img"]'));
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute("data-src")).toBe("/static/b.png");
      expect(Number(readMockStyle(images[0]).opacity)).toBe(1);
    });

    it("advances from drops only when triggerOn is drops", async () => {
      await act(async () => {
        root.render(
          <BeatImageCycleModule.Renderer
            ctx={buildCtx({
              beats: [0.1, 0.2, 0.3],
              drops: [0.25],
              tSec: 0.26,
            })}
            element={{
              ...baseElement,
              props: {
                ...BeatImageCycleModule.defaults,
                fadeSec: 0,
                images: ["a.png", "b.png"],
                triggerOn: "drops",
              },
              type: BeatImageCycleModule.id,
            }}
          />,
        );
      });

      const images = Array.from(container.querySelectorAll('[data-testid="img"]'));
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute("data-src")).toBe("/static/b.png");
      expect(Number(readMockStyle(images[0]).opacity)).toBe(1);
    });

    it("starts cross-fading immediately on the exact trigger frame and collapses to one image when fadeSec is zero", async () => {
      const element = {
        ...baseElement,
        props: {
          ...BeatImageCycleModule.defaults,
          images: ["a.png", "b.png"],
          triggerOn: "beats" as const,
        },
        type: BeatImageCycleModule.id,
      };

      await act(async () => {
        root.render(
          <BeatImageCycleModule.Renderer
            ctx={buildCtx({ beats: [0.5], tSec: 0.5 })}
            element={{
              ...element,
              props: {
                ...element.props,
                fadeSec: 0.25,
              },
            }}
          />,
        );
      });

      let images = Array.from(container.querySelectorAll('[data-testid="img"]'));
      expect(images).toHaveLength(2);
      expect(images[0]?.getAttribute("data-src")).toBe("/static/a.png");
      expect(Number(readMockStyle(images[0]).opacity)).toBe(1);
      expect(images[1]?.getAttribute("data-src")).toBe("/static/b.png");
      expect(Number(readMockStyle(images[1]).opacity)).toBe(0);

      await act(async () => {
        root.render(
          <BeatImageCycleModule.Renderer
            ctx={buildCtx({ beats: [0.5], tSec: 0.5 })}
            element={{
              ...element,
              props: {
                ...element.props,
                fadeSec: 0,
              },
            }}
          />,
        );
      });

      images = Array.from(container.querySelectorAll('[data-testid="img"]'));
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute("data-src")).toBe("/static/b.png");
      expect(Number(readMockStyle(images[0]).opacity)).toBe(1);
    });

    it("supports deterministic seeded and weighted selection modes", async () => {
      const seededElement = {
        ...baseElement,
        props: {
          ...BeatImageCycleModule.defaults,
          fadeSec: 0,
          images: ["quiet.png", "hero.png", "accent.png"],
          selectionMode: "weighted-random" as const,
          selectionSeed: "chorus",
          selectionWeights: [1, 20, 1],
          triggerOn: "beats" as const,
        },
        type: BeatImageCycleModule.id,
      };

      await act(async () => {
        root.render(
          <BeatImageCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3], tSec: 0.3 })}
            element={seededElement}
          />,
        );
      });

      let images = Array.from(container.querySelectorAll('[data-testid="img"]'));
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute("data-src")).toBe("/static/hero.png");

      await act(async () => {
        root.render(
          <BeatImageCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3], tSec: 0.3 })}
            element={{
              ...seededElement,
              props: {
                ...seededElement.props,
                selectionMode: "seeded-random",
                selectionSeed: "drop-bank",
                selectionWeights: [],
              },
            }}
          />,
        );
      });

      images = Array.from(container.querySelectorAll('[data-testid="img"]'));
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute("data-src")).toBe("/static/accent.png");
    });
  });

  describe("BeatVideoCycle", () => {
    it("renders nothing when the video list is empty", async () => {
      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.2], tSec: 0.3 })}
            element={{
              ...baseElement,
              props: {
                ...BeatVideoCycleModule.defaults,
                videos: [],
              },
              type: BeatVideoCycleModule.id,
            }}
          />,
        );
      });

      expect(container.firstElementChild).toBeNull();
    });

    it("keeps the first video active with a stable base startFrom when the trigger array is empty", async () => {
      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [], fps: 10, tSec: 0.5 })}
            element={{
              ...baseElement,
              props: {
                ...BeatVideoCycleModule.defaults,
                startFromSec: 1,
                triggerOn: "beats",
                videos: ["a.mp4", "b.mp4"],
              },
              type: BeatVideoCycleModule.id,
            }}
          />,
        );
      });

      const video = container.querySelector('[data-testid="video"]');
      const sequence = container.querySelector('[data-testid="sequence"]');
      expect(video?.getAttribute("data-src")).toBe("/static/a.mp4");
      expect(video?.getAttribute("data-start-from")).toBe("10");
      expect(sequence?.getAttribute("data-sequence-from")).toBe("0");
    });

    it("treats pre-first-trigger time as a clip anchored at zero with a stable startFrom", async () => {
      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.6, 1], fps: 10, tSec: 0.2 })}
            element={{
              ...baseElement,
              props: {
                ...BeatVideoCycleModule.defaults,
                startFromSec: 0.5,
                triggerOn: "beats",
                videos: ["a.mp4", "b.mp4"],
              },
              type: BeatVideoCycleModule.id,
            }}
          />,
        );
      });

      const video = container.querySelector('[data-testid="video"]');
      const sequence = container.querySelector('[data-testid="sequence"]');
      expect(video?.getAttribute("data-src")).toBe("/static/a.mp4");
      expect(video?.getAttribute("data-start-from")).toBe("5");
      expect(sequence?.getAttribute("data-sequence-from")).toBe("0");
    });

    it("advances the current index only on eligible everyNth triggers and restarts by moving the clip window", async () => {
      const element = {
        ...baseElement,
        props: {
          ...BeatVideoCycleModule.defaults,
          everyN: 2,
          startFromSec: 1,
          triggerOn: "beats" as const,
          videos: ["a.mp4", "b.mp4", "c.mp4"],
        },
        type: BeatVideoCycleModule.id,
      };

      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3, 0.4, 0.5], fps: 10, tSec: 0.2 })}
            element={element}
          />,
        );
      });

      let video = container.querySelector('[data-testid="video"]');
      let sequence = container.querySelector('[data-testid="sequence"]');
      expect(video?.getAttribute("data-src")).toBe("/static/b.mp4");
      expect(video?.getAttribute("data-start-from")).toBe("10");
      expect(sequence?.getAttribute("data-sequence-from")).toBe("2");

      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3, 0.4, 0.5], fps: 10, tSec: 0.5 })}
            element={element}
          />,
        );
      });

      video = container.querySelector('[data-testid="video"]');
      sequence = container.querySelector('[data-testid="sequence"]');
      expect(video?.getAttribute("data-src")).toBe("/static/c.mp4");
      expect(video?.getAttribute("data-start-from")).toBe("10");
      expect(sequence?.getAttribute("data-sequence-from")).toBe("4");
    });

    it("does not switch clips before the first qualifying everyNth trigger and keeps playback anchored at zero", async () => {
      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3], fps: 10, tSec: 0.15 })}
            element={{
              ...baseElement,
              props: {
                ...BeatVideoCycleModule.defaults,
                everyN: 2,
                startFromSec: 1,
                triggerOn: "beats",
                videos: ["a.mp4", "b.mp4"],
              },
              type: BeatVideoCycleModule.id,
            }}
          />,
        );
      });

      const video = container.querySelector('[data-testid="video"]');
      const sequence = container.querySelector('[data-testid="sequence"]');
      expect(video?.getAttribute("data-src")).toBe("/static/a.mp4");
      expect(video?.getAttribute("data-start-from")).toBe("10");
      expect(sequence?.getAttribute("data-sequence-from")).toBe("0");
      expect(remotionMockState.videoMounts).toEqual([1]);
      expect(remotionMockState.videoUnmounts).toEqual([]);
    });

    it("keeps the same playback instance while time advances within a clip between qualifying triggers", async () => {
      const element = {
        ...baseElement,
        props: {
          ...BeatVideoCycleModule.defaults,
          everyN: 2,
          startFromSec: 1,
          triggerOn: "beats" as const,
          videos: ["a.mp4", "b.mp4", "c.mp4"],
        },
        type: BeatVideoCycleModule.id,
      };

      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3, 0.4], fps: 10, tSec: 0.22 })}
            element={element}
          />,
        );
      });

      const firstRenderVideo = container.querySelector('[data-testid="video"]');
      const firstSequence = container.querySelector('[data-testid="sequence"]');
      expect(firstRenderVideo?.getAttribute("data-src")).toBe("/static/b.mp4");
      expect(firstRenderVideo?.getAttribute("data-start-from")).toBe("10");
      expect(firstSequence?.getAttribute("data-sequence-from")).toBe("2");
      expect(firstRenderVideo?.getAttribute("data-instance-id")).toBe("1");
      expect(remotionMockState.videoMounts).toEqual([1]);
      expect(remotionMockState.videoUnmounts).toEqual([]);

      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3, 0.4], fps: 10, tSec: 0.35 })}
            element={element}
          />,
        );
      });

      const secondRenderVideo = container.querySelector('[data-testid="video"]');
      const secondSequence = container.querySelector('[data-testid="sequence"]');
      expect(secondRenderVideo).toBe(firstRenderVideo);
      expect(secondRenderVideo?.getAttribute("data-src")).toBe("/static/b.mp4");
      expect(secondRenderVideo?.getAttribute("data-start-from")).toBe("10");
      expect(secondSequence?.getAttribute("data-sequence-from")).toBe("2");
      expect(secondRenderVideo?.getAttribute("data-instance-id")).toBe("1");
      expect(remotionMockState.videoMounts).toEqual([1]);
      expect(remotionMockState.videoUnmounts).toEqual([]);
    });

    it("remounts and resets clip playback when the next qualifying trigger advances the cycle", async () => {
      const element = {
        ...baseElement,
        props: {
          ...BeatVideoCycleModule.defaults,
          everyN: 2,
          startFromSec: 1,
          triggerOn: "beats" as const,
          videos: ["a.mp4", "b.mp4", "c.mp4"],
        },
        type: BeatVideoCycleModule.id,
      };

      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3, 0.4], fps: 10, tSec: 0.35 })}
            element={element}
          />,
        );
      });

      const beforeSwitchVideo = container.querySelector('[data-testid="video"]');
      const beforeSwitchSequence = container.querySelector('[data-testid="sequence"]');
      expect(beforeSwitchVideo?.getAttribute("data-src")).toBe("/static/b.mp4");
      expect(beforeSwitchVideo?.getAttribute("data-start-from")).toBe("10");
      expect(beforeSwitchSequence?.getAttribute("data-sequence-from")).toBe("2");
      expect(beforeSwitchVideo?.getAttribute("data-instance-id")).toBe("1");

      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3, 0.4], fps: 10, tSec: 0.45 })}
            element={element}
          />,
        );
      });

      const afterSwitchVideo = container.querySelector('[data-testid="video"]');
      const afterSwitchSequence = container.querySelector('[data-testid="sequence"]');
      expect(afterSwitchVideo).not.toBe(beforeSwitchVideo);
      expect(afterSwitchVideo?.getAttribute("data-src")).toBe("/static/c.mp4");
      expect(afterSwitchVideo?.getAttribute("data-start-from")).toBe("10");
      expect(afterSwitchSequence?.getAttribute("data-sequence-from")).toBe("4");
      expect(afterSwitchVideo?.getAttribute("data-instance-id")).toBe("2");
      expect(remotionMockState.videoMounts).toEqual([1, 2]);
      expect(remotionMockState.videoUnmounts).toEqual([1]);
    });

    it("restarts a single-video collection on each eligible trigger", async () => {
      const element = {
        ...baseElement,
        props: {
          ...BeatVideoCycleModule.defaults,
          everyN: 1,
          startFromSec: 0.5,
          triggerOn: "beats" as const,
          videos: ["solo.mp4"],
        },
        type: BeatVideoCycleModule.id,
      };

      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3, 0.4], fps: 10, tSec: 0.15 })}
            element={element}
          />,
        );
      });

      const firstRenderVideo = container.querySelector('[data-testid="video"]');
      const firstSequence = container.querySelector('[data-testid="sequence"]');
      expect(firstRenderVideo?.getAttribute("data-src")).toBe("/static/solo.mp4");
      expect(firstRenderVideo?.getAttribute("data-start-from")).toBe("5");
      expect(firstSequence?.getAttribute("data-sequence-from")).toBe("1");
      expect(firstRenderVideo?.getAttribute("data-instance-id")).toBe("1");
      expect(remotionMockState.videoMounts).toEqual([1]);
      expect(remotionMockState.videoUnmounts).toEqual([]);

      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.1, 0.2, 0.3, 0.4], fps: 10, tSec: 0.35 })}
            element={element}
          />,
        );
      });

      const secondRenderVideo = container.querySelector('[data-testid="video"]');
      const secondSequence = container.querySelector('[data-testid="sequence"]');
      expect(secondRenderVideo).not.toBe(firstRenderVideo);
      expect(secondRenderVideo?.getAttribute("data-src")).toBe("/static/solo.mp4");
      expect(secondRenderVideo?.getAttribute("data-start-from")).toBe("5");
      expect(secondSequence?.getAttribute("data-sequence-from")).toBe("3");
      expect(secondRenderVideo?.getAttribute("data-instance-id")).toBe("2");
      expect(remotionMockState.videoMounts).toEqual([1, 2]);
      expect(remotionMockState.videoUnmounts).toEqual([1]);
    });

    it("uses downbeats by default instead of beats", async () => {
      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({
              beats: [0.1, 0.2, 0.3],
              downbeats: [0.25],
              fps: 20,
              tSec: 0.26,
            })}
            element={{
              ...baseElement,
              props: {
                ...BeatVideoCycleModule.defaults,
                startFromSec: 0.5,
                videos: ["a.mp4", "b.mp4"],
              },
              type: BeatVideoCycleModule.id,
            }}
          />,
        );
      });

      const video = container.querySelector('[data-testid="video"]');
      const sequence = container.querySelector('[data-testid="sequence"]');
      expect(video?.getAttribute("data-src")).toBe("/static/b.mp4");
      expect(video?.getAttribute("data-start-from")).toBe("10");
      expect(sequence?.getAttribute("data-sequence-from")).toBe("5");
    });

    it("advances from drops only when triggerOn is drops", async () => {
      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({
              beats: [0.1, 0.2, 0.3],
              drops: [0.25],
              fps: 20,
              tSec: 0.26,
            })}
            element={{
              ...baseElement,
              props: {
                ...BeatVideoCycleModule.defaults,
                startFromSec: 0.5,
                triggerOn: "drops",
                videos: ["a.mp4", "b.mp4"],
              },
              type: BeatVideoCycleModule.id,
            }}
          />,
        );
      });

      const video = container.querySelector('[data-testid="video"]');
      const sequence = container.querySelector('[data-testid="sequence"]');
      expect(video?.getAttribute("data-src")).toBe("/static/b.mp4");
      expect(video?.getAttribute("data-start-from")).toBe("10");
      expect(sequence?.getAttribute("data-sequence-from")).toBe("5");
    });

    it("advances immediately on the exact trigger frame", async () => {
      await act(async () => {
        root.render(
          <BeatVideoCycleModule.Renderer
            ctx={buildCtx({ beats: [0.5], fps: 20, tSec: 0.5 })}
            element={{
              ...baseElement,
              props: {
                ...BeatVideoCycleModule.defaults,
                startFromSec: 0.5,
                triggerOn: "beats",
                videos: ["a.mp4", "b.mp4"],
              },
              type: BeatVideoCycleModule.id,
            }}
          />,
        );
      });

      const video = container.querySelector('[data-testid="video"]');
      const sequence = container.querySelector('[data-testid="sequence"]');
      expect(video?.getAttribute("data-src")).toBe("/static/b.mp4");
      expect(video?.getAttribute("data-start-from")).toBe("10");
      expect(sequence?.getAttribute("data-sequence-from")).toBe("10");
    });
  });
});
