import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { AnimatedTitle } from "../components";
import { ProgressBar } from "../components";

const sceneSchema = z.object({
  title: z.string(),
  description: z.string(),
  iconEmoji: z.string(),
  backgroundColor: zColor(),
});

export const explainerVideoSchema = z.object({
  scenes: z.array(sceneSchema),
});

type Scene = z.infer<typeof sceneSchema>;

type ExplainerVideoProps = z.infer<typeof explainerVideoSchema>;

const SceneContent: React.FC<{
  scene: Scene;
  sceneFrame: number;
  sceneDuration: number;
  fps: number;
}> = ({ scene, sceneFrame, sceneDuration, fps }) => {
  const transitionDuration = 15;

  // Entry: slide in from right
  const entryProgress = interpolate(
    sceneFrame,
    [0, transitionDuration],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }
  );

  // Exit: slide out to left
  const exitProgress = interpolate(
    sceneFrame,
    [sceneDuration - transitionDuration, sceneDuration],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) }
  );

  const translateX = interpolate(entryProgress, [0, 1], [600, 0]) +
    interpolate(exitProgress, [0, 1], [0, -600]);

  const opacity = entryProgress * (1 - exitProgress);

  // Icon spring
  const iconScale = spring({
    frame: sceneFrame,
    fps,
    config: { damping: 10, stiffness: 100, mass: 0.8 },
  });

  // Description appears after title
  const descOpacity = interpolate(sceneFrame, [18, 35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const descSlide = interpolate(sceneFrame, [18, 35], [15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        transform: `translateX(${translateX}px)`,
        opacity,
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(255,255,255,0.08)",
          borderRadius: 32,
          padding: "60px 80px",
          maxWidth: 800,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {/* Emoji icon */}
        <div
          style={{
            fontSize: 120,
            transform: `scale(${iconScale})`,
            marginBottom: 24,
            lineHeight: 1,
          }}
        >
          {scene.iconEmoji}
        </div>

        {/* Title */}
        <div style={{ marginBottom: 16 }}>
          <AnimatedTitle
            as="h2"
            text={scene.title}
            fontSize={52}
            fontWeight={800}
            color="white"
            fontFamily="system-ui, sans-serif"
            textAlign="center"
            letterSpacing={-0.5}
            animationType="slide-up"
            delay={8}
          />
        </div>

        {/* Description */}
        <p
          style={{
            fontSize: 26,
            color: "rgba(255,255,255,0.75)",
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
            margin: 0,
            lineHeight: 1.5,
            maxWidth: 600,
            opacity: descOpacity,
            transform: `translateY(${descSlide}px)`,
          }}
        >
          {scene.description}
        </p>
      </div>
    </div>
  );
};

export const ExplainerVideo: React.FC<ExplainerVideoProps> = ({ scenes }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  if (scenes.length === 0) {
    return (
      <AbsoluteFill style={{ backgroundColor: "#1a1a2e" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
            color: "white",
            fontSize: 36,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          No scenes provided
        </div>
      </AbsoluteFill>
    );
  }

  const sceneDuration = durationInFrames / scenes.length;
  const currentSceneIndex = Math.min(
    Math.floor(frame / sceneDuration),
    scenes.length - 1
  );
  const sceneFrame = frame - currentSceneIndex * sceneDuration;
  const sceneProgress = sceneFrame / sceneDuration;
  const currentScene = scenes[currentSceneIndex];

  return (
    <AbsoluteFill
      style={{
        backgroundColor: currentScene.backgroundColor,
        overflow: "hidden",
      }}
    >
      {/* Subtle background pattern */}
      <AbsoluteFill style={{ opacity: 0.03 }}>
        <svg width="100%" height="100%">
          <defs>
            <pattern
              id="dots-pattern"
              width="30"
              height="30"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="15" cy="15" r="1.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots-pattern)" />
        </svg>
      </AbsoluteFill>

      <ProgressBar
        currentIndex={currentSceneIndex}
        totalItems={scenes.length}
        variant="fraction"
        position="top"
        color="rgba(255,255,255,0.75)"
        backgroundColor="rgba(255,255,255,0.4)"
      />

      {/* Scene content */}
      <SceneContent
        key={currentSceneIndex}
        scene={currentScene}
        sceneFrame={sceneFrame}
        sceneDuration={sceneDuration}
        fps={useVideoConfig().fps}
      />

      {/* Progress bar */}
      <ProgressBar
        currentIndex={currentSceneIndex}
        totalItems={scenes.length}
        variant="segmented"
        segmentProgress={sceneProgress}
        color={currentScene.backgroundColor === "#1a1a2e" ? "#6C63FF" : "#ffffff"}
        backgroundColor="rgba(255,255,255,0.15)"
        barWidth={600}
      />
    </AbsoluteFill>
  );
};
