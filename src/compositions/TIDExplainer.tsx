import { zColor } from "@remotion/zod-types";
import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

// ─── Schema ───────────────────────────────────────────────────

const tidSceneSchema = z.object({
  title: z.string(),
  narration: z.string(),
  durationSeconds: z.number(),
});

export const tidExplainerSchema = z.object({
  scenes: z.array(tidSceneSchema),
  backgroundColor: zColor().default("#0f1117"),
  accentColor: zColor().default("#6366f1"),
  textColor: zColor().default("#e2e8f0"),
  brandName: z.string().default("Terminal Identity System"),
  useAudio: z.boolean().default(false),
});

type TIDExplainerProps = z.infer<typeof tidExplainerSchema>;

export const calculateTIDExplainerMetadata = ({ props }: { props: TIDExplainerProps }) => {
  const totalSeconds = props.scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  return { durationInFrames: totalSeconds * 30 };
};

// ─── Constants ────────────────────────────────────────────────

const COLORS = {
  bg: "#0f1117",
  card: "#1a1d27",
  cardBorder: "#2a2d37",
  accent: "#6366f1",
  accentLight: "#818cf8",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  textDim: "#64748b",
  white: "#ffffff",
  green: "#22c55e",
  blue: "#3b82f6",
  orange: "#f97316",
  pink: "#ec4899",
  purple: "#a855f7",
  red: "#ef4444",
  cyan: "#06b6d4",
} as const;

const FONTS = {
  heading: "Inter, system-ui, sans-serif",
  body: "Inter, system-ui, sans-serif",
  mono: "JetBrains Mono, Fira Code, monospace",
} as const;

// ─── Reusable Primitives ──────────────────────────────────────

const FadeInText: React.FC<{
  text: string;
  delay?: number;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  fontFamily?: string;
  style?: React.CSSProperties;
}> = ({
  text,
  delay = 0,
  fontSize = 24,
  color = COLORS.text,
  fontWeight = 400,
  fontFamily = FONTS.body,
  style,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame - delay, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const translateY = interpolate(frame - delay, [0, 12], [10, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        fontSize,
        color,
        fontWeight,
        fontFamily,
        lineHeight: 1.5,
        ...style,
      }}
    >
      {text}
    </div>
  );
};

const AnimatedBox: React.FC<{
  title: string;
  subtitle?: string;
  accentColor?: string;
  delay?: number;
  width?: number;
  children?: React.ReactNode;
}> = ({ title, subtitle, accentColor = COLORS.accent, delay = 0, width = 300, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame - delay, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const translateY = interpolate(frame - delay, [0, 15], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        backgroundColor: COLORS.card,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 12,
        padding: 24,
        width,
        fontFamily: FONTS.body,
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: COLORS.white,
          marginBottom: subtitle || children ? 8 : 0,
        }}
      >
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 16, color: COLORS.textMuted, lineHeight: 1.5 }}>{subtitle}</div>
      )}
      {children}
    </div>
  );
};

const AnimatedArrow: React.FC<{
  delay?: number;
  width?: number;
  color?: string;
}> = ({ delay = 0, width = 80, color = COLORS.textDim }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame - delay, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width,
        height: 40,
      }}
    >
      <div
        style={{
          height: 3,
          flex: 1,
          backgroundColor: color,
          transformOrigin: "left center",
          transform: `scaleX(${progress})`,
          borderRadius: 2,
        }}
      />
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: `10px solid ${color}`,
          borderTop: "8px solid transparent",
          borderBottom: "8px solid transparent",
          opacity: progress > 0.8 ? (progress - 0.8) * 5 : 0,
        }}
      />
    </div>
  );
};

