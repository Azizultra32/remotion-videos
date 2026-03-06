import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";

export type StageCardProps = {
  badge: React.ReactNode;
  title: string;
  description?: string;
  backgroundColor?: string;
  textColor?: string;
  badgeColor?: string;
  slideDirection?: "left" | "right";
  delay?: number;
  index?: number;
};

export const StageCard: React.FC<StageCardProps> = ({
  badge,
  title,
  description,
  backgroundColor = "#1e293b",
  textColor = "#e2e8f0",
  badgeColor = "#6C63FF",
  slideDirection = "left",
  delay = 0,
  index = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const staggerDelay = delay + index * 6;
  const delayedFrame = Math.max(0, frame - staggerDelay);

  const slideIn = spring({
    frame: delayedFrame,
    fps,
    config: { damping: 15, stiffness: 100, mass: 0.8 },
  });

  const offsetX = slideDirection === "left" ? -300 : 300;
  const translateX = interpolate(slideIn, [0, 1], [offsetX, 0]);
  const opacity = interpolate(slideIn, [0, 1], [0, 1]);

  const badgeScale = spring({
    frame: Math.max(0, delayedFrame - 5),
    fps,
    config: { damping: 10, mass: 0.6, stiffness: 150 },
  });

  const isLeftSlide = slideDirection === "left";

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: isLeftSlide ? "row" : "row-reverse",
          alignItems: "center",
          gap: 32,
          backgroundColor,
          borderRadius: 16,
          padding: "24px 40px",
          maxWidth: 900,
          width: "100%",
          transform: `translateX(${translateX}px)`,
          opacity,
          boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
        }}
      >
        {/* Badge circle */}
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            backgroundColor: badgeColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transform: `scale(${interpolate(badgeScale, [0, 1], [0, 1])})`,
            boxShadow: `0 4px 20px ${badgeColor}44`,
          }}
        >
          <span
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#ffffff",
              fontFamily: "system-ui, sans-serif",
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {badge}
          </span>
        </div>

        {/* Text content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: textColor,
              fontFamily: "system-ui, sans-serif",
              margin: 0,
              marginBottom: description ? 8 : 0,
            }}
          >
            {title}
          </h3>
          {description && (
            <p
              style={{
                fontSize: 20,
                color: textColor + "aa",
                fontFamily: "system-ui, sans-serif",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              {description}
            </p>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
