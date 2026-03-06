import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

export const textOverlaySchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  backgroundColor: zColor(),
  textColor: zColor(),
  accentColor: zColor(),
});

type TextOverlayProps = z.infer<typeof textOverlaySchema>;

export const TextOverlay: React.FC<TextOverlayProps> = ({
  title,
  subtitle,
  backgroundColor,
  textColor,
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  const titleScale = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 100 },
  });

  const subtitleOpacity = interpolate(frame, [30, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleY = interpolate(frame, [30, 60], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const lineWidth = interpolate(frame, [15, 45], [0, 200], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <h1
        style={{
          color: textColor,
          fontSize: 80,
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontWeight: 700,
          opacity: titleOpacity,
          transform: `scale(${titleScale})`,
          margin: 0,
          textAlign: "center",
        }}
      >
        {title}
      </h1>
      <div
        style={{
          width: lineWidth,
          height: 4,
          backgroundColor: accentColor,
          marginTop: 20,
          marginBottom: 20,
          borderRadius: 2,
        }}
      />
      <p
        style={{
          color: textColor,
          fontSize: 32,
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontWeight: 300,
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
          margin: 0,
          textAlign: "center",
        }}
      >
        {subtitle}
      </p>
    </AbsoluteFill>
  );
};
