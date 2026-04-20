import React, { useMemo } from "react";
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
import { WaveformViz } from "../components/WaveformViz";

export const videoWithTitleSchema = z.object({
  videoSrc: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  beatsSrc: z.string().optional(),
  beatStartOffsetSec: z.number().default(0),

  // Timing controls
  fadeInStartSec: z.number().default(0.5),
  fadeInEndSec: z.number().default(1.5),
  lineGrowStartSec: z.number().default(0.8),
  lineGrowEndSec: z.number().default(1.8),
  lineGrowWidth: z.number().default(80),

  // Scale controls
  titleScaleAmount: z.number().default(0.14),
  videoOpacityBase: z.number().default(0.08),
  videoScaleAmount: z.number().default(0.08),

  // SonarLogo controls
  sonarRing1ScaleMax: z.number().default(1.8),
  sonarRing2ScaleMax: z.number().default(2.6),
  sonarCoreSizeBase: z.number().default(14),
  sonarCoreSizePulse: z.number().default(6),

  // Waveform visualization
  showWaveform: z.boolean().default(false),
  waveformColor: z.string().default("rgba(255,255,255,0.6)"),
  waveformHeight: z.number().default(60),
  waveformPosition: z.enum(["top", "bottom"]).default("bottom"),
});

type BeatsFile = {
  duration: number;
  bpm_global: number;
  beats: number[];
  downbeats: number[];
};

const beatsCache = new Map<string, BeatsFile>();

const loadBeats = async (src: string): Promise<BeatsFile> => {
  const cached = beatsCache.get(src);
  if (cached) return cached;
  const res = await fetch(staticFile(src));
  const json = (await res.json()) as BeatsFile;
  beatsCache.set(src, json);
  return json;
};

const useBeats = (src: string | undefined): BeatsFile | null => {
  const [data, setData] = React.useState<BeatsFile | null>(
    src ? (beatsCache.get(src) ?? null) : null,
  );
  const [handle] = React.useState(() =>
    src && !beatsCache.get(src) ? delayRender(`beats:${src}`) : null,
  );

  React.useEffect(() => {
    if (!src || beatsCache.get(src)) {
      if (handle !== null) continueRender(handle);
      return;
    }
    loadBeats(src)
      .then((d) => {
        setData(d);
        if (handle !== null) continueRender(handle);
      })
      .catch((e) => {
        console.error(e);
        if (handle !== null) continueRender(handle);
      });
  }, [src, handle]);

  return data;
};

// Lower bound: index of first value >= t, via binary search.
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

const SonarLogo: React.FC<{
  beatPulse: number;
  downbeatFlash: number;
  ring1ScaleMax: number;
  ring2ScaleMax: number;
  coreSizeBase: number;
  coreSizePulse: number;
}> = ({ beatPulse, downbeatFlash, ring1ScaleMax, ring2ScaleMax, coreSizeBase, coreSizePulse }) => {
  // Two expanding rings offset in phase — one on beat, one on downbeat.
  const ring1Scale = 1 + beatPulse * ring1ScaleMax;
  const ring1Opacity = Math.max(0, 0.9 - beatPulse * 0.85);
  const ring2Scale = 1 + downbeatFlash * ring2ScaleMax;
  const ring2Opacity = Math.max(0, 0.8 - downbeatFlash * 0.75);
  const coreSize = coreSizeBase + beatPulse * coreSizePulse;
  const hueShift = downbeatFlash * 28;

  return (
    <div
      style={{
        position: "relative",
        width: 72,
        height: 72,
        marginBottom: 10,
      }}
    >
      {/* Expanding ring — beat */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          margin: "auto",
          width: 40,
          height: 40,
          top: 16,
          left: 16,
          borderRadius: "50%",
          border: "1.5px solid rgba(255,255,255,0.9)",
          transform: `scale(${ring1Scale})`,
          opacity: ring1Opacity,
        }}
      />
      {/* Expanding ring — downbeat */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          margin: "auto",
          width: 40,
          height: 40,
          top: 16,
          left: 16,
          borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.7)",
          transform: `scale(${ring2Scale})`,
          opacity: ring2Opacity,
        }}
      />
      {/* Static frame ring */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.35)",
        }}
      />
      {/* Core dot with subtle color shift on downbeat */}
      <div
        style={{
          position: "absolute",
          top: 36 - coreSize / 2,
          left: 36 - coreSize / 2,
          width: coreSize,
          height: coreSize,
          borderRadius: "50%",
          backgroundColor: "#fff",
          filter: `hue-rotate(${hueShift}deg) drop-shadow(0 0 ${beatPulse * 18}px rgba(255,255,255,0.9))`,
        }}
      />
    </div>
  );
};

