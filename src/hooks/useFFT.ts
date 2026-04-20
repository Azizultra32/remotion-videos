import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";
import { useMemo } from "react";
import { staticFile } from "remotion";

export type FFTBands = {
  bins: number[];
  bass: number;
  mid: number;
  highs: number;
  raw: number[];
};

const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length);

const db = (v: number) => {
  if (v <= 0) return 0;
  const dB = 20 * Math.log10(v);
  return Math.max(0, Math.min(1, (dB + 100) / 70));
};

export type UseFFTArgs = {
  src: string;
  frame: number;
  fps: number;
  numberOfSamples?: number;
  windowInSeconds?: number;
  smoothing?: boolean;
};

export const useFFT = ({
  src,
  frame,
  fps,
  numberOfSamples = 64,
  // Tight window — the Player decodes this slice on every seek. 30s on a
  // 128 MB mp3 stalls the audio clock; 3s is plenty for FFT continuity.
  windowInSeconds = 3,
  smoothing = true,
}: UseFFTArgs): FFTBands | null => {
  const resolved = useMemo(
    () => (src.startsWith("http") || src.startsWith("/") ? src : staticFile(src)),
    [src],
  );

  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: resolved,
    frame,
    fps,
    windowInSeconds,
  });

  return useMemo(() => {
    if (!audioData) return null;
    const raw = visualizeAudio({
      fps,
      frame,
      audioData,
      numberOfSamples,
      smoothing,
      optimizeFor: "speed",
      dataOffsetInSeconds,
    });
    const bins = raw.map(db);
    const third = Math.max(1, Math.floor(bins.length / 3));
    return {
      bins,
      raw,
      bass: avg(bins.slice(0, third)),
      mid: avg(bins.slice(third, third * 2)),
      highs: avg(bins.slice(third * 2)),
    };
  }, [audioData, dataOffsetInSeconds, frame, fps, numberOfSamples, smoothing]);
};
