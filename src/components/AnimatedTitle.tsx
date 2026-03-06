import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";

type SpringConfig = {
  damping?: number;
  mass?: number;
  stiffness?: number;
  overshootClamping?: boolean;
};

export type AnimatedTitleProps = {
  text: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  fontFamily?: string;
  textAlign?: React.CSSProperties["textAlign"];
  delay?: number;
  springConfig?: SpringConfig;
};

export const AnimatedTitle: React.FC<AnimatedTitleProps> = ({
  text,
  fontSize = 72,
  fontWeight = 800,
  color = "#ffffff",
  fontFamily = "system-ui, sans-serif",
  textAlign = "center",
  delay = 0,
  springConfig = { damping: 14, mass: 0.8, stiffness: 100 },
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
  const translateY = interpolate(entrance, [0, 1], [40, 0]);

  return (
    <h1
      style={{
        fontSize,
        fontWeight,
        color,
        fontFamily,
        textAlign,
        margin: 0,
        opacity,
        transform: `translateY(${translateY}px)`,
        letterSpacing: -1,
        lineHeight: 1.1,
      }}
    >
      {text}
    </h1>
  );
};
