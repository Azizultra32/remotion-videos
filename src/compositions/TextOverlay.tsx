import { zColor } from "@remotion/zod-types";
import type React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { z } from "zod";
import { AnimatedTitle } from "../components";

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
      <AnimatedTitle
        text={title}
        fontSize={90}
        fontWeight={800}
        color={textColor}
        fontFamily="system-ui, -apple-system, sans-serif"
        animationType="scale"
        letterSpacing={-2}
        springConfig={{ damping: 12, mass: 0.5, stiffness: 100 }}
      />
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
      <AnimatedTitle
        as="h2"
        text={subtitle}
        fontSize={32}
        fontWeight={300}
        color={textColor}
        fontFamily="system-ui, -apple-system, sans-serif"
        animationType="slide-up"
        letterSpacing={0}
        delay={30}
      />
    </AbsoluteFill>
  );
};
