export type PreviewTransportState = {
  currentTimeSec: number;
  isPlaying: boolean;
};

// During active playback, let the standalone <audio> element free-run unless
// the store time jumped by an obviously intentional amount (seek/jump) or the
// transport just changed modes. Small/medium visual hitches should not turn
// into audible hard seeks.
export const shouldHardSeekAudio = ({
  state,
  prev,
  audioDeltaSec,
}: {
  state: PreviewTransportState;
  prev: PreviewTransportState;
  audioDeltaSec: number;
}): boolean => {
  if (!state.isPlaying || !prev.isPlaying) return audioDeltaSec > 0.05;
  return audioDeltaSec > 1;
};
