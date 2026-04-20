import { zColor } from "@remotion/zod-types";
import type React from "react";
import type { CalculateMetadataFunction } from "remotion";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Series,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";
import { AnimatedTitle, ProgressBar } from "../components";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const sceneSchema = z.object({
  title: z.string(),
  durationInFrames: z.number(),
  backgroundColor: zColor(),
  textColor: zColor(),
  content: z.string(),
  type: z.enum(["title", "feature", "cta", "transition"]),
});

export const videoStitcherSchema = z.object({
  scenes: z.array(sceneSchema),
});

// ---------------------------------------------------------------------------
// Types (derived from schema)
// ---------------------------------------------------------------------------

export type SceneType = z.infer<typeof sceneSchema>["type"];
export type Scene = z.infer<typeof sceneSchema>;
export type VideoStitcherProps = z.infer<typeof videoStitcherSchema>;

// ---------------------------------------------------------------------------
// calculateMetadata
// ---------------------------------------------------------------------------

export const calculateVideoStitcherMetadata: CalculateMetadataFunction<VideoStitcherProps> = ({
  props,
}) => {
  const duration = props.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0);
  return {
    durationInFrames: duration,
  };
};

// ---------------------------------------------------------------------------
// Lower-third progress bar (persistent across all scenes)
// ---------------------------------------------------------------------------

const LowerThird: React.FC<{
  sceneIndex: number;
  totalScenes: number;
  sceneLabel: string;
}> = ({ sceneIndex, totalScenes, sceneLabel }) => {
  return (
    <ProgressBar
      currentIndex={sceneIndex}
      totalItems={totalScenes}
      variant="segmented"
      showBackground={true}
      label={sceneLabel}
      color="#ffffff"
      backgroundColor="rgba(255,255,255,0.35)"
      barWidth={220}
    />
  );
};

// ---------------------------------------------------------------------------
// Scene renderers
// ---------------------------------------------------------------------------

const TitleScene: React.FC<{
  scene: Scene;
  sceneIndex: number;
  totalScenes: number;
}> = ({ scene, sceneIndex, totalScenes }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const subtitleSlide = spring({
    frame: Math.max(0, frame - 12),
    fps,
    config: { damping: 16, mass: 0.7 },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: scene.backgroundColor,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AnimatedTitle
        text={scene.title}
        fontSize={72}
        fontWeight={800}
        color={scene.textColor}
        fontFamily="system-ui, sans-serif"
        textAlign="center"
        letterSpacing={0}
        animationType="scale"
        springConfig={{ damping: 14, stiffness: 120, mass: 0.9 }}
      />
      <p
        style={{
          fontSize: 28,
          color: scene.textColor,
          fontFamily: "system-ui, sans-serif",
          opacity: interpolate(subtitleSlide, [0, 1], [0, 0.8]),
          transform: `translateY(${interpolate(subtitleSlide, [0, 1], [40, 0])}px)`,
          marginTop: 16,
          textAlign: "center",
          maxWidth: "70%",
        }}
      >
        {scene.content}
      </p>
      <LowerThird
        sceneIndex={sceneIndex}
        totalScenes={totalScenes}
        sceneLabel={`SCENE ${sceneIndex + 1} / ${totalScenes}`}
      />
    </AbsoluteFill>
  );
};

const FeatureScene: React.FC<{
  scene: Scene;
  sceneIndex: number;
  totalScenes: number;
}> = ({ scene, sceneIndex, totalScenes }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slideIn = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 100 },
  });

  const badgeScale = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 12, mass: 0.6 },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: scene.backgroundColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 64,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 40,
          transform: `translateX(${interpolate(slideIn, [0, 1], [-400, 0])}px)`,
          opacity: interpolate(slideIn, [0, 1], [0, 1]),
        }}
      >
        {/* Number badge */}
        <div
          style={{
            width: 100,
            height: 100,
            borderRadius: "50%",
            backgroundColor: scene.textColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transform: `scale(${interpolate(badgeScale, [0, 1], [0, 1])})`,
          }}
        >
          <span
            style={{
              fontSize: 48,
              fontWeight: 800,
              color: scene.backgroundColor,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {sceneIndex + 1}
          </span>
        </div>
        {/* Text content */}
        <div style={{ maxWidth: 700 }}>
          <h2
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: scene.textColor,
              fontFamily: "system-ui, sans-serif",
              margin: "0 0 12px 0",
            }}
          >
            {scene.title}
          </h2>
          <p
            style={{
              fontSize: 24,
              color: scene.textColor,
              fontFamily: "system-ui, sans-serif",
              opacity: 0.85,
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {scene.content}
          </p>
        </div>
      </div>
      <LowerThird
        sceneIndex={sceneIndex}
        totalScenes={totalScenes}
        sceneLabel={`SCENE ${sceneIndex + 1} / ${totalScenes}`}
      />
    </AbsoluteFill>
  );
};

