import React from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

export const imageOnBeatSchema = z.object({
  images: z.array(z.string()).min(1),
  beatsSrc: z.string(),
  startSec: z.number().default(0),
  changeEveryNBeats: z.number().int().min(1).default(1),
  useDownbeats: z.boolean().default(false),
  transition: z.enum(["cut", "crossfade", "flash"]).default("cut"),
  transitionDurationMs: z.number().min(0).default(120),
  fit: z.enum(["cover", "contain"]).default("cover"),
  backgroundColor: z.string().default("#000"),
});

type BeatsFile = {
  duration: number;
  bpm_global: number;
  beats: number[];
  downbeats: number[];
};

const beatsCache = new Map<string, BeatsFile>();

const useBeats = (src: string): BeatsFile | null => {
  const [data, setData] = React.useState<BeatsFile | null>(beatsCache.get(src) ?? null);
  const [handle] = React.useState(() => (beatsCache.get(src) ? null : delayRender(`beats:${src}`)));

  React.useEffect(() => {
    if (beatsCache.get(src)) {
      if (handle !== null) continueRender(handle);
      return;
    }
    fetch(staticFile(src))
      .then((r) => r.json())
      .then((json: BeatsFile) => {
        beatsCache.set(src, json);
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

const lowerBound = (arr: number[], t: number): number => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const countBeatsInRange = (arr: number[], from: number, to: number): number => {
  if (arr.length === 0 || to < from) return 0;
  const lo = lowerBound(arr, from);
  const hi = lowerBound(arr, to + 1e-6);
  return Math.max(0, hi - lo);
};

export const ImageOnBeat: React.FC<z.infer<typeof imageOnBeatSchema>> = ({
  images,
  beatsSrc,
  startSec,
  changeEveryNBeats,
  useDownbeats,
  transition,
  transitionDurationMs,
  fit,
  backgroundColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const beatsData = useBeats(beatsSrc);
  const absTime = startSec + frame / fps;

  if (!beatsData) {
    return <AbsoluteFill style={{ backgroundColor }} />;
  }

  const beatsArray = useDownbeats ? beatsData.downbeats : beatsData.beats;
  const startIdx = lowerBound(beatsArray, startSec);
  const beatsSinceStart = countBeatsInRange(beatsArray, startSec, absTime);

  const changeStep = Math.max(1, Math.floor(changeEveryNBeats));
  const currentStep = Math.floor(beatsSinceStart / changeStep);
  const imageIdx = currentStep % images.length;
  const nextIdx = (imageIdx + 1) % images.length;

  // Time of the last image change (for transition animation).
  const lastChangeBeatIdx = startIdx + currentStep * changeStep;
  const lastChangeTime =
    lastChangeBeatIdx < beatsArray.length ? beatsArray[lastChangeBeatIdx] : startSec;
  const timeSinceChange = Math.max(0, absTime - lastChangeTime);
  const transitionProgress =
    transitionDurationMs > 0 ? Math.min(1, (timeSinceChange * 1000) / transitionDurationMs) : 1;

  const imgStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: fit,
  };

  if (transition === "cut") {
    return (
      <AbsoluteFill style={{ backgroundColor }}>
        <Img src={staticFile(images[imageIdx])} style={imgStyle} />
      </AbsoluteFill>
    );
  }

  if (transition === "crossfade") {
    const outgoingOpacity = interpolate(transitionProgress, [0, 1], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const incomingOpacity = interpolate(transitionProgress, [0, 1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    // When transition completes we just show the current image so we don't
    // waste a frame blending a fully-opaque next image on top.
    if (transitionProgress >= 1) {
      return (
        <AbsoluteFill style={{ backgroundColor }}>
          <Img src={staticFile(images[imageIdx])} style={imgStyle} />
        </AbsoluteFill>
      );
    }
    const prevIdx = (imageIdx - 1 + images.length) % images.length;
    return (
      <AbsoluteFill style={{ backgroundColor }}>
        <AbsoluteFill style={{ opacity: outgoingOpacity }}>
          <Img src={staticFile(images[prevIdx])} style={imgStyle} />
        </AbsoluteFill>
        <AbsoluteFill style={{ opacity: incomingOpacity }}>
          <Img src={staticFile(images[imageIdx])} style={imgStyle} />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  // transition === "flash"
  const flashOpacity = interpolate(transitionProgress, [0, 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor }}>
      <Img src={staticFile(images[imageIdx])} style={imgStyle} />
      <AbsoluteFill style={{ backgroundColor: "#fff", opacity: flashOpacity }} />
    </AbsoluteFill>
  );
};

export const defaultImageOnBeatProps: z.infer<typeof imageOnBeatSchema> = {
  images: ["dubfire-still.png"],
  beatsSrc: "dubfire-beats.json",
  startSec: 720,
  changeEveryNBeats: 4,
  useDownbeats: false,
  transition: "cut",
  transitionDurationMs: 120,
  fit: "cover",
  backgroundColor: "#000",
};
