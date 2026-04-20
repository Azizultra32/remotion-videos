import React, { useMemo } from "react";
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

export const beatDropSchema = z.object({
  videoSrc: z.string(),
  beatsSrc: z.string(),
  startSec: z.number(),
  dropSec: z.number(),
  endSec: z.number(),
  words: z.array(z.string()),
  mode: z.enum(["cut", "flash"]),
  preDropFadeBeats: z.number().default(3),
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

const timeSinceLastBeat = (beats: number[], t: number): number => {
  if (beats.length === 0) return Infinity;
  const i = lowerBound(beats, t);
  const prev = i > 0 ? beats[i - 1] : -Infinity;
  return t - prev;
};

const countBeatsInRange = (beats: number[], from: number, to: number): number => {
  if (beats.length === 0 || to < from) return 0;
  const lo = lowerBound(beats, from);
  const hi = lowerBound(beats, to + 1e-6);
  return Math.max(0, hi - lo);
};

export const BeatDrop: React.FC<z.infer<typeof beatDropSchema>> = ({
  videoSrc,
  beatsSrc,
  startSec,
  dropSec,
  endSec: _endSec,
  words,
  mode,
  preDropFadeBeats,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const beatsData = useBeats(beatsSrc);

  const absTime = startSec + frame / fps;
  const inDrop = absTime >= dropSec;

  const {
    beatPulse,
    downbeatFlash,
    wordIndex,
    fadeMultiplier,
    inFadeWindow,
    fadeBeatIdx,
    sinceHoldStart,
  } = useMemo(() => {
    if (!beatsData) {
      return {
        beatPulse: 0,
        downbeatFlash: 0,
        wordIndex: 0,
        fadeMultiplier: 1,
        inFadeWindow: false,
        fadeBeatIdx: 0,
        sinceHoldStart: Infinity,
      };
    }
    const sinceBeat = timeSinceLastBeat(beatsData.beats, absTime);
    const sinceDown = timeSinceLastBeat(beatsData.downbeats, absTime);
    const beatPulse = sinceBeat >= 0 ? Math.exp(-sinceBeat * 8) : 0;
    const downbeatFlash = sinceDown >= 0 ? Math.exp(-sinceDown * 5) : 0;
    const beatsSinceDrop = countBeatsInRange(beatsData.beats, dropSec, absTime);
    const wordIndex = words.length > 0 ? Math.max(0, beatsSinceDrop - 1) % words.length : 0;

    // Two phases before the drop, both anchored to real detected beats:
    //   [drop-8 beats] -> [drop-4 beats]: slow linear fade 1 -> 0
    //   [drop-4 beats] -> [drop]         : hold at total black
    //   [drop]                           : words flash in
    const dropBeatIdx = lowerBound(beatsData.beats, dropSec);
    const fadeStartIdx = Math.max(0, dropBeatIdx - preDropFadeBeats * 2);
    const holdStartIdx = Math.max(0, dropBeatIdx - preDropFadeBeats);
    const fadeStartSec = beatsData.beats[fadeStartIdx] ?? dropSec;
    const holdStartSec = beatsData.beats[holdStartIdx] ?? dropSec;
    let fadeMultiplier = 1;
    let inFadeWindow = false;
    let fadeBeatIdx = 0;
    if (absTime >= holdStartSec) {
      fadeMultiplier = 0;
    } else if (absTime >= fadeStartSec) {
      const span = Math.max(0.001, holdStartSec - fadeStartSec);
      fadeMultiplier = 1 - (absTime - fadeStartSec) / span;
      inFadeWindow = true;
      fadeBeatIdx = countBeatsInRange(beatsData.beats, fadeStartSec, absTime);
    }
    const sinceHoldStart = absTime - holdStartSec;
    return {
      beatPulse,
      downbeatFlash,
      wordIndex,
      fadeMultiplier,
      inFadeWindow,
      fadeBeatIdx,
      sinceHoldStart,
    };
  }, [beatsData, absTime, dropSec, words, preDropFadeBeats]);

  // Opacity logic:
  //  - Normal region: black-base (0.08) + strong beat pulse.
  //  - Fade window (4 beats): keep a visible baseline so the slow fade actually
  //    reads over the full bar; each successive beat is dimmer than the last.
  //  - "Last contact" (final beat in the fade, right before black hold):
  //    distinct treatment — a longer, deeper dip so the image feels like
  //    it's being pulled into the drop. Scale does an inverse "zoom-out"
  //    breath and a subtle horizontal squeeze for a cinematic exhale.
  //  - Hold region: pure black.
  const lastBeatWindowSec = 0.15; // how close to -4 counts as "the last contact"
  const approachingLastBeat =
    inFadeWindow && sinceHoldStart > -lastBeatWindowSec && sinceHoldStart <= 0;
  const lastBeatProgress = approachingLastBeat
    ? 1 - Math.abs(sinceHoldStart) / lastBeatWindowSec
    : 0;

  let videoOpacity: number;
  let videoScale: number;
  if (inFadeWindow) {
    const baseline = 0.55 * fadeMultiplier; // visible floor so the fade reads
    const beatLift = beatPulse * 0.45 * fadeMultiplier;
    videoOpacity = baseline + beatLift;
    // Each beat in the fade window gets a subtly different scale signature so
    // the 4 beats feel like 4 distinct "breaths" tapering into black.
    const scaleByBeat = 1 + beatPulse * (0.1 - fadeBeatIdx * 0.02);
    // Final beat: invert — zoom OUT instead of in, cinematic pull-back.
    const finalBeatInverse = 1 - lastBeatProgress * 0.06;
    videoScale = scaleByBeat * finalBeatInverse;
  } else {
    videoOpacity = (0.08 + beatPulse * 0.92) * fadeMultiplier;
    videoScale = 1 + beatPulse * 0.08 + downbeatFlash * 0.04;
  }

  const wordTextOpacity = mode === "cut" ? 1 : beatPulse;
  const wordScale = mode === "cut" ? 1 : 0.96 + beatPulse * 0.06;
  const currentWord = words[wordIndex] ?? "";

  // Cinematic full-width: single huge word stretched horizontally
  // via SVG textLength + lengthAdjust="spacing" so every word fills the frame.
  const fontSize = Math.round(height * 0.72);
  const textLength = width * 0.94;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Video always mounted so audio plays through both phases */}
      <AbsoluteFill
        style={{
          opacity: inDrop ? 0 : videoOpacity,
          transform: inDrop ? "none" : `scale(${videoScale})`,
          transformOrigin: "center center",
        }}
      >
        <OffthreadVideo src={staticFile(videoSrc)} startFrom={Math.round(startSec * fps)} />
      </AbsoluteFill>
      {inDrop ? (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#000",
          }}
        >
          <svg
            role="img"
            aria-label="Beat drop visual"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{
              opacity: wordTextOpacity,
              transform: `scale(${wordScale})`,
              transformOrigin: "center center",
            }}
          >
            <text
              x="50%"
              y="50%"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="'Helvetica Neue', Helvetica, Inter, system-ui, sans-serif"
              fontWeight={200}
              fontSize={fontSize}
              fill="#ffffff"
              textLength={textLength}
              lengthAdjust="spacingAndGlyphs"
              style={{ textTransform: "uppercase" }}
            >
              {currentWord.toUpperCase()}
            </text>
          </svg>
        </AbsoluteFill>
      ) : null}
      {/* Watermark mask — kept in both phases */}
      <div
        style={{
          position: "absolute",
          right: 8,
          bottom: 8,
          width: 108,
          height: 30,
          borderRadius: 4,
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          backgroundColor: "rgba(0,0,0,0.95)",
        }}
      />
    </AbsoluteFill>
  );
};

export const defaultBeatDropProps: z.infer<typeof beatDropSchema> = {
  videoSrc: "dubfire-sake.mp4",
  beatsSrc: "dubfire-beats.json",
  startSec: 720,
  dropSec: 732.636,
  endSec: 750,
  words: ["BASS", "DROPS", "NOW", "PULSE", "LIGHT", "SPACE", "IBIZA", "TWENTY", "THIRTEEN"],
  mode: "flash",
  preDropFadeBeats: 4,
};
