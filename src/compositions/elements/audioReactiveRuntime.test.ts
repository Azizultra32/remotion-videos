import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRenderTimeSec,
  scaleReactiveBands,
  selectReactiveBandValue,
  useReactiveBands,
} from "./audioReactiveRuntime";

const useFFTMock = vi.fn();

vi.mock("../../hooks/useFFT", () => ({
  useFFT: (...args: unknown[]) => useFFTMock(...args),
}));

describe("audioReactiveRuntime", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useFFTMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  describe("getRenderTimeSec", () => {
    it("derives render time from frame and fps with a guarded fps floor", () => {
      expect(getRenderTimeSec(48, 24)).toBe(2);
      expect(getRenderTimeSec(12, 0)).toBe(12);
    });
  });

  describe("scaleReactiveBands", () => {
    it("scales bass/mid/high bands by intensity", () => {
      expect(
        scaleReactiveBands(
          {
            bass: 0.2,
            mid: 0.4,
            highs: 0.6,
          },
          2,
        ),
      ).toEqual({
        bass: 0.4,
        mid: 0.8,
        highs: 1.2,
      });
    });

    it("falls back to zeros when FFT data is unavailable", () => {
      expect(scaleReactiveBands(null, 3)).toEqual({
        bass: 0,
        mid: 0,
        highs: 0,
      });
    });
  });

  describe("selectReactiveBandValue", () => {
    it("returns the requested reactive band level", () => {
      const bands = {
        bass: 0.1,
        mid: 0.5,
        highs: 0.9,
      };

      expect(selectReactiveBandValue(bands, "bass")).toBe(0.1);
      expect(selectReactiveBandValue(bands, "mid")).toBe(0.5);
      expect(selectReactiveBandValue(bands, "highs")).toBe(0.9);
    });
  });

  describe("useReactiveBands", () => {
    it("maps useFFT output into scaled reactive state", async () => {
      useFFTMock.mockReturnValue({
        bass: 0.25,
        mid: 0.5,
        highs: 0.75,
      });

      const ctx = {
        audioSrc: "projects/demo/song.wav",
        assetRegistry: [{ id: "ast_canonical", path: "projects/demo/song.wav" }],
        beats: null,
        beatsSrc: null,
        elementLocalSec: 0,
        elementProgress: 0,
        events: [],
        fps: 24,
        frame: 48,
        height: 1080,
        width: 1920,
        absTimeSec: 2,
      } as never;

      const Probe = () => {
        const reactive = useReactiveBands({ ctx, intensity: 2, numberOfSamples: 512 });
        return React.createElement(
          "pre",
          { "data-testid": "reactive" },
          JSON.stringify(reactive),
        );
      };

      await act(async () => {
        root.render(React.createElement(Probe));
      });

      expect(useFFTMock).toHaveBeenCalledWith({
        src: "projects/demo/song.wav",
        frame: 48,
        fps: 24,
        numberOfSamples: 512,
        assetRegistry: [{ id: "ast_canonical", path: "projects/demo/song.wav" }],
      });
      expect(container.querySelector('[data-testid="reactive"]')?.textContent).toBe(
        JSON.stringify({
          bass: 0.5,
          mid: 1,
          highs: 1.5,
          hasAudio: true,
          timeSec: 2,
        }),
      );
    });

    it("reports no-audio state when fft data is unavailable", async () => {
      useFFTMock.mockReturnValue(null);

      const ctx = {
        audioSrc: null,
        assetRegistry: null,
        beats: null,
        beatsSrc: null,
        elementLocalSec: 0,
        elementProgress: 0,
        events: [],
        fps: 30,
        frame: 15,
        height: 1080,
        width: 1920,
        absTimeSec: 0.5,
      } as never;

      const Probe = () => {
        const reactive = useReactiveBands({ ctx });
        return React.createElement(
          "pre",
          { "data-testid": "reactive" },
          JSON.stringify(reactive),
        );
      };

      await act(async () => {
        root.render(React.createElement(Probe));
      });

      expect(container.querySelector('[data-testid="reactive"]')?.textContent).toBe(
        JSON.stringify({
          bass: 0,
          mid: 0,
          highs: 0,
          hasAudio: false,
          timeSec: 0.5,
        }),
      );
    });
  });
});
