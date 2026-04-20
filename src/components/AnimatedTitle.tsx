import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type SpringConfig = {
  damping?: number;
  mass?: number;
  stiffness?: number;
  overshootClamping?: boolean;
};

export type AnimationType = "slide-up" | "scale" | "fade-in";

export type AnimatedTitleProps = {
  text: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  fontFamily?: string;
  textAlign?: React.CSSProperties["textAlign"];
  letterSpacing?: number;
  delay?: number;
  animationType?: AnimationType;
  springConfig?: SpringConfig;
  as?: "h1" | "h2" | "h3" | "div";
};

export const AnimatedTitle: React.FC<AnimatedTitleProps> = ({
  text,
  fontSize = 72,
  fontWeight = 800,
  color = "#ffffff",
  fontFamily = "system-ui, sans-serif",
  textAlign = "center",
  letterSpacing = -1,
  delay = 0,
  animationType = "slide-up",
  springConfig = { damping: 14, mass: 0.8, stiffness: 100 },
  as: Tag = "h1",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const delayedFrame = Math.max(0, frame - delay);

  const entrance = spring({
    frame: delayedFrame,
    fps,
    config: springConfig,
  });

  const opacity = interpolate(entrance, [0, 1], [0, 1]);

  let transform = "";
  if (animationType === "slide-up") {
    const translateY = interpolate(entrance, [0, 1], [40, 0]);
    transform = `translateY(${translateY}px)`;
  } else if (animationType === "scale") {
    const scale = interpolate(entrance, [0, 1], [0.7, 1]);
    transform = `scale(${scale})`;
  }

  return (
    <Tag
      style={{
        fontSize,
        fontWeight,
        color,
        fontFamily,
        textAlign,
        margin: 0,
        opacity,
        transform,
        letterSpacing,
        lineHeight: 1.1,
      }}
    >
      {text}
    </Tag>
  );
};
