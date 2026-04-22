import type React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBeatsAPI } from "../../../hooks/useBeats";
import LottieClipModule from "./LottieClip";

const { continueRenderMock, delayRenderMock } = vi.hoisted(() => ({
  continueRenderMock: vi.fn<(handle: number) => void>(),
  delayRenderMock: vi.fn<(label?: string) => number>(),
}));

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="absolute-fill" style={style}>
      {children}
    </div>
  ),
  continueRender: continueRenderMock,
  delayRender: delayRenderMock,
  interpolate: (value: number, input: [number, number], output: [number, number]) => {
    const [inputStart, inputEnd] = input;
    const [outputStart, outputEnd] = output;

    if (value <= inputStart) return outputStart;
    if (value >= inputEnd) return outputEnd;

    const progress = (value - inputStart) / (inputEnd - inputStart);
    return outputStart + (outputEnd - outputStart) * progress;
  },
  staticFile: (src: string) => `/static/${src}`,
}));

vi.mock("@remotion/lottie", () => ({
  Lottie: ({
    animationData,
    playbackRate,
  }: {
    animationData: unknown;
    playbackRate: number;
  }) => (
    <div data-playback-rate={String(playbackRate)} data-testid="lottie">
      {JSON.stringify(animationData)}
    </div>
  ),
}));

type DeferredResponse = {
  promise: Promise<Response>;
  reject: (reason?: unknown) => void;
  resolve: (value: Response) => void;
};

const deferredResponse = (): DeferredResponse => {
  let resolve!: (value: Response) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
};

const pendingFetches = new Map<string, DeferredResponse>();
const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  const request = deferredResponse();
  const url = String(input);
  pendingFetches.set(url, request);

  const signal = init?.signal;
  signal?.addEventListener("abort", () => {
    request.reject(new DOMException("Aborted", "AbortError"));
  });

  return request.promise;
});

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
  durationSec: 3,
  id: "lottie-1",
  label: "Lottie",
  props: {
    direction: "forward" as const,
    fadeInSec: 0,
    fadeOutSec: 0,
    heightPct: 80,
    jsonSrc: "first.json",
    loop: true,
    playbackRate: 1,
    widthPct: 80,
    x: 50,
    y: 50,
  },
  startSec: 0,
  trackIndex: 6,
  type: "overlay.lottie",
};

describe("LottieClip", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    delayRenderMock.mockReset();
    continueRenderMock.mockReset();
    fetchMock.mockClear();
    pendingFetches.clear();
    let nextHandle = 0;
    delayRenderMock.mockImplementation(() => {
      nextHandle += 1;
      return nextHandle;
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", fetchMock);

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

  it("blocks the initial render until the first Lottie JSON load resolves", async () => {
    await act(async () => {
      root.render(<LottieClipModule.Renderer ctx={baseCtx} element={baseElement} />);
    });

    expect(delayRenderMock).toHaveBeenNthCalledWith(1, "Loading Lottie JSON");
    expect(delayRenderMock).toHaveBeenNthCalledWith(
      2,
      "Loading Lottie JSON from /static/first.json",
    );
    expect(container.querySelector('[data-testid="lottie"]')).toBeNull();

    const firstRequest = pendingFetches.get("/static/first.json");
    expect(firstRequest).toBeDefined();

    await act(async () => {
      firstRequest?.resolve({
        json: async () => ({ name: "first" }),
        ok: true,
      } as Response);
      await Promise.resolve();
    });

    expect(continueRenderMock).toHaveBeenCalledWith(2);
    expect(continueRenderMock).toHaveBeenCalledWith(1);
    expect(container.textContent).toContain('"name":"first"');
  });

  it("creates a fresh delayRender handle when jsonSrc changes", async () => {
    await act(async () => {
      root.render(<LottieClipModule.Renderer ctx={baseCtx} element={baseElement} />);
    });

    await act(async () => {
      const firstRequest = pendingFetches.get("/static/first.json");
      expect(firstRequest).toBeDefined();

      firstRequest?.resolve({
        json: async () => ({ name: "first" }),
        ok: true,
      } as Response);
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        <LottieClipModule.Renderer
          ctx={baseCtx}
          element={{
            ...baseElement,
            props: {
              ...baseElement.props,
              jsonSrc: "second.json",
            },
          }}
        />,
      );
    });

    expect(delayRenderMock).toHaveBeenNthCalledWith(
      3,
      "Loading Lottie JSON from /static/second.json",
    );
    expect(container.querySelector('[data-testid="lottie"]')).toBeNull();

    const secondRequest = pendingFetches.get("/static/second.json");
    expect(secondRequest).toBeDefined();

    await act(async () => {
      secondRequest?.resolve({
        json: async () => ({ name: "second" }),
        ok: true,
      } as Response);
      await Promise.resolve();
    });

    expect(continueRenderMock).toHaveBeenCalledWith(3);
    expect(container.textContent).toContain('"name":"second"');
  });

  it("does not refetch when only assetRegistry identity changes but the resolved URL stays the same", async () => {
    await act(async () => {
      root.render(<LottieClipModule.Renderer ctx={baseCtx} element={baseElement} />);
    });

    await act(async () => {
      const firstRequest = pendingFetches.get("/static/first.json");
      expect(firstRequest).toBeDefined();

      firstRequest?.resolve({
        json: async () => ({ name: "first" }),
        ok: true,
      } as Response);
      await Promise.resolve();
    });

    const priorDelayRenderCalls = delayRenderMock.mock.calls.length;
    const priorFetchCalls = fetchMock.mock.calls.length;

    await act(async () => {
      root.render(
        <LottieClipModule.Renderer
          ctx={{
            ...baseCtx,
            assetRegistry: [{ id: "ast_demo", path: "unrelated.json" }],
          }}
          element={baseElement}
        />,
      );
    });

    expect(delayRenderMock.mock.calls.length).toBe(priorDelayRenderCalls);
    expect(fetchMock.mock.calls.length).toBe(priorFetchCalls);
    expect(container.textContent).toContain('"name":"first"');
  });

  it("clamps invalid playbackRate values before rendering Lottie", async () => {
    await act(async () => {
      root.render(
        <LottieClipModule.Renderer
          ctx={baseCtx}
          element={{
            ...baseElement,
            props: {
              ...baseElement.props,
              playbackRate: 0,
            },
          }}
        />,
      );
    });

    await act(async () => {
      const firstRequest = pendingFetches.get("/static/first.json");
      expect(firstRequest).toBeDefined();

      firstRequest?.resolve({
        json: async () => ({ name: "first" }),
        ok: true,
      } as Response);
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="lottie"]')?.getAttribute("data-playback-rate"),
    ).toBe("0.1");
  });
});
