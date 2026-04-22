import { useMemo } from "react";
import { useFFT, type FFTBands } from "../../hooks/useFFT";
import type { RenderCtx } from "./types";

export type ReactiveBandName = "bass" | "mid" | "highs";

export type ReactiveBands = {
  bass: number;
  mid: number;
  highs: number;
};

export type ReactiveBandState = ReactiveBands & {
  hasAudio: boolean;
  timeSec: number;
};

export const getRenderTimeSec = (frame: number, fps: number): number =>
  frame / Math.max(1, fps);

export const scaleReactiveBands = (
  bands: Pick<FFTBands, "bass" | "mid" | "highs"> | null | undefined,
  intensity = 1,
): ReactiveBands => ({
  bass: (bands?.bass ?? 0) * intensity,
  mid: (bands?.mid ?? 0) * intensity,
  highs: (bands?.highs ?? 0) * intensity,
});

export const selectReactiveBandValue = (
  bands: ReactiveBands,
  band: ReactiveBandName,
): number => bands[band];

export const useReactiveBands = ({
  ctx,
  intensity = 1,
  numberOfSamples = 256,
}: {
  ctx: RenderCtx;
  intensity?: number;
  numberOfSamples?: number;
}): ReactiveBandState => {
  const fft = useFFT({
    src: ctx.audioSrc ?? "",
    frame: ctx.frame,
    fps: ctx.fps,
    numberOfSamples,
    assetRegistry: ctx.assetRegistry,
  });

  const scaled = useMemo(
    () => scaleReactiveBands(fft, intensity),
    [fft?.bass, fft?.mid, fft?.highs, intensity],
  );

  return useMemo(
    () => ({
      ...scaled,
      hasAudio: Boolean(ctx.audioSrc && fft),
      timeSec: getRenderTimeSec(ctx.frame, ctx.fps),
    }),
    [ctx.audioSrc, ctx.frame, ctx.fps, fft, scaled],
  );
};
