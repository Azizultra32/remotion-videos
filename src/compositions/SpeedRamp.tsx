import React from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  interpolate,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

export const speedRampSchema = z.object({
  videoSrc: z.string(),
  energySrc: z.string(),
  energyFps: z.number().default(24),
  startSec: z.number().default(0),
  endSec: z.number().default(30),
  minSpeed: z.number().min(0.05).max(10).default(0.25),
  maxSpeed: z.number().min(0.05).max(10).default(2.0),
  // Optional fixed calibration. If omitted, we use the min/max of the energy
  // window covered by [startSec, endSec] so quietest-in-window → minSpeed,
  // loudest-in-window → maxSpeed.
  minEnergy: z.number().optional(),
  maxEnergy: z.number().optional(),
  muteVideo: z.boolean().default(false),
  backgroundColor: z.string().default("#000"),
});

const energyCache = new Map<string, number[]>();

const useEnergy = (src: string): number[] | null => {
  const [data, setData] = React.useState<number[] | null>(energyCache.get(src) ?? null);
  const [handle] = React.useState(() =>
    energyCache.get(src) ? null : delayRender(`energy:${src}`),
  );

  React.useEffect(() => {
    if (energyCache.get(src)) {
      if (handle !== null) continueRender(handle);
      return;
    }
    fetch(staticFile(src))
      .then((r) => r.json())
      .then((json: number[]) => {
        energyCache.set(src, json);
        setData(json);
        if (handle !== null) continueRender(handle);
      })
      .catch((e) => {
        console.error(e);
        if (handle !== null) continueRender(handle);
      });
  }, [src, handle]);

  return data;
};

const sampleEnergyAt = (energy: number[], energyFps: number, t: number): number => {
  if (energy.length === 0) return 0;
  const idx = Math.max(0, Math.min(energy.length - 1, Math.round(t * energyFps)));
  return energy[idx];
};

export const SpeedRamp: React.FC<z.infer<typeof speedRampSchema>> = ({
  videoSrc,
  energySrc,
  energyFps,
  startSec,
  endSec,
  minSpeed,
  maxSpeed,
  minEnergy,
  maxEnergy,
  muteVideo,
  backgroundColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const energy = useEnergy(energySrc);

  // Precompute cumulative source-time offset per composition frame so the
  // mapping comp-frame → source-time is stable and monotonic for this render.
  const cumulativeSourceOffset = React.useMemo(() => {
    if (!energy) return null;

    const totalFrames = Math.max(1, Math.ceil((endSec - startSec) * fps));

    // Determine energy range for mapping.
    let lo = minEnergy;
    let hi = maxEnergy;
    if (lo === undefined || hi === undefined) {
      const startIdx = Math.max(0, Math.floor(startSec * energyFps));
      const endIdx = Math.min(energy.length, Math.ceil(endSec * energyFps));
      let localMin = Infinity;
      let localMax = -Infinity;
      for (let i = startIdx; i < endIdx; i++) {
        const v = energy[i];
        if (v < localMin) localMin = v;
        if (v > localMax) localMax = v;
      }
      if (!Number.isFinite(localMin)) localMin = 0;
      if (!Number.isFinite(localMax)) localMax = 1;
      if (localMax === localMin) localMax = localMin + 1e-6;
      if (lo === undefined) lo = localMin;
      if (hi === undefined) hi = localMax;
    }

    const arr = new Float64Array(totalFrames + 1);
    arr[0] = 0;
    for (let i = 1; i <= totalFrames; i++) {
      const compTimeAtFrame = (i - 0.5) / fps; // midpoint of frame
      const e = sampleEnergyAt(energy, energyFps, startSec + compTimeAtFrame);
      const speed = interpolate(e, [lo!, hi!], [minSpeed, maxSpeed], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      arr[i] = arr[i - 1] + speed / fps;
    }
    return arr;
  }, [energy, energyFps, startSec, endSec, fps, minSpeed, maxSpeed, minEnergy, maxEnergy]);

  if (!energy || !cumulativeSourceOffset) {
    return <AbsoluteFill style={{ backgroundColor }} />;
  }

  const idx = Math.min(cumulativeSourceOffset.length - 1, Math.max(0, frame));
  const sourceTime = startSec + cumulativeSourceOffset[idx];
  const startFromFrames = Math.max(0, Math.round(sourceTime * fps));

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      <OffthreadVideo src={staticFile(videoSrc)} startFrom={startFromFrames} muted={muteVideo} />
    </AbsoluteFill>
  );
};

export const defaultSpeedRampProps: z.infer<typeof speedRampSchema> = {
  videoSrc: "dubfire-sake.mp4",
  energySrc: "dubfire-energy-24fps.json",
  energyFps: 24,
  startSec: 720,
  endSec: 750,
  minSpeed: 0.5,
  maxSpeed: 1.5,
  muteVideo: false,
  backgroundColor: "#000",
};