const CtaScene: React.FC<{
  scene: Scene;
  sceneIndex: number;
  totalScenes: number;
}> = ({ scene, sceneIndex, totalScenes }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const entryScale = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 140, mass: 0.8 },
  });

  // Pulse effect after initial entry
  const pulsePhase = Math.max(0, frame - 20);
  const pulse = 1 + Math.sin(pulsePhase * 0.15) * 0.04;

  const glowOpacity = interpolate(Math.sin(pulsePhase * 0.12), [-1, 1], [0.3, 0.7]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: scene.backgroundColor,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <h2
        style={{
          fontSize: 40,
          fontWeight: 700,
          color: scene.textColor,
          fontFamily: "system-ui, sans-serif",
          marginBottom: 32,
          opacity: interpolate(frame, [0, 12], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        {scene.title}
      </h2>
      <div
        style={{
          transform: `scale(${interpolate(entryScale, [0, 1], [0, 1]) * pulse})`,
          position: "relative",
        }}
      >
        {/* Glow */}
        <div
          style={{
            position: "absolute",
            inset: -12,
            borderRadius: 20,
            backgroundColor: scene.textColor,
            opacity: glowOpacity * 0.25,
            filter: "blur(18px)",
          }}
        />
        {/* Button */}
        <div
          style={{
            padding: "28px 64px",
            borderRadius: 16,
            backgroundColor: scene.textColor,
            cursor: "pointer",
            position: "relative",
          }}
        >
          <span
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: scene.backgroundColor,
              fontFamily: "system-ui, sans-serif",
              letterSpacing: 1.5,
            }}
          >
            {scene.content}
          </span>
        </div>
      </div>
      <LowerThird
        sceneIndex={sceneIndex}
        totalScenes={totalScenes}
        sceneLabel={`SCENE ${sceneIndex + 1} / ${totalScenes}`}
      />
    </AbsoluteFill>
  );
};

const TransitionScene: React.FC<{
  scene: Scene;
  sceneIndex: number;
  totalScenes: number;
}> = ({ scene, sceneIndex, totalScenes }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Fade in then fade out through black
  const mid = durationInFrames / 2;
  const opacity = interpolate(frame, [0, mid, durationInFrames], [0, 1, 0], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill
        style={{
          backgroundColor: scene.backgroundColor,
          opacity,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {scene.title && (
          <h3
            style={{
              fontSize: 32,
              fontWeight: 600,
              color: scene.textColor,
              fontFamily: "system-ui, sans-serif",
              opacity: 0.7,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            {scene.title}
          </h3>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Scene dispatcher
// ---------------------------------------------------------------------------

const SceneRenderer: React.FC<{
  scene: Scene;
  sceneIndex: number;
  totalScenes: number;
}> = ({ scene, sceneIndex, totalScenes }) => {
  switch (scene.type) {
    case "title":
      return <TitleScene scene={scene} sceneIndex={sceneIndex} totalScenes={totalScenes} />;
    case "feature":
      return <FeatureScene scene={scene} sceneIndex={sceneIndex} totalScenes={totalScenes} />;
    case "cta":
      return <CtaScene scene={scene} sceneIndex={sceneIndex} totalScenes={totalScenes} />;
    case "transition":
      return <TransitionScene scene={scene} sceneIndex={sceneIndex} totalScenes={totalScenes} />;
    default:
      return <TitleScene scene={scene} sceneIndex={sceneIndex} totalScenes={totalScenes} />;
  }
};

// ---------------------------------------------------------------------------
// Main stitcher composition
// ---------------------------------------------------------------------------

export const VideoStitcher: React.FC<VideoStitcherProps> = ({ scenes }) => {
  return (
    <AbsoluteFill>
      <Series>
        {scenes.map((scene, index) => (
          <Series.Sequence key={`scene-${index}`} durationInFrames={scene.durationInFrames}>
            <SceneRenderer scene={scene} sceneIndex={index} totalScenes={scenes.length} />
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Default props for Remotion Studio preview
// ---------------------------------------------------------------------------

export const defaultVideoStitcherProps: VideoStitcherProps = {
  scenes: [
    {
      type: "title",
      title: "Introducing MetaMatrix",
      content: "The AI-powered pipeline that finds and fixes bugs autonomously",
      durationInFrames: 90,
      backgroundColor: "#0f0f23",
      textColor: "#ffffff",
    },
    {
      type: "transition",
      title: "",
      content: "",
      durationInFrames: 20,
      backgroundColor: "#0f0f23",
      textColor: "#ffffff",
    },
    {
      type: "feature",
      title: "Cathedral Analysis",
      content:
        "Deep context cycling builds a complete understanding of your codebase before any changes are made.",
      durationInFrames: 90,
      backgroundColor: "#1a1a3e",
      textColor: "#e0e0ff",
    },
    {
      type: "feature",
      title: "Dual-Track Discovery",
      content:
        "Briefed and blind agents independently find issues, then converge for maximum coverage.",
      durationInFrames: 90,
      backgroundColor: "#1e2d3e",
      textColor: "#c8e6ff",
    },
    {
      type: "transition",
      title: "And then...",
      content: "",
      durationInFrames: 25,
      backgroundColor: "#111",
      textColor: "#888",
    },
    {
      type: "feature",
      title: "Predictive Simulation",
      content:
        "Every fix is simulated before implementation. Regressions are caught before they happen.",
      durationInFrames: 90,
      backgroundColor: "#2d1e1e",
      textColor: "#ffc8c8",
    },
    {
      type: "cta",
      title: "Ready to ship with confidence?",
      content: "GET STARTED",
      durationInFrames: 75,
      backgroundColor: "#0f0f23",
      textColor: "#6c63ff",
    },
  ],
};
