import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBeatsAPI } from "../../../hooks/useBeats";
import { BeatDropWordsModule } from "./BeatDropWords";

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
  durationSec: 10,
  id: "beat-drop-1",
  label: "Beat Drop",
  startSec: 1,
  trackIndex: 1,
  type: BeatDropWordsModule.id,
};

describe("BeatDropWords", () => {
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

  it("renders nothing before the first trigger inside the element window", async () => {
    await act(async () => {
      root.render(
        <BeatDropWordsModule.Renderer
          ctx={{
            ...baseCtx,
            absTimeSec: 0.8,
            beats: makeBeatsAPI({
              beats: [0.5, 0.7],
            }),
          }}
          element={{
            ...baseElement,
            props: BeatDropWordsModule.defaults,
          }}
        />,
      );
    });

    expect(container.firstElementChild).toBeNull();
  });

  it("cycles words from triggers inside the element window only", async () => {
    await act(async () => {
      root.render(
        <BeatDropWordsModule.Renderer
          ctx={{
            ...baseCtx,
            absTimeSec: 1.45,
            beats: makeBeatsAPI({
              beats: [0.5, 1.1, 1.3],
            }),
          }}
          element={{
            ...baseElement,
            props: {
              ...BeatDropWordsModule.defaults,
              mode: "cut",
              words: ["ONE", "TWO", "THREE"],
            },
          }}
        />,
      );
    });

    expect(container.textContent).toContain("TWO");
  });

  it("uses downbeats only when configured and decays opacity in flash mode", async () => {
    await act(async () => {
      root.render(
        <BeatDropWordsModule.Renderer
          ctx={{
            ...baseCtx,
            absTimeSec: 1.5,
            beats: makeBeatsAPI({
              beats: [1.1, 1.2, 1.3],
              downbeats: [1.25],
            }),
          }}
          element={{
            ...baseElement,
            props: {
              ...BeatDropWordsModule.defaults,
              decay: 4,
              mode: "flash",
              useDownbeatsOnly: true,
              words: ["ONE", "TWO"],
            },
          }}
        />,
      );
    });

    expect(container.textContent).toContain("ONE");
    const textShell = container.querySelectorAll("div")[1] as HTMLDivElement | undefined;
    expect(textShell).toBeDefined();
    expect(Number(textShell?.style.opacity ?? 0)).toBeCloseTo(Math.exp(-1), 9);
  });
});
