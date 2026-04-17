import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

interface WaveformVizProps {
  beats: number[];
  duration: number;
  color?: string;
  height?: number;
  position?: "top" | "bottom";
  opacity?: number;
}

export const WaveformViz: React.FC<WaveformVizProps> = ({
  beats,
  duration,
  color = "rgba(255,255,255,0.6)",
  height = 60,
  position = "bottom",
  opacity = 0.8,
}) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const currentTimeSec = frame / fps;

  // Generate waveform bars from beat data
  const bars = useMemo(() => {
    if (beats.length === 0) return [];

    const barWidth = width / beats.length;
    return beats.map((beatTime, i) => {
      // Height based on proximity to current time (taller when playing)
      const timeDiff = Math.abs(currentTimeSec - beatTime);
      const heightMultiplier = timeDiff < 0.5 ? 1.0 : timeDiff < 2.0 ? 0.6 : 0.3;
      const barHeight = height * heightMultiplier;

      // Position in timeline
      const x = (beatTime / duration) * width;
      const isPast = beatTime < currentTimeSec;

      return {
        x,
        height: barHeight,
        isPast,
      };
    });
  }, [beats, currentTimeSec, width, duration, height]);

  // Progress indicator
  const progressX = (currentTimeSec / duration) * width;

  return (
    <div
      style={{
        position: "absolute",
        [position]: 0,
        left: 0,
        width: "100%",
        height,
        display: "flex",
        alignItems: "flex-end",
        pointerEvents: "none",
        opacity,
      }}
    >
      {/* Waveform bars */}
      {bars.map((bar, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: bar.x,
            bottom: 0,
            width: 2,
            height: bar.height,
            backgroundColor: bar.isPast
              ? color
              : color.replace("0.6", "0.3").replace("0.8", "0.4"),
            transition: "height 0.1s ease-out",
          }}
        />
      ))}

      {/* Progress line */}
      <div
        style={{
          position: "absolute",
          left: progressX,
          bottom: 0,
          width: 2,
          height: height,
          backgroundColor: "#fff",
          boxShadow: "0 0 10px rgba(255,255,255,0.8)",
        }}
      />
    </div>
  );
};
