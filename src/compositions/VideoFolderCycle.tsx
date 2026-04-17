import React from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

export const videoFolderCycleSchema = z.object({
  videos: z.array(z.string()).min(1),
  beatsSrc: z.string(),
  startSec: z.number().default(0),
  cutOn: z
    .enum(["every-beat", "downbeat", "drop", "breakdown-end"])
    .default("downbeat"),
  loopClips: z.boolean().default(true),
  muteVideos: z.boolean().default(true),
  backgroundColor: z.string().default("#000"),
});

type BreakdownRegion = { start: number; end: number };

type BeatsFile = {
  duration: number;
  bpm_global: number;
  beats: number[];
  downbeats: number[];
  drops?: number[];
  breakdowns?: BreakdownRegion[];
};

const beatsCache = new Map<string, BeatsFile>();

const useBeats = (src: string): BeatsFile | null => {
  const [data, setData] = React.useState<BeatsFile | null>(
    beatsCache.get(src) ?? null,
  );
  const [handle] = React.useState(() =>
    beatsCache.get(src) ? null : delayRender(`beats:${src}`),
  );

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

const resolveCutPoints = (
  beats: BeatsFile,
  cutOn: z.infer<typeof videoFolderCycleSchema>["cutOn"],
  afterSec: number,
): number[] => {
  let source: number[] = [];
  if (cutOn === "every-beat") source = beats.beats;
  else if (cutOn === "downbeat") source = beats.downbeats;
  else if (cutOn === "drop") source = beats.drops ?? [];
  else if (cutOn === "breakdown-end")
    source = (beats.breakdowns ?? []).map((b) => b.end);
  // Return only cut points at or after afterSec, sorted ascending.
  return source.filter((t) => t >= afterSec).sort((a, b) => a - b);
};

export const VideoFolderCycle: React.FC<
  z.infer<typeof videoFolderCycleSchema>
> = ({
  videos,
  beatsSrc,
  startSec,
  cutOn,
  loopClips,
  muteVideos,
  backgroundColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const beatsData = useBeats(beatsSrc);
  const absTime = startSec + frame / fps;

  if (!beatsData) {
    return <AbsoluteFill style={{ backgroundColor }} />;
  }

  // Cut points = the times at which the clip changes. startSec is always the
  // first "cut" (clip 0 begins here); then each subsequent cut-event advances
  // us to the next clip.
  const eventPoints = resolveCutPoints(beatsData, cutOn, startSec);

  // How many events have fired since startSec?
  const eventsElapsed = lowerBound(eventPoints, absTime + 1e-6);

  // Which clip are we on?
  const rawIdx = eventsElapsed; // clip 0 before first event, clip 1 after, etc.
  const clipIdx = loopClips
    ? rawIdx % videos.length
    : Math.min(rawIdx, videos.length - 1);

  // When did this particular clip start playing?
  const clipStartTime = rawIdx === 0 ? startSec : eventPoints[rawIdx - 1];

  // If loopClips is false and we've exhausted the list, freeze on the last clip
  // from its last available moment. Otherwise play each clip from its own 0.
  const clipElapsedSec = Math.max(0, absTime - clipStartTime);

  // key forces OffthreadVideo to remount on each cut so each clip begins at 0.
  return (
    <AbsoluteFill style={{ backgroundColor }}>
      <OffthreadVideo
        key={`${clipIdx}-${clipStartTime.toFixed(3)}`}
        src={staticFile(videos[clipIdx])}
        startFrom={Math.round(clipElapsedSec * fps)}
        muted={muteVideos}
      />
    </AbsoluteFill>
  );
};

export const defaultVideoFolderCycleProps: z.infer<
  typeof videoFolderCycleSchema
> = {
  videos: ["dubfire-sake.mp4"],
  beatsSrc: "dubfire-beats.json",
  startSec: 720,
  cutOn: "downbeat",
  loopClips: true,
  muteVideos: true,
  backgroundColor: "#000",
};
