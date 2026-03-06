import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

export const countdownTimerSchema = z.object({
  from: z.number().default(3),
  finalText: z.string().default("GO!"),
  style: z.enum(["minimal", "cinematic", "neon", "glitch"]).default("cinematic"),
  backgroundColor: zColor().default("#000000"),
  textColor: zColor().default("#ffffff"),
  accentColor: zColor().default("#ff4757"),
  showCircle: z.boolean().default(true),
  framesPerCount: z.number().default(30),
});

export type CountdownTimerProps = z.infer<typeof countdownTimerSchema>;

export const defaultCountdownTimerProps: CountdownTimerProps = {
  from: 3,
  finalText: "GO!",
  style: "cinematic",
  backgroundColor: "#000000",
  textColor: "#ffffff",
  accentColor: "#ff4757",
  showCircle: true,
  framesPerCount: 30,
};

const getSafeTiming = (from: number, framesPerCount: number) => {
  const safeFrom = Math.max(0, Math.floor(from));
  const safeFramesPerCount = Math.max(1, Math.floor(framesPerCount));

  return {
    safeFrom,
    safeFramesPerCount,
    durationInFrames: (safeFrom + 1) * safeFramesPerCount,
  };
};

export const calculateCountdownTimerMetadata: CalculateMetadataFunction<
  CountdownTimerProps
> = ({ props }) => {
  const parsed = countdownTimerSchema.parse(props ?? {});
  const { durationInFrames } = getSafeTiming(parsed.from, parsed.framesPerCount);

  return {
    durationInFrames,
  };
};