const CodeBlock: React.FC<{
  code: string;
  delay?: number;
  width?: number;
  typingSpeed?: number;
}> = ({ code, delay = 0, width = 600, typingSpeed = 2 }) => {
  const frame = useCurrentFrame();
  const adjustedFrame = frame - delay;
  const opacity = interpolate(adjustedFrame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const charsVisible = Math.max(0, Math.floor((adjustedFrame - 10) * typingSpeed));
  const visibleCode = code.slice(0, charsVisible);
  return (
    <div
      style={{
        opacity,
        backgroundColor: "#0d1117",
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 10,
        padding: 20,
        width,
        fontFamily: FONTS.mono,
        fontSize: 15,
        color: COLORS.green,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        overflow: "hidden",
      }}
    >
      {visibleCode}
      {charsVisible < code.length && charsVisible > 0 && (
        <span
          style={{
            backgroundColor: COLORS.accent,
            color: COLORS.bg,
            width: 8,
            display: "inline-block",
          }}
        >
          {" "}
        </span>
      )}
    </div>
  );
};

// ─── Scene 1: Title ───────────────────────────────────────────

const Scene1Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({
    frame,
    fps,
    config: { damping: 12, mass: 0.5, stiffness: 100 },
  });
  const subtitleOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pipelineOpacity = interpolate(frame, [70, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const stages = [
    { name: "SessionStart", color: COLORS.blue },
    { name: "Register", color: COLORS.green },
    { name: "Track", color: COLORS.accent },
    { name: "Fork", color: COLORS.orange },
    { name: "Name", color: COLORS.pink },
  ];

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 80 }}>
      <div style={{ textAlign: "center", transform: `scale(${titleScale})` }}>
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: COLORS.white,
            fontFamily: FONTS.heading,
            letterSpacing: -2,
          }}
        >
          Terminal Identity System
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 300,
            color: COLORS.accent,
            fontFamily: FONTS.heading,
            marginTop: 8,
          }}
        >
          DNS-Inspired Session Tracking for Claude Code
        </div>
      </div>

      <div
        style={{
          opacity: subtitleOpacity,
          fontSize: 22,
          color: COLORS.textMuted,
          textAlign: "center",
          maxWidth: 800,
          lineHeight: 1.6,
          marginTop: 40,
        }}
      >
        Every terminal gets an identity. Every session gets a lineage. Every fork gets tracked.
      </div>

      <div
        style={{
          opacity: pipelineOpacity,
          display: "flex",
          gap: 12,
          marginTop: 50,
          alignItems: "center",
        }}
      >
        {stages.map((stage, i) => {
          const stageDelay = 90 + i * 8;
          const so = interpolate(frame, [stageDelay, stageDelay + 12], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div key={stage.name} style={{ display: "flex", alignItems: "center" }}>
              <div
                style={{
                  opacity: so,
                  backgroundColor: COLORS.card,
                  border: `2px solid ${stage.color}`,
                  borderRadius: 8,
                  padding: "8px 18px",
                  color: stage.color,
                  fontSize: 16,
                  fontWeight: 600,
                  fontFamily: FONTS.mono,
                }}
              >
                {stage.name}
              </div>
              {i < stages.length - 1 && (
                <span style={{ opacity: so, color: COLORS.textDim, fontSize: 18, marginLeft: 12 }}>
                  →
                </span>
              )}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 2: The Problem ─────────────────────────────────────

const Scene2Problem: React.FC = () => {
  const frame = useCurrentFrame();

  const headerOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const problems = [
    {
      text: "Sessions are flat UUID files — no terminal association",
      delay: 25,
      color: COLORS.red,
    },
    {
      text: "Forks lose all lineage — Anthropic tracks zero metadata",
      delay: 50,
      color: COLORS.orange,
    },
    {
      text: "Crashes/compactions break the link between sessions",
      delay: 75,
      color: COLORS.orange,
    },
    { text: "Running 5+ terminals — which one is which?", delay: 100, color: COLORS.red },
  ];

  return (
    <AbsoluteFill style={{ padding: 80 }}>
      <div
        style={{
          opacity: headerOpacity,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 50,
        }}
      >
        <div
          style={{
            width: 8,
            height: 40,
            backgroundColor: COLORS.red,
            borderRadius: 4,
          }}
        />
        <div
          style={{
            fontSize: 40,
            fontWeight: 700,
            color: COLORS.white,
            fontFamily: FONTS.heading,
          }}
        >
          The Problem: Lost Identity
        </div>
      </div>

      {/* UUID chaos visualization */}
      <div style={{ display: "flex", gap: 40, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          {problems.map(({ text, delay, color }) => (
            <FadeInText
              key={text}
              text={`x  ${text}`}
              delay={delay}
              fontSize={22}
              color={color}
              style={{ marginBottom: 20 }}
            />
          ))}
        </div>

        {/* UUID soup visual */}
        <div style={{ width: 500 }}>
          <CodeBlock
            code={`~/.claude/projects/
├── 83268344-d23a-4ee3-...jsonl  ← ???
├── f8c440f1-238d-4afc-...jsonl  ← ???
├── a1b2c3d4-5e6f-7890-...jsonl  ← ???
├── which-terminal-is-this.jsonl ← ???`}
            delay={30}
            width={480}
            typingSpeed={2}
          />

          <FadeInText
            text="No way to tell which terminal produced which file"
            delay={140}
            fontSize={16}
            color={COLORS.textDim}
            style={{ marginTop: 16, fontStyle: "italic" }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 3: The Solution — DNS-Inspired Addressing ──────────

const Scene3Solution: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const dnsRows = [
    { internet: "TLD (.com)", terminal: "Hostname (alis-mini)", color: COLORS.blue, delay: 40 },
    { internet: "Domain", terminal: "Project (REBUILD)", color: COLORS.green, delay: 60 },
    { internet: "Subdomain", terminal: "Terminal (t-7a3f2b1c)", color: COLORS.accent, delay: 80 },
    { internet: "Path", terminal: "Session / fork lineage", color: COLORS.orange, delay: 100 },
    {
      internet: "IP address",
      terminal: "UUID (real ID under hood)",
      color: COLORS.textDim,
      delay: 120,
    },
  ];

  const addressScale = spring({
    frame: Math.max(0, frame - 150),
    fps,
    config: { damping: 10, stiffness: 80, mass: 0.6 },
  });

  return (
    <AbsoluteFill style={{ padding: 60 }}>
      <div
        style={{
          opacity: headerOpacity,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 40,
        }}
      >
        <div style={{ width: 8, height: 40, backgroundColor: COLORS.green, borderRadius: 4 }} />
        <div
          style={{
            fontSize: 40,
            fontWeight: 700,
            color: COLORS.white,
            fontFamily: FONTS.heading,
          }}
        >
          DNS-Inspired Address System
        </div>
      </div>

      {/* DNS comparison table */}
      <div style={{ display: "flex", gap: 40 }}>
        <div style={{ width: 650 }}>
          {/* Table header */}
          <div
            style={{
              display: "flex",
              gap: 20,
              marginBottom: 12,
              opacity: interpolate(frame, [20, 35], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <div
              style={{ width: 200, fontSize: 16, color: COLORS.textDim, fontFamily: FONTS.mono }}
            >
              Internet
            </div>
            <div
              style={{ width: 400, fontSize: 16, color: COLORS.textDim, fontFamily: FONTS.mono }}
            >
              Terminal System
            </div>
          </div>

          {dnsRows.map(({ internet, terminal, color, delay }) => {
            const rowOpacity = interpolate(frame - delay, [0, 12], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div
                key={internet}
                style={{
                  opacity: rowOpacity,
                  display: "flex",
                  gap: 20,
                  alignItems: "center",
                  marginBottom: 10,
                  backgroundColor: COLORS.card,
                  borderRadius: 8,
                  padding: "10px 16px",
                  borderLeft: `3px solid ${color}`,
                }}
              >
                <div
                  style={{
                    width: 200,
                    fontSize: 17,
                    color: COLORS.textMuted,
                    fontFamily: FONTS.mono,
                  }}
                >
                  {internet}
                </div>
                <div style={{ fontSize: 17, color, fontWeight: 600, fontFamily: FONTS.mono }}>
                  {terminal}
                </div>
              </div>
            );
          })}
        </div>

        {/* FQA example */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              transform: `scale(${addressScale})`,
              transformOrigin: "top left",
            }}
          >
            <div
              style={{
                fontSize: 16,
                color: COLORS.textDim,
                fontFamily: FONTS.mono,
                marginBottom: 12,
              }}
            >
              Fully Qualified Address:
            </div>
            <CodeBlock
              code={`alis-mini/REBUILD/t-7a3f2b1c/s1/root
alis-mini/REBUILD/t-7a3f2b1c/s1/f-a3b2c1-1
alis-mini/REBUILD/t-7a3f2b1c/s2/root
alis-mini/REBUILD/mmx-engine/s1/root`}
              delay={155}
              width={460}
              typingSpeed={1.5}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 4: Registration Flow ───────────────────────────────

const Scene4Registration: React.FC = () => {
  const frame = useCurrentFrame();

  const headerOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ padding: 60 }}>
      <div
        style={{
          opacity: headerOpacity,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 40,
        }}
      >
        <div style={{ width: 8, height: 40, backgroundColor: COLORS.blue, borderRadius: 4 }} />
        <div
          style={{ fontSize: 40, fontWeight: 700, color: COLORS.white, fontFamily: FONTS.heading }}
        >
          How It Works: SessionStart Hook
        </div>
      </div>

      {/* Flow: SessionStart → Hook → Python → Registry → TID file */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 20 }}>
        <AnimatedBox
          title="SessionStart"
          subtitle="Claude Code opens a terminal"
          accentColor={COLORS.blue}
          delay={20}
          width={260}
        />
        <AnimatedArrow delay={45} width={50} color={COLORS.blue} />
        <AnimatedBox
          title="Shell Hook"
          subtitle="terminal-identity.sh fires"
          accentColor={COLORS.green}
          delay={55}
          width={260}
        />
        <AnimatedArrow delay={80} width={50} color={COLORS.green} />
        <AnimatedBox title="Python Registry" accentColor={COLORS.accent} delay={90} width={280}>
          <div style={{ marginTop: 8 }}>
            <FadeInText
              text="Hash(host + pid + time)"
              delay={105}
              fontSize={14}
              color={COLORS.textMuted}
            />
            <FadeInText text="→ t-{8 hex chars}" delay={115} fontSize={14} color={COLORS.accent} />
            <FadeInText
              text="Atomic write with flock"
              delay={125}
              fontSize={14}
              color={COLORS.textMuted}
            />
          </div>
        </AnimatedBox>
        <AnimatedArrow delay={140} width={50} color={COLORS.accent} />
        <AnimatedBox
          title="TID File"
          subtitle="~/.claude/tid/PROJECT.json"
          accentColor={COLORS.orange}
          delay={150}
          width={260}
        />
      </div>

      {/* Registry JSON */}
      <div style={{ marginTop: 40, display: "flex", gap: 30 }}>
        <CodeBlock
          code={`// ~/.claude/terminal-registry.json
{
  "version": 1,
  "terminals": {
    "t-9e324ae0": {
      "host": "alis-mini",
      "project": "REBUILD",
      "nickname": "phoenix",
      "sessions": [{
        "ordinal": 1,
        "source": "startup",
        "forks": []
      }]
    }
  }
}`}
          delay={170}
          width={480}
          typingSpeed={1.8}
        />

        <div style={{ flex: 1 }}>
          {[
            {
              label: "Collision-safe",
              desc: "4 billion IDs from 8 hex chars",
              delay: 200,
              color: COLORS.green,
            },
            {
              label: "Atomic writes",
              desc: "flock + tmp → rename pattern",
              delay: 220,
              color: COLORS.blue,
            },
            {
              label: "Corruption recovery",
              desc: "Falls back to .bak file",
              delay: 240,
              color: COLORS.orange,
            },
            {
              label: "Per-project TID",
              desc: "~/.claude/tid/PROJECT.json",
              delay: 260,
              color: COLORS.accent,
            },
          ].map(({ label, desc, delay, color }) => (
            <div key={label} style={{ marginBottom: 16 }}>
              <FadeInText text={label} delay={delay} fontSize={20} color={color} fontWeight={700} />
              <FadeInText text={desc} delay={delay + 5} fontSize={16} color={COLORS.textMuted} />
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 5: Fork Detection ──────────────────────────────────

const Scene5Forks: React.FC = () => {
  const frame = useCurrentFrame();

  const headerOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Tree visualization - deterministic positions
  const nodes = [
    { id: "s1/root", x: 200, y: 200, label: "s1/root", color: COLORS.green, delay: 30 },
    { id: "f-a3b2c1-1", x: 500, y: 120, label: "f-a3b2c1-1", color: COLORS.orange, delay: 60 },
    { id: "f-a3b2c1-2", x: 500, y: 280, label: "f-a3b2c1-2", color: COLORS.orange, delay: 70 },
    { id: "s2/root", x: 200, y: 400, label: "s2/root", color: COLORS.cyan, delay: 90 },
    { id: "f-d4e5f6-1", x: 800, y: 120, label: "f-d4e5f6-1", color: COLORS.pink, delay: 110 },
  ];

  const edges = [
    { from: 0, to: 1, delay: 55 },
    { from: 0, to: 2, delay: 65 },
    { from: 1, to: 4, delay: 105 },
  ];

  return (
    <AbsoluteFill style={{ padding: 60 }}>
      <div
        style={{
          opacity: headerOpacity,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 30,
        }}
      >
        <div style={{ width: 8, height: 40, backgroundColor: COLORS.orange, borderRadius: 4 }} />
        <div
          style={{ fontSize: 40, fontWeight: 700, color: COLORS.white, fontFamily: FONTS.heading }}
        >
          Fork Detection & Conversation Trees
        </div>
      </div>

      <div style={{ display: "flex", gap: 40 }}>
        {/* Tree visualization */}
        <div style={{ position: "relative", width: 950, height: 500 }}>
          {/* Edges */}
          <svg
            role="img"
            aria-label="Terminal network diagram"
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
          >
            {edges.map(({ from, to, delay }, i) => {
              const progress = interpolate(frame - delay, [0, 20], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const fromNode = nodes[from];
              const toNode = nodes[to];
              return (
                <line
                  // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
                  key={i}
                  x1={fromNode.x + 80}
                  y1={fromNode.y + 20}
                  x2={fromNode.x + 80 + (toNode.x - fromNode.x) * progress}
                  y2={fromNode.y + 20 + (toNode.y - fromNode.y) * progress}
                  stroke={COLORS.textDim}
                  strokeWidth={2}
                  strokeDasharray="6,4"
                />
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map((node) => {
            const nodeOpacity = interpolate(frame - node.delay, [0, 12], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const nodeScale = interpolate(frame - node.delay, [0, 12], [0.5, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div
                key={node.id}
                style={{
                  position: "absolute",
                  left: node.x,
                  top: node.y,
                  opacity: nodeOpacity,
                  transform: `scale(${nodeScale})`,
                  backgroundColor: COLORS.card,
                  border: `2px solid ${node.color}`,
                  borderRadius: 10,
                  padding: "8px 16px",
                  fontFamily: FONTS.mono,
                  fontSize: 15,
                  color: node.color,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {node.label}
              </div>
            );
          })}

          {/* Labels */}
          <FadeInText
            text="Message UUID anchoring — NOT turn numbers"
            delay={130}
            fontSize={17}
            color={COLORS.textMuted}
            style={{ position: "absolute", bottom: 20, left: 0 }}
          />
          <FadeInText
            text="Turn numbers break after compaction. UUIDs are permanent."
            delay={145}
            fontSize={15}
            color={COLORS.textDim}
            style={{ position: "absolute", bottom: 0, left: 0 }}
          />
        </div>

        {/* Fork features */}
        <div style={{ width: 400 }}>
          <AnimatedBox title="Fork Anchoring" accentColor={COLORS.orange} delay={50} width={380}>
            <div style={{ marginTop: 8 }}>
              <FadeInText
                text="Uses message UUID (first 6 chars)"
                delay={80}
                fontSize={14}
                color={COLORS.textMuted}
              />
              <FadeInText
                text="Survives compaction"
                delay={90}
                fontSize={14}
                color={COLORS.green}
              />
              <FadeInText
                text="Fork-of-fork support"
                delay={100}
                fontSize={14}
                color={COLORS.accent}
              />
            </div>
          </AnimatedBox>

          <div style={{ marginTop: 20 }}>
            <AnimatedBox title="Session Ordinals" accentColor={COLORS.cyan} delay={120} width={380}>
              <div style={{ marginTop: 8 }}>
                <FadeInText
                  text="s1, s2, s3... per crash/restart"
                  delay={135}
                  fontSize={14}
                  color={COLORS.textMuted}
                />
                <FadeInText
                  text="Tracks source: startup, compaction, fork"
                  delay={145}
                  fontSize={14}
                  color={COLORS.textMuted}
                />
              </div>
            </AnimatedBox>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 6: Nickname Layer ──────────────────────────────────

const Scene6Nicknames: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const slashCommandScale = spring({
    frame: Math.max(0, frame - 30),
    fps,
    config: { damping: 10, stiffness: 120, mass: 0.5 },
  });

  const terminals = [
    { tid: "t-9e324ae0", name: "phoenix", project: "REBUILD", color: COLORS.accent },
    { tid: "t-3f7a8b2c", name: "mmx-engine", project: "mmx", color: COLORS.green },
    { tid: "t-d1e2f3a4", name: "video-lab", project: "remotion-videos", color: COLORS.orange },
  ];

  return (
    <AbsoluteFill style={{ padding: 60 }}>
      <div
        style={{
          opacity: headerOpacity,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 40,
        }}
      >
        <div style={{ width: 8, height: 40, backgroundColor: COLORS.pink, borderRadius: 4 }} />
        <div
          style={{ fontSize: 40, fontWeight: 700, color: COLORS.white, fontFamily: FONTS.heading }}
        >
          Human Nickname Layer
        </div>
      </div>

      {/* Slash command demo */}
      <div
        style={{
          transform: `scale(${slashCommandScale})`,
          transformOrigin: "left center",
          marginBottom: 40,
        }}
      >
        <div
          style={{
            backgroundColor: "#0d1117",
            border: `2px solid ${COLORS.accent}`,
            borderRadius: 12,
            padding: "16px 24px",
            display: "inline-block",
          }}
        >
          <span style={{ fontFamily: FONTS.mono, fontSize: 24, color: COLORS.textDim }}>
            {"$ "}
          </span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 24, color: COLORS.accent }}>/name</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 24, color: COLORS.white }}>
            {" phoenix"}
          </span>
        </div>
      </div>

      {/* Terminal cards */}
      <div style={{ display: "flex", gap: 24, marginTop: 20 }}>
        {terminals.map((t, i) => {
          const delay = 60 + i * 25;
          const cardOpacity = interpolate(frame - delay, [0, 15], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const cardY = interpolate(frame - delay, [0, 15], [30, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={t.tid}
              style={{
                opacity: cardOpacity,
                transform: `translateY(${cardY}px)`,
                backgroundColor: COLORS.card,
                border: `2px solid ${t.color}`,
                borderRadius: 12,
                padding: 24,
                width: 340,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    backgroundColor: t.color,
                  }}
                />
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: t.color,
                    fontFamily: FONTS.mono,
                  }}
                >
                  {t.name}
                </div>
              </div>
              <div style={{ fontSize: 14, color: COLORS.textMuted, fontFamily: FONTS.mono }}>
                {t.tid}
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: COLORS.textDim,
                  fontFamily: FONTS.mono,
                  marginTop: 4,
                }}
              >
                project: {t.project}
              </div>

              {/* Statusline preview */}
              <div
                style={{
                  marginTop: 16,
                  backgroundColor: COLORS.bg,
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontFamily: FONTS.mono,
                  fontSize: 12,
                  color: COLORS.textDim,
                  display: "flex",
                  gap: 12,
                }}
              >
                <span style={{ color: t.color }}>{t.name}</span>
                <span>|</span>
                <span>s1/root</span>
                <span>|</span>
                <span style={{ color: COLORS.green }}>42%</span>
              </div>
            </div>
          );
        })}
      </div>

      <FadeInText
        text="Both names resolve to the same terminal. System works without nicknames."
        delay={140}
        fontSize={18}
        color={COLORS.textMuted}
        style={{ marginTop: 30 }}
      />
    </AbsoluteFill>
  );
};

// ─── Scene 7: Outro ───────────────────────────────────────────

const Scene7Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({
    frame,
    fps,
    config: { damping: 12, mass: 0.5, stiffness: 80 },
  });
  const statsOpacity = interpolate(frame, [50, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const brandOpacity = interpolate(frame, [100, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const stats = [
    { label: "Register", color: COLORS.blue },
    { label: "Track", color: COLORS.green },
    { label: "Fork", color: COLORS.orange },
    { label: "Name", color: COLORS.pink },
    { label: "Recover", color: COLORS.accent },
  ];

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ textAlign: "center", transform: `scale(${titleScale})` }}>
        <div
          style={{
            fontSize: 36,
            color: COLORS.text,
            fontFamily: FONTS.body,
            lineHeight: 1.6,
            maxWidth: 800,
          }}
        >
          Every terminal has a name.
          <br />
          <span style={{ color: COLORS.accent, fontWeight: 700 }}>Every session has a story.</span>
        </div>
      </div>

      <div
        style={{
          opacity: statsOpacity,
          display: "flex",
          gap: 8,
          marginTop: 50,
          alignItems: "center",
        }}
      >
        {stats.map(({ label, color }, i) => (
          <div key={label} style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                backgroundColor: COLORS.card,
                border: `2px solid ${color}`,
                borderRadius: 8,
                padding: "8px 18px",
                color,
                fontSize: 16,
                fontWeight: 600,
                fontFamily: FONTS.mono,
              }}
            >
              {label}
            </div>
            {i < stats.length - 1 && (
              <span style={{ color: COLORS.textDim, fontSize: 18, marginLeft: 8 }}>→</span>
            )}
          </div>
        ))}
      </div>

      <div style={{ opacity: brandOpacity, marginTop: 60, textAlign: "center" }}>
        <div
          style={{
            fontSize: 48,
            fontWeight: 800,
            color: COLORS.white,
            fontFamily: FONTS.heading,
            letterSpacing: -1,
          }}
        >
          Terminal Identity System
        </div>
        <div
          style={{
            fontSize: 20,
            color: COLORS.accent,
            fontFamily: FONTS.body,
            marginTop: 8,
          }}
        >
          Session Lineage for Claude Code
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Main Composition ─────────────────────────────────────────

export const TIDExplainer: React.FC<TIDExplainerProps> = ({
  scenes,
  backgroundColor,
  useAudio,
}) => {
  const sceneComponents = [
    Scene1Title,
    Scene2Problem,
    Scene3Solution,
    Scene4Registration,
    Scene5Forks,
    Scene6Nicknames,
    Scene7Outro,
  ];

  let currentFrame = 0;

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {scenes.map((scene, i) => {
        const SceneComponent = sceneComponents[i];
        if (!SceneComponent) return null;
        const duration = scene.durationSeconds * 30;
        const start = currentFrame;
        currentFrame += duration;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
          <React.Fragment key={i}>
            <Sequence from={start} durationInFrames={duration}>
              <SceneComponent />
            </Sequence>
            {useAudio && (
              <Sequence from={start} durationInFrames={duration}>
                <Audio src={staticFile(`audio/tid-scene${i + 1}.mp3`)} />
              </Sequence>
            )}
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

// ─── Default Props ────────────────────────────────────────────

export const defaultTIDExplainerProps: TIDExplainerProps = {
  scenes: [
    {
      title: "Title",
      narration:
        "Terminal Identity System. DNS-inspired session tracking for Claude Code. Every terminal gets an identity. Every session gets a lineage.",
      durationSeconds: 8,
    },
    {
      title: "The Problem",
      narration:
        "Claude Code stores sessions as flat UUID files. There is no concept of which terminal produced which session, which session forked from which, or what the conversation tree looks like. When terminals crash or compact, the connection between sessions is lost.",
      durationSeconds: 14,
    },
    {
      title: "DNS-Inspired Addressing",
      narration:
        "The solution is a DNS-inspired address system. Just like the internet uses TLDs, domains, and subdomains, we use hostname, project, and terminal ID. Every session gets a fully qualified address — auto-generated, zero user effort. Terminal IDs use 8 hex chars from a hash of hostname, PID, and timestamp.",
      durationSeconds: 16,
    },
    {
      title: "Registration Flow",
      narration:
        "When Claude Code opens a terminal, a SessionStart hook fires. A shell script invokes a Python registry manager that generates or retrieves the terminal ID. It uses atomic writes with file locking, corruption recovery via backup files, and stores per-project TID files for fast lookup.",
      durationSeconds: 16,
    },
    {
      title: "Fork Detection",
      narration:
        "When a conversation forks, the system detects it and records the fork point using message UUIDs, not turn numbers. Turn numbers break after compaction, but message UUIDs are permanent. This creates a full conversation tree — forks of forks, session ordinals after crashes, complete lineage.",
      durationSeconds: 14,
    },
    {
      title: "Nickname Layer",
      narration:
        "Users can name their terminals with a simple slash command. Type slash name phoenix, and terminal t-9e324ae0 becomes phoenix. Both names resolve to the same terminal. The system works without nicknames — they are a convenience layer, not a requirement.",
      durationSeconds: 12,
    },
    {
      title: "Outro",
      narration:
        "Every terminal has a name. Every session has a story. Terminal Identity System — session lineage for Claude Code.",
      durationSeconds: 8,
    },
  ],
  backgroundColor: "#0f1117",
  accentColor: "#6366f1",
  textColor: "#e2e8f0",
  brandName: "Terminal Identity System",
  useAudio: false,
};
