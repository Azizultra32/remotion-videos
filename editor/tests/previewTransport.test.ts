import { describe, expect, it } from "vitest";
import {
  shouldHardSeekAudio,
} from "../src/utils/previewTransport";

describe("preview transport heuristics", () => {
  it("does not hard-seek audio during normal playback drift", () => {
    expect(
      shouldHardSeekAudio({
        prev: { currentTimeSec: 10, isPlaying: true },
        state: { currentTimeSec: 10.2, isPlaying: true },
        audioDeltaSec: 0.2,
      }),
    ).toBe(false);
  });

  it("does hard-seek audio for explicit large jumps during playback", () => {
    expect(
      shouldHardSeekAudio({
        prev: { currentTimeSec: 10, isPlaying: true },
        state: { currentTimeSec: 12, isPlaying: true },
        audioDeltaSec: 1.2,
      }),
    ).toBe(true);
  });

  it("does hard-seek audio while paused scrubbing", () => {
    expect(
      shouldHardSeekAudio({
        prev: { currentTimeSec: 10, isPlaying: false },
        state: { currentTimeSec: 10.4, isPlaying: false },
        audioDeltaSec: 0.4,
      }),
    ).toBe(true);
  });
});
