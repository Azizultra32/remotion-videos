import type React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const remotionState = vi.hoisted(() => ({
  frame: 24,
  videoConfig: {
    durationInFrames: 240,
    fps: 24,
    height: 1080,
    width: 1920,
  },
}));

const useBeatsMock = vi.hoisted(() => vi.fn());

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
  Audio: ({ src }: { src: string }) => <div data-src={src} data-testid="audio" />,
  staticFile: (src: string) => `/static/${src}`,
  useCurrentFrame: () => remotionState.frame,
  useVideoConfig: () => remotionState.videoConfig,
}));

vi.mock("../hooks/useBeats", () => ({
  useBeats: (...args: unknown[]) => useBeatsMock(...args),
}));

const makeFakeBeats = () => ({
  beats: [],
  downbeats: [],
  drops: [],
  lastBeatBefore: () => null,
});

const loadMusicVideo = async (
  registry: Record<
    string,
    {
      id: string;
      category: "overlay" | "text" | "audio" | "shape" | "video";
      label: string;
      description: string;
      defaultDurationSec: number;
      defaultTrack: number;
      schema: z.ZodTypeAny;
      defaults: Record<string, unknown>;
      Renderer: React.FC<any>;
    }
  >,
) => {
  vi.resetModules();
  vi.doMock("./elements/registry", () => ({
    ELEMENT_REGISTRY: registry,
  }));
  return import("./MusicVideo");
};

describe("MusicVideo", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useBeatsMock.mockReset();
    useBeatsMock.mockReturnValue(makeFakeBeats());
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("renders only active elements and passes analysisAudioSrc while muting the internal Audio tag", async () => {
    const renderCalls: Array<{ elementId: string; audioSrc: string | null }> = [];
    const ActiveRenderer: React.FC<any> = ({ element, ctx }) => {
      renderCalls.push({ elementId: element.id, audioSrc: ctx.audioSrc });
      return <div data-audio-src={ctx.audioSrc ?? ""} data-testid="active">{element.id}</div>;
    };

    const { MusicVideo } = await loadMusicVideo({
      "test.active": {
        id: "test.active",
        category: "overlay",
        label: "Active",
        description: "test",
        defaultDurationSec: 1,
        defaultTrack: 1,
        schema: z.object({}),
        defaults: {},
        Renderer: ActiveRenderer,
      },
    });

    await act(async () => {
      root.render(
        <MusicVideo
          analysisAudioSrc="projects/demo/analysis.wav"
          assetRegistry={null}
          audioSrc="projects/demo/song.wav"
          backgroundColor="#000000"
          beatsSrc={null}
          elements={[
            {
              id: "active-1",
              label: "Active",
              props: {},
              startSec: 0,
              durationSec: 2,
              trackIndex: 1,
              type: "test.active",
            },
            {
              id: "inactive-1",
              label: "Inactive",
              props: {},
              startSec: 2,
              durationSec: 1,
              trackIndex: 2,
              type: "test.active",
            },
          ]}
          muteAudioTag
        />,
      );
    });

    expect(container.querySelectorAll('[data-testid="active"]')).toHaveLength(1);
    expect(container.textContent).toContain("active-1");
    expect(container.textContent).not.toContain("inactive-1");
    expect(renderCalls).toEqual([{ elementId: "active-1", audioSrc: "projects/demo/analysis.wav" }]);
    expect(container.querySelector('[data-testid="audio"]')).toBeNull();
  });

  it("keeps rendering good elements when unknown or broken elements are present and resolves asset-id audio", async () => {
    const GoodRenderer: React.FC<any> = ({ element }) => (
      <div data-testid="good">{element.id}</div>
    );
    const BrokenRenderer: React.FC<any> = () => {
      throw new Error("boom");
    };

    const { MusicVideo } = await loadMusicVideo({
      "test.good": {
        id: "test.good",
        category: "overlay",
        label: "Good",
        description: "test",
        defaultDurationSec: 1,
        defaultTrack: 1,
        schema: z.object({}),
        defaults: {},
        Renderer: GoodRenderer,
      },
      "test.broken": {
        id: "test.broken",
        category: "overlay",
        label: "Broken",
        description: "test",
        defaultDurationSec: 1,
        defaultTrack: 1,
        schema: z.object({}),
        defaults: {},
        Renderer: BrokenRenderer,
      },
    });

    await act(async () => {
      root.render(
        <MusicVideo
          assetRegistry={[
            {
              id: "ast_00000000000000aa",
              path: "projects/demo/song.wav",
              aliases: ["ast_00000000000000bb"],
            },
          ]}
          audioSrc="ast_00000000000000bb"
          backgroundColor="#111111"
          beatsSrc={null}
          elements={[
            {
              id: "unknown-1",
              label: "Unknown",
              props: {},
              startSec: 0,
              durationSec: 2,
              trackIndex: 1,
              type: "test.unknown",
            },
            {
              id: "broken-1",
              label: "Broken",
              props: {},
              startSec: 0,
              durationSec: 2,
              trackIndex: 2,
              type: "test.broken",
            },
            {
              id: "good-1",
              label: "Good",
              props: {},
              startSec: 0,
              durationSec: 2,
              trackIndex: 3,
              type: "test.good",
            },
          ]}
        />,
      );
    });

    expect(container.querySelector('[data-testid="audio"]')?.getAttribute("data-src")).toBe(
      "/static/projects/demo/song.wav",
    );
    expect(container.querySelectorAll('[data-testid="good"]')).toHaveLength(1);
    expect(container.textContent).toContain("good-1");
    expect(
      warnSpy.mock.calls.some(([msg]: [unknown]) =>
        String(msg).includes("unknown element type: test.unknown"),
      ),
    ).toBe(true);
    expect(
      warnSpy.mock.calls.some(([msg]: [unknown]) =>
        String(msg).includes("element broken-1 (test.broken) threw"),
      ),
    ).toBe(true);
  });
});
