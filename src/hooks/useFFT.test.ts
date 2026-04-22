import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFFT } from "./useFFT";

const useWindowedAudioDataMock = vi.fn();
const visualizeAudioMock = vi.fn();
const staticFileMock = vi.fn((src: string) => `/static/${src}`);

vi.mock("@remotion/media-utils", () => ({
  useWindowedAudioData: (...args: unknown[]) => useWindowedAudioDataMock(...args),
  visualizeAudio: (...args: unknown[]) => visualizeAudioMock(...args),
}));

vi.mock("remotion", () => ({
  staticFile: (src: string) => staticFileMock(src),
}));

describe("useFFT", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useWindowedAudioDataMock.mockReset();
    visualizeAudioMock.mockReset();
    staticFileMock.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("routes missing src through the silent data URI and returns null bands", async () => {
    useWindowedAudioDataMock.mockReturnValue({
      audioData: null,
      dataOffsetInSeconds: 0,
    });

    const Probe = () => {
      const fft = useFFT({
        src: null,
        frame: 24,
        fps: 24,
      });
      return React.createElement("pre", { "data-testid": "fft" }, JSON.stringify(fft));
    };

    await act(async () => {
      root.render(React.createElement(Probe));
    });

    expect(useWindowedAudioDataMock).toHaveBeenCalledWith({
      src: expect.stringMatching(/^data:audio\/wav;base64,/),
      frame: 24,
      fps: 24,
      windowInSeconds: 3,
    });
    expect(staticFileMock).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="fft"]')?.textContent).toBe("null");
  });

  it("resolves real sources and computes FFT bands when audio data exists", async () => {
    useWindowedAudioDataMock.mockReturnValue({
      audioData: { mock: true },
      dataOffsetInSeconds: 0.25,
    });
    visualizeAudioMock.mockReturnValue([0.2, 0.4, 0.8]);

    const Probe = () => {
      const fft = useFFT({
        src: "projects/demo/song.wav",
        frame: 12,
        fps: 24,
        numberOfSamples: 128,
      });
      return React.createElement("pre", { "data-testid": "fft" }, JSON.stringify(fft));
    };

    await act(async () => {
      root.render(React.createElement(Probe));
    });

    expect(staticFileMock).toHaveBeenCalledWith("projects/demo/song.wav");
    expect(useWindowedAudioDataMock).toHaveBeenCalledWith({
      src: "/static/projects/demo/song.wav",
      frame: 12,
      fps: 24,
      windowInSeconds: 3,
    });
    expect(visualizeAudioMock).toHaveBeenCalledWith({
      fps: 24,
      frame: 12,
      audioData: { mock: true },
      numberOfSamples: 128,
      smoothing: true,
      optimizeFor: "speed",
      dataOffsetInSeconds: 0.25,
    });
    expect(container.querySelector('[data-testid="fft"]')?.textContent).toBe(
      JSON.stringify({
        bins: [1, 1, 1],
        raw: [0.2, 0.4, 0.8],
        bass: 1,
        mid: 1,
        highs: 1,
      }),
    );
  });

  it("resolves asset-id audio sources through the asset registry", async () => {
    useWindowedAudioDataMock.mockReturnValue({
      audioData: null,
      dataOffsetInSeconds: 0,
    });

    const Probe = () => {
      useFFT({
        src: "ast_00000000000000bb",
        frame: 8,
        fps: 24,
        assetRegistry: [
          {
            id: "ast_00000000000000aa",
            path: "projects/demo/song.wav",
            aliases: ["ast_00000000000000bb"],
          },
        ],
      });
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
    });

    expect(useWindowedAudioDataMock).toHaveBeenCalledWith({
      src: "/static/projects/demo/song.wav",
      frame: 8,
      fps: 24,
      windowInSeconds: 3,
    });
  });
});