export const VideoWithTitle: React.FC<z.infer<typeof videoWithTitleSchema>> = ({
  videoSrc,
  title,
  subtitle,
  beatsSrc,
  beatStartOffsetSec,
  fadeInStartSec,
  fadeInEndSec,
  lineGrowStartSec,
  lineGrowEndSec,
  lineGrowWidth,
  titleScaleAmount,
  videoOpacityBase,
  videoScaleAmount,
  sonarRing1ScaleMax,
  sonarRing2ScaleMax,
  sonarCoreSizeBase,
  sonarCoreSizePulse,
  showWaveform,
  waveformColor,
  waveformHeight,
  waveformPosition,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const beats = useBeats(beatsSrc);
  const timeSec = frame / fps + beatStartOffsetSec;

  const fadeIn = interpolate(frame, [fps * fadeInStartSec, fps * fadeInEndSec], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const { beatPulse, downbeatFlash } = useMemo(() => {
    if (!beats || beats.beats.length === 0) {
      return { beatPulse: 0, downbeatFlash: 0 };
    }
    const sinceBeat = timeSinceLastBeat(beats.beats, timeSec);
    const sinceDown = timeSinceLastBeat(beats.downbeats, timeSec);
    // Exponential decay from each beat — sharp attack, fast release.
    const beatPulse = sinceBeat >= 0 ? Math.exp(-sinceBeat * 8) : 0;
    const downbeatFlash = sinceDown >= 0 ? Math.exp(-sinceDown * 5) : 0;
    return { beatPulse, downbeatFlash };
  }, [beats, timeSec]);

  const lineGrow = interpolate(
    frame,
    [fps * lineGrowStartSec, fps * lineGrowEndSec],
    [0, lineGrowWidth],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const lineWidth = lineGrow + downbeatFlash * 140;
  const titleScale = 1 + beatPulse * titleScaleAmount;
  const lineOpacity = 0.85 + downbeatFlash * 0.15;
  const dotSize = 12 + beatPulse * 22;
  const dotGlow = beatPulse * 34;
  const letterSpacing = 0.22 + beatPulse * 0.08;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill
        style={{
          opacity: videoOpacityBase + beatPulse * 0.92,
          transform: `scale(${1 + beatPulse * videoScaleAmount + downbeatFlash * 0.04})`,
          transformOrigin: "center center",
        }}
      >
        <OffthreadVideo src={staticFile(videoSrc)} />
      </AbsoluteFill>
      {/* Watermark mask — covers "Vidu AI" bottom-right */}
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
          backgroundColor: "rgba(0,0,0,0.78)",
        }}
      />
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "flex-start",
          padding: "44px 52px",
          opacity: fadeIn,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            textShadow: "0 1px 4px rgba(0,0,0,0.6)",
            transform: `scale(${titleScale})`,
            transformOrigin: "left bottom",
          }}
        >
          <SonarLogo
            beatPulse={beatPulse}
            downbeatFlash={downbeatFlash}
            ring1ScaleMax={sonarRing1ScaleMax}
            ring2ScaleMax={sonarRing2ScaleMax}
            coreSizeBase={sonarCoreSizeBase}
            coreSizePulse={sonarCoreSizePulse}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: dotSize,
                height: dotSize,
                borderRadius: "50%",
                backgroundColor: "#fff",
                boxShadow: `0 0 ${dotGlow}px rgba(255,255,255,0.9)`,
              }}
            />
            <div
              style={{
                height: 2,
                width: lineWidth,
                backgroundColor: `rgba(255,255,255,${lineOpacity})`,
              }}
            />
          </div>
          <div
            style={{
              fontFamily: "'Helvetica Neue', Helvetica, Inter, system-ui, sans-serif",
              fontWeight: 300,
              fontSize: 34,
              letterSpacing: `${letterSpacing}em`,
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.95)",
              lineHeight: 1.3,
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                fontFamily: "'Helvetica Neue', Helvetica, Inter, system-ui, sans-serif",
                fontWeight: 300,
                fontSize: 18,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.65)",
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
      {showWaveform && beats && (
        <WaveformViz
          beats={beats.beats}
          duration={beats.duration}
          color={waveformColor}
          height={waveformHeight}
          position={waveformPosition}
          opacity={fadeIn}
        />
      )}
    </AbsoluteFill>
  );
};

export const defaultVideoWithTitleProps: z.infer<typeof videoWithTitleSchema> = {
  videoSrc: "dubfire-sake.mp4",
  title: "Your Title Here",
  subtitle: "Space Ibiza — 2013",
  beatsSrc: "dubfire-beats.json",
  beatStartOffsetSec: 0,
  fadeInStartSec: 0.5,
  fadeInEndSec: 1.5,
  lineGrowStartSec: 0.8,
  lineGrowEndSec: 1.8,
  lineGrowWidth: 80,
  titleScaleAmount: 0.14,
  videoOpacityBase: 0.08,
  videoScaleAmount: 0.08,
  sonarRing1ScaleMax: 1.8,
  sonarRing2ScaleMax: 2.6,
  sonarCoreSizeBase: 14,
  sonarCoreSizePulse: 6,
  showWaveform: false,
  waveformColor: "rgba(255,255,255,0.6)",
  waveformHeight: 60,
  waveformPosition: "bottom",
};
