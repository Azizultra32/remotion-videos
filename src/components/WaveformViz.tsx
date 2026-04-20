import type React from "react";
import { useMemo } from "react";
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

  // PERFORMANCE FIX: Optimize bar calculation to avoid recalculating on every frame
  // Static bar positions (only recalculate when beats/width/duration change)
  const staticBars = useMemo(() => {
    if (beats.length === 0) return [];
    return beats.map((beatTime) => ({
      beatTime,
      x: (beatTime / duration) * width,
    }));
  }, [beats, width, duration]);

  // Dynamic properties (recalculate only when time crosses 0.5s boundaries)
  const timeQuantized = Math.floor(currentTimeSec * 2) / 2; // Snap to 0.5s intervals
  const bars = useMemo(() => {
    return staticBars.map(({ beatTime, x }) => {
      // Height based on proximity to current time (taller when playing)
      const timeDiff = Math.abs(timeQuantized - beatTime);
      const heightMultiplier = timeDiff < 0.5 ? 1.0 : timeDiff < 2.0 ? 0.6 : 0.3;
      const barHeight = height * heightMultiplier;
      const isPast = beatTime < timeQuantized;

      return {
        x,
        height: barHeight,
        isPast,
      };
    });
  }, [staticBars, timeQuantized, height]);

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
            backgroundColor: bar.isPast ? color : color.replace("0.6", "0.3").replace("0.8", "0.4"),
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
