import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export type ProgressBarVariant = "dots" | "bar" | "fraction" | "segmented";

export type ProgressBarProps = {
  currentIndex: number;
  totalItems: number;
  variant?: ProgressBarVariant;
  color?: string;
  backgroundColor?: string;
  position?: "bottom" | "top";
  label?: string;
  segmentProgress?: number;
  showBackground?: boolean;
  barWidth?: number;
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  currentIndex,
  totalItems,
  variant = "dots",
  color = "#ffffff",
  backgroundColor = "rgba(255,255,255,0.2)",
  position = "bottom",
  label,
  segmentProgress = 0,
  showBackground = false,
  barWidth = 400,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    config: { damping: 18, mass: 0.8 },
  });

  const slideOffset = position === "bottom" ? 40 : -40;
  const translateY = interpolate(entrance, [0, 1], [slideOffset, 0]);

  const containerStyle: React.CSSProperties = {
    position: "absolute",
    [position]: 40,
    left: "50%",
    transform: `translateX(-50%) translateY(${translateY}px)`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: entrance,
    zIndex: 100,
  };

  if (variant === "dots") {
    return (
      <div style={containerStyle}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {Array.from({ length: totalItems }).map((_, i) => {
            const isActive = i === currentIndex;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
                key={i}
                style={{
                  width: isActive ? 28 : 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: isActive ? color : backgroundColor,
                }}
              />
            );
          })}
        </div>
      </div>
    );
  }

  if (variant === "bar") {
    const progress = totalItems > 1 ? (currentIndex + 1) / totalItems : 1;

    const barSpring = spring({
      frame,
      fps,
      config: { damping: 20, stiffness: 80 },
    });

    const animatedWidth = interpolate(barSpring, [0, 1], [0, progress * 100]);

    return (
      <div style={containerStyle}>
        <div
          style={{
            width: 400,
            height: 6,
            borderRadius: 3,
            backgroundColor,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `${animatedWidth}%`,
              backgroundColor: color,
              borderRadius: 3,
            }}
          />
        </div>
      </div>
    );
  }

  if (variant === "segmented") {
    return (
      <div
        style={{
          ...containerStyle,
          ...(showBackground
            ? {
                backgroundColor: "rgba(0,0,0,0.55)",
                backdropFilter: "blur(8px)",
                padding: "12px 24px",
                borderRadius: 8,
                width: barWidth + 48,
              }
            : {}),
          flexDirection: "column",
          gap: 8,
        }}
      >
        {label && (
          <span
            style={{
              fontFamily: "system-ui, sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {label}
          </span>
        )}
        <div style={{ display: "flex", gap: 4, width: barWidth }}>
          {Array.from({ length: totalItems }).map((_, i) => {
            const isCurrent = i === currentIndex;
            const isPast = i < currentIndex;
            const fillWidth = isCurrent ? segmentProgress * 100 : isPast ? 100 : 0;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
                key={i}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    height: "100%",
                    width: `${fillWidth}%`,
                    backgroundColor: color,
                    borderRadius: 2,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // fraction variant
  return (
    <div style={containerStyle}>
      <span
        style={{
          fontFamily: "system-ui, sans-serif",
          fontSize: 18,
          fontWeight: 600,
          color,
          letterSpacing: 2,
        }}
      >
        {currentIndex + 1} <span style={{ color: backgroundColor, fontWeight: 400 }}>/</span>{" "}
        {totalItems}
      </span>
    </div>
  );
};