const interpolateClamp = (
  input: number,
  inputRange: number[],
  outputRange: number[]
) => {
  return interpolate(input, inputRange, outputRange, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

const GlitchText: React.FC<{
  text: string;
  localFrame: number;
  segmentProgress: number;
  frame: number;
  textColor: string;
}> = ({ text, localFrame, segmentProgress, frame, textColor }) => {
  const bandCount = 6;
  const containerHeight = 320;
  const bandHeight = containerHeight / bandCount;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 1300,
        height: containerHeight,
        transform: "translateZ(0)",
      }}
    >
      {Array.from({ length: bandCount }).map((_, bandIndex) => {
        const direction = bandIndex % 2 === 0 ? 1 : -1;
        const bandFrame = localFrame - bandIndex * 2;
        const displacement = interpolateClamp(
          bandFrame,
          [0, 3, 8, 14],
          [0, direction * 42, direction * -24, 0]
        );
        const residualKick =
          ((frame + bandIndex * 13) % 9 === 0 ? direction * 8 : 0) *
          interpolateClamp(segmentProgress, [0, 0.35], [1, 0]);

        return (
          <div
            key={bandIndex}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: bandIndex * bandHeight,
              height: bandHeight,
              overflow: "hidden",
              transform: `translateX(${displacement + residualKick}px)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -(bandIndex * bandHeight),
                left: 0,
                right: 0,
                textAlign: "center",
                fontSize: 260,
                lineHeight: "320px",
                fontWeight: 900,
                letterSpacing: 4,
                color: textColor,
                fontFamily: "system-ui, -apple-system, sans-serif",
                textShadow:
                  "-6px 0 rgba(255, 40, 90, 0.85), 6px 0 rgba(20, 210, 255, 0.85)",
              }}
            >
              {text}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const NeonParticles: React.FC<{ frame: number; accentColor: string }> = ({
  frame,
  accentColor,
}) => {
  const particleCount = 14;

  return (
    <div
      style={{
        position: "absolute",
        width: 0,
        height: 0,
      }}
    >
      {Array.from({ length: particleCount }).map((_, index) => {
        const angleDeg = (frame * 3 + index * (360 / particleCount)) % 360;
        const angleRad = (angleDeg * Math.PI) / 180;
        const orbitRadius = 280 + Math.sin((frame + index * 5) * 0.08) * 12;
        const x = Math.cos(angleRad) * orbitRadius;
        const y = Math.sin(angleRad) * orbitRadius;
        const twinkle = ((frame + index * 7) % 12) < 3 ? 0.35 : 1;
        const scale = interpolateClamp(
          Math.sin((frame + index * 6) * 0.08),
          [-1, 1],
          [0.65, 1.4]
        );

        return (
          <div
            key={index}
            style={{
              position: "absolute",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: accentColor,
              transform: `translate(${x}px, ${y}px) scale(${scale})`,
              opacity: twinkle,
              boxShadow: `0 0 12px ${accentColor}`,
            }}
          />
        );
      })}
    </div>
  );
};

export const CountdownTimer: React.FC<CountdownTimerProps> = (inputProps) => {
  const props = countdownTimerSchema.parse(inputProps);
  const {
    from,
    finalText,
    style,
    backgroundColor,
    textColor,
    accentColor,
    showCircle,
    framesPerCount,
  } = props;

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const { safeFrom, safeFramesPerCount } = getSafeTiming(from, framesPerCount);
  const countSegment = Math.floor(frame / safeFramesPerCount);
  const segmentIndex = Math.min(safeFrom, countSegment);
  const localFrame = frame - segmentIndex * safeFramesPerCount;
  const segmentProgress = interpolateClamp(
    localFrame,
    [0, Math.max(1, safeFramesPerCount - 1)],
    [0, 1]
  );

  const isFinal = segmentIndex >= safeFrom;
  const displayText = isFinal ? finalText : String(safeFrom - segmentIndex);

  const baseFontSize = style === "minimal" ? 250 : style === "glitch" ? 260 : 280;

  const circleRadius = style === "minimal" ? 210 : style === "cinematic" ? 250 : 230;
  const circleStrokeWidth =
    style === "cinematic" ? 12 : style === "minimal" ? 6 : style === "glitch" ? 7 : 9;
  const circumference = 2 * Math.PI * circleRadius;
  const dashOffset = circumference * segmentProgress;

  const minimalScale = interpolateClamp(segmentProgress, [0, 1], [1.2, 1]);
  const minimalOpacity = interpolateClamp(segmentProgress, [0, 0.18, 0.8, 1], [0, 1, 1, 0]);

  const cinematicEntry = spring({
    frame: localFrame,
    fps,
    config: { damping: 8, mass: 0.7, stiffness: 170 },
  });
  const cinematicExit = interpolateClamp(segmentProgress, [0.78, 1], [1, 0]);
  const cinematicScale = cinematicEntry * cinematicExit;
  const cinematicOpacity = interpolateClamp(segmentProgress, [0, 0.12, 0.88, 1], [0, 1, 1, 0]);

  const neonEntry = spring({
    frame: localFrame,
    fps,
    config: { damping: 10, mass: 0.8, stiffness: 130 },
  });
  const neonExit = interpolateClamp(segmentProgress, [0.85, 1], [1, 0.85]);
  const neonScale = interpolateClamp(neonEntry, [0, 1], [0.85, 1.08]) * neonExit;
  const neonFlickerA = (frame + segmentIndex * 3) % 11;
  const neonFlickerB = (frame + segmentIndex * 5) % 17;
  const neonFlickerMultiplier = neonFlickerA === 0 || neonFlickerB < 2 ? 0.6 : 1;
  const neonOpacity =
    interpolateClamp(segmentProgress, [0, 0.08, 0.88, 1], [0, 1, 1, 0]) *
    neonFlickerMultiplier;

  const glitchEntry = spring({
    frame: localFrame,
    fps,
    config: { damping: 9, mass: 0.65, stiffness: 180 },
  });
  const glitchExit = interpolateClamp(segmentProgress, [0.84, 1], [1, 0.82]);
  const glitchScale = interpolateClamp(glitchEntry, [0, 1], [0.95, 1.06]) * glitchExit;
  const glitchOpacity = interpolateClamp(segmentProgress, [0, 0.1, 0.9, 1], [0, 1, 1, 0]);

  const activeScale =
    style === "minimal"
      ? minimalScale
      : style === "cinematic"
      ? cinematicScale
      : style === "neon"
      ? neonScale
      : glitchScale;

  const activeOpacity =
    style === "minimal"
      ? minimalOpacity
      : style === "cinematic"
      ? cinematicOpacity
      : style === "neon"
      ? neonOpacity
      : glitchOpacity;

  const textShadow =
    style === "neon"
      ? `
        0 0 12px ${accentColor},
        0 0 24px ${accentColor},
        0 0 48px ${accentColor},
        0 0 72px ${accentColor}
      `
      : style === "glitch"
      ? "-6px 0 rgba(255, 40, 90, 0.85), 6px 0 rgba(20, 210, 255, 0.85)"
      : "none";

  const cinematicPulse = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, mass: 1, stiffness: 90 },
  });
  const pulseOpacity = interpolateClamp(segmentProgress, [0, 0.35, 1], [0.3, 0.12, 0]);
  const pulseScale = interpolateClamp(cinematicPulse, [0, 1], [0.9, 1.4]);

  return (
    <AbsoluteFill
      style={{
        background:
          style === "neon"
            ? `radial-gradient(circle at center, #0d0d13 0%, ${backgroundColor} 65%)`
            : style === "cinematic"
            ? `radial-gradient(circle at center, #101018 0%, ${backgroundColor} 70%)`
            : backgroundColor,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      {style === "cinematic" && (
        <div
          style={{
            position: "absolute",
            width: 900,
            height: 900,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${accentColor} 0%, transparent 70%)`,
            opacity: pulseOpacity,
            transform: `scale(${pulseScale})`,
            filter: "blur(26px)",
          }}
        />
      )}

      {showCircle && (
        <svg
          width={circleRadius * 2 + 80}
          height={circleRadius * 2 + 80}
          viewBox={`0 0 ${circleRadius * 2 + 80} ${circleRadius * 2 + 80}`}
          style={{ position: "absolute", transform: "rotate(-90deg)" }}
        >
          <circle
            cx={circleRadius + 40}
            cy={circleRadius + 40}
            r={circleRadius}
            stroke={style === "neon" ? `${accentColor}55` : "rgba(255,255,255,0.2)"}
            strokeWidth={circleStrokeWidth}
            fill="transparent"
          />
          <circle
            cx={circleRadius + 40}
            cy={circleRadius + 40}
            r={circleRadius}
            stroke={style === "minimal" ? textColor : accentColor}
            strokeWidth={circleStrokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={
              style === "neon"
                ? { filter: `drop-shadow(0 0 10px ${accentColor})` }
                : undefined
            }
          />
        </svg>
      )}

      {style === "neon" && <NeonParticles frame={frame} accentColor={accentColor} />}

      <div
        style={{
          opacity: activeOpacity,
          transform: `scale(${activeScale})`,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {style === "glitch" ? (
          <GlitchText
            text={displayText}
            localFrame={localFrame}
            segmentProgress={segmentProgress}
            frame={frame}
            textColor={isFinal ? accentColor : textColor}
          />
        ) : (
          <div
            style={{
              fontSize: isFinal ? baseFontSize * 0.72 : baseFontSize,
              fontWeight: 900,
              color: isFinal ? accentColor : textColor,
              fontFamily: "system-ui, -apple-system, sans-serif",
              textShadow,
              letterSpacing: 4,
              lineHeight: 1,
              textAlign: "center",
              whiteSpace: "pre-wrap",
            }}
          >
            {displayText}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
