import type React from "react";
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

export const iranUpdateSchema = z.object({
  useAudio: z.boolean().default(true),
});

type IranUpdateProps = z.infer<typeof iranUpdateSchema>;

// ─── Constants ────────────────────────────────────────────────

const C = {
  bg: "#0a0c10",
  card: "#141820",
  cardBorder: "#1e2430",
  red: "#ef4444",
  redDark: "#991b1b",
  orange: "#f97316",
  amber: "#f59e0b",
  blue: "#3b82f6",
  cyan: "#06b6d4",
  white: "#ffffff",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  textDim: "#64748b",
  green: "#22c55e",
} as const;

const FONTS = {
  heading: "Inter, system-ui, sans-serif",
  body: "Inter, system-ui, sans-serif",
  mono: "JetBrains Mono, Fira Code, monospace",
} as const;

// ─── Primitives ───────────────────────────────────────────────

const FadeIn: React.FC<{
  delay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, children, style }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame - delay, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame - delay, [0, 15], [12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <div style={{ opacity, transform: `translateY(${y}px)`, ...style }}>{children}</div>;
};

const StatCard: React.FC<{
  value: string;
  label: string;
  color: string;
  delay: number;
}> = ({ value, label, color, delay }) => {
  const frame = useCurrentFrame();
  const scale = spring({
    frame: Math.max(0, frame - delay),
    fps: 30,
    config: { damping: 12, stiffness: 120, mass: 0.5 },
  });
  return (
    <div
      style={{
        transform: `scale(${scale})`,
        backgroundColor: C.card,
        border: `2px solid ${color}`,
        borderRadius: 16,
        padding: "24px 32px",
        textAlign: "center",
        minWidth: 200,
      }}
    >
      <div
        style={{
          fontSize: 48,
          fontWeight: 800,
          color,
          fontFamily: FONTS.heading,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 16,
          color: C.textMuted,
          fontFamily: FONTS.body,
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
};

const BreakingBanner: React.FC<{ delay?: number }> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const width = interpolate(frame - delay, [0, 20], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const textOp = interpolate(frame - delay, [15, 25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulse = Math.sin((frame - delay) * 0.15) * 0.15 + 0.85;
  return (
    <div style={{ position: "relative", marginBottom: 20 }}>
      <div
        style={{
          width: `${width}%`,
          height: 4,
          background: `linear-gradient(90deg, ${C.red}, ${C.orange})`,
          borderRadius: 2,
          opacity: pulse,
        }}
      />
      <div
        style={{
          opacity: textOp,
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 10,
        }}
      >
        <div
          style={{
            backgroundColor: C.red,
            color: C.white,
            fontSize: 13,
            fontWeight: 800,
            padding: "4px 12px",
            borderRadius: 4,
            fontFamily: FONTS.mono,
            letterSpacing: 2,
          }}
        >
          DEVELOPING
        </div>
        <div
          style={{
            fontSize: 14,
            color: C.textDim,
            fontFamily: FONTS.mono,
          }}
        >
          March 6, 2026 — Day 7
        </div>
      </div>
    </div>
  );
};

// ─── Scene 1: Opening ─────────────────────────────────────────

const Scene1Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({
    frame,
    fps,
    config: { damping: 14, mass: 0.6, stiffness: 100 },
  });

  const subtitleOp = interpolate(frame, [25, 45], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const dateOp = interpolate(frame, [50, 65], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: `radial-gradient(ellipse at center, ${C.redDark}33 0%, ${C.bg} 70%)`,
      }}
    >
      <BreakingBanner delay={5} />
      <div style={{ textAlign: "center", transform: `scale(${titleScale})` }}>
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: C.white,
            fontFamily: FONTS.heading,
            letterSpacing: -2,
            lineHeight: 1.1,
          }}
        >
          US-Israel War on Iran
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 300,
            color: C.red,
            fontFamily: FONTS.heading,
            marginTop: 12,
          }}
        >
          Day 7 — What We Know
        </div>
      </div>
      <div
        style={{
          opacity: subtitleOp,
          fontSize: 22,
          color: C.textMuted,
          textAlign: "center",
          maxWidth: 700,
          lineHeight: 1.6,
          marginTop: 30,
          fontFamily: FONTS.body,
        }}
      >
        Joint US-Israeli air campaign enters its second week as Iran retaliates with missile and
        drone strikes across the Gulf
      </div>
      <div
        style={{
          opacity: dateOp,
          fontSize: 16,
          color: C.textDim,
          fontFamily: FONTS.mono,
          marginTop: 20,
        }}
      >
        Updated: March 6, 2026
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 2: How It Started ──────────────────────────────────

const Scene2Timeline: React.FC = () => {
  const frame = useCurrentFrame();

  const events = [
    {
      date: "Feb 28",
      text: "US and Israel launch joint air strikes on Iran",
      color: C.red,
      delay: 20,
    },
    {
      date: "Feb 28",
      text: "Supreme Leader Ali Khamenei assassinated in strikes",
      color: C.red,
      delay: 45,
    },
    {
      date: "Mar 1",
      text: "Iran retaliates with 500+ ballistic missiles, 2,000 drones",
      color: C.orange,
      delay: 70,
    },
    {
      date: "Mar 3",
      text: "Iran strikes US bases, embassies, and Gulf allies",
      color: C.orange,
      delay: 95,
    },
    {
      date: "Mar 5",
      text: "US Senate war powers vote fails — strikes continue",
      color: C.amber,
      delay: 120,
    },
    {
      date: "Mar 6",
      text: "Israel launches fresh wave on 'regime infrastructure'",
      color: C.red,
      delay: 145,
    },
  ];

  const headerOp = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ padding: 70 }}>
      <div
        style={{
          opacity: headerOp,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 40,
        }}
      >
        <div style={{ width: 8, height: 40, backgroundColor: C.red, borderRadius: 4 }} />
        <div style={{ fontSize: 40, fontWeight: 700, color: C.white, fontFamily: FONTS.heading }}>
          Timeline of Events
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {events.map(({ date, text, color, delay }) => {
          const op = interpolate(frame - delay, [0, 12], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const x = interpolate(frame - delay, [0, 12], [-30, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={date + text}
              style={{
                opacity: op,
                transform: `translateX(${x}px)`,
                display: "flex",
                alignItems: "center",
                gap: 20,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  backgroundColor: color,
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  backgroundColor: C.card,
                  borderLeft: `3px solid ${color}`,
                  borderRadius: 10,
                  padding: "12px 20px",
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    color: C.textDim,
                    fontFamily: FONTS.mono,
                    minWidth: 60,
                  }}
                >
                  {date}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    color: C.text,
                    fontFamily: FONTS.body,
                    fontWeight: 500,
                  }}
                >
                  {text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 3: The Numbers ─────────────────────────────────────

const Scene3Stats: React.FC = () => {
  const frame = useCurrentFrame();

  const headerOp = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ padding: 70 }}>
      <div
        style={{
          opacity: headerOp,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 50,
        }}
      >
        <div style={{ width: 8, height: 40, backgroundColor: C.orange, borderRadius: 4 }} />
        <div style={{ fontSize: 40, fontWeight: 700, color: C.white, fontFamily: FONTS.heading }}>
          By the Numbers
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
        <StatCard value="1,300+" label="Killed in Iran" color={C.red} delay={20} />
        <StatCard value="181" label="Children (UNICEF)" color={C.orange} delay={35} />
        <StatCard value="500+" label="Iranian Missiles Fired" color={C.amber} delay={50} />
        <StatCard value="2,000" label="Drones Launched by Iran" color={C.blue} delay={65} />
      </div>

      <div style={{ display: "flex", gap: 24, justifyContent: "center", marginTop: 24 }}>
        <StatCard value="7" label="Days of Conflict" color={C.cyan} delay={80} />
        <StatCard value="B-2" label="Stealth Bombers Deployed" color={C.textDim} delay={95} />
        <StatCard value="6" label="Missile Launchers Destroyed" color={C.green} delay={110} />
      </div>

      <FadeIn delay={130} style={{ textAlign: "center", marginTop: 30 }}>
        <div style={{ fontSize: 16, color: C.textDim, fontFamily: FONTS.mono }}>
          Sources: Al Jazeera, UNICEF, Fars News Agency — March 6, 2026
        </div>
      </FadeIn>
    </AbsoluteFill>
  );
};

// ─── Scene 4: Military Operations ─────────────────────────────

const Scene4Military: React.FC = () => {
  const frame = useCurrentFrame();

  const headerOp = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const usActions = [
    { text: "B-2 bombers dropping 2,000-lb penetrator bombs on buried launchers", delay: 25 },
    { text: "Israel claims 6 missile launchers, 3 defense systems destroyed overnight", delay: 50 },
    { text: "Fresh wave targeting 'regime infrastructure' in Tehran", delay: 75 },
    { text: "Defense Sec. Hegseth warns bombardment will 'surge dramatically'", delay: 100 },
  ];

  const iranActions = [
    { text: "500+ ballistic and naval missiles fired since Feb 28", delay: 30 },
    { text: "~2,000 drones launched across the region", delay: 55 },
    { text: "Struck US-owned oil tanker off Kuwait coast", delay: 80 },
    { text: "Attacked US bases and embassies across the Gulf", delay: 105 },
  ];

  return (
    <AbsoluteFill style={{ padding: 60 }}>
      <div
        style={{
          opacity: headerOp,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 40,
        }}
      >
        <div style={{ width: 8, height: 40, backgroundColor: C.blue, borderRadius: 4 }} />
        <div style={{ fontSize: 40, fontWeight: 700, color: C.white, fontFamily: FONTS.heading }}>
          Military Operations
        </div>
      </div>

      <div style={{ display: "flex", gap: 30 }}>
        {/* US/Israel column */}
        <div style={{ flex: 1 }}>
          <FadeIn delay={15}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: C.blue,
                fontFamily: FONTS.heading,
                marginBottom: 16,
              }}
            >
              US / Israel
            </div>
          </FadeIn>
          {usActions.map(({ text, delay }) => (
            <FadeIn key={text} delay={delay} style={{ marginBottom: 14 }}>
              <div
                style={{
                  backgroundColor: C.card,
                  borderLeft: `3px solid ${C.blue}`,
                  borderRadius: 8,
                  padding: "10px 16px",
                  fontSize: 17,
                  color: C.text,
                  fontFamily: FONTS.body,
                  lineHeight: 1.5,
                }}
              >
                {text}
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Divider */}
        <div style={{ width: 2, backgroundColor: C.cardBorder, borderRadius: 1 }} />

        {/* Iran column */}
        <div style={{ flex: 1 }}>
          <FadeIn delay={15}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: C.orange,
                fontFamily: FONTS.heading,
                marginBottom: 16,
              }}
            >
              Iran
            </div>
          </FadeIn>
          {iranActions.map(({ text, delay }) => (
            <FadeIn key={text} delay={delay} style={{ marginBottom: 14 }}>
              <div
                style={{
                  backgroundColor: C.card,
                  borderLeft: `3px solid ${C.orange}`,
                  borderRadius: 8,
                  padding: "10px 16px",
                  fontSize: 17,
                  color: C.text,
                  fontFamily: FONTS.body,
                  lineHeight: 1.5,
                }}
              >
                {text}
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 5: Humanitarian / Cities ───────────────────────────

const Scene5Humanitarian: React.FC = () => {
  const frame = useCurrentFrame();

  const headerOp = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cities = [
    {
      name: "Tehran",
      detail: "Heavy bombing — residential areas, govt buildings",
      color: C.red,
      delay: 25,
    },
    {
      name: "Shiraz",
      detail: "30+ injured, paramedics killed in strikes",
      color: C.red,
      delay: 45,
    },
    {
      name: "Isfahan",
      detail: "Military and civilian infrastructure hit",
      color: C.orange,
      delay: 60,
    },
    {
      name: "Qom",
      detail: "Forced displacement orders in industrial zone",
      color: C.orange,
      delay: 75,
    },
    { name: "Minab", detail: "165+ killed in school strike on Day 1", color: C.red, delay: 90 },
    { name: "Kermanshah", detail: "Ongoing airstrikes reported", color: C.amber, delay: 105 },
  ];

  const footerOp = interpolate(frame, [130, 150], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ padding: 60 }}>
      <div
        style={{
          opacity: headerOp,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 35,
        }}
      >
        <div style={{ width: 8, height: 40, backgroundColor: C.red, borderRadius: 4 }} />
        <div style={{ fontSize: 40, fontWeight: 700, color: C.white, fontFamily: FONTS.heading }}>
          Humanitarian Impact
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {cities.map(({ name, detail, color, delay }) => {
          const op = interpolate(frame - delay, [0, 12], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={name}
              style={{
                opacity: op,
                backgroundColor: C.card,
                border: `1px solid ${C.cardBorder}`,
                borderLeft: `4px solid ${color}`,
                borderRadius: 10,
                padding: "14px 20px",
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: FONTS.heading }}>
                {name}
              </div>
              <div
                style={{
                  fontSize: 16,
                  color: C.textMuted,
                  fontFamily: FONTS.body,
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {detail}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          opacity: footerOp,
          marginTop: 30,
          backgroundColor: `${C.red}15`,
          border: `1px solid ${C.red}40`,
          borderRadius: 10,
          padding: "14px 20px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 18, color: C.red, fontFamily: FONTS.body, fontWeight: 600 }}>
          Civilian sites including schools, hospitals, petrol stations, and residential buildings
          are among targets
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 6: Diplomatic / International ──────────────────────

const Scene6Diplomatic: React.FC = () => {
  const frame = useCurrentFrame();

  const headerOp = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const items = [
    {
      who: "Trump",
      quote: "War to last 4-5 weeks. Iran has 'lost everything.'",
      color: C.blue,
      delay: 25,
    },
    {
      who: "Pezeshkian (Iran)",
      quote: "Called for mediation addressing those 'who ignited this conflict'",
      color: C.orange,
      delay: 55,
    },
    {
      who: "Russia",
      quote: "Reportedly providing Iran with intelligence on US troop movements",
      color: C.red,
      delay: 85,
    },
    {
      who: "US Senate",
      quote: "War powers vote to halt strikes failed on March 4",
      color: C.amber,
      delay: 115,
    },
    {
      who: "United Nations",
      quote: "Urging restraint from all parties as civilian toll mounts",
      color: C.cyan,
      delay: 140,
    },
  ];

  return (
    <AbsoluteFill style={{ padding: 60 }}>
      <div
        style={{
          opacity: headerOp,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 40,
        }}
      >
        <div style={{ width: 8, height: 40, backgroundColor: C.cyan, borderRadius: 4 }} />
        <div style={{ fontSize: 40, fontWeight: 700, color: C.white, fontFamily: FONTS.heading }}>
          International Response
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {items.map(({ who, quote, color, delay }) => {
          const op = interpolate(frame - delay, [0, 15], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const x = interpolate(frame - delay, [0, 15], [20, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={who}
              style={{
                opacity: op,
                transform: `translateX(${x}px)`,
                backgroundColor: C.card,
                borderLeft: `4px solid ${color}`,
                borderRadius: 10,
                padding: "14px 24px",
                display: "flex",
                alignItems: "center",
                gap: 20,
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color,
                  fontFamily: FONTS.heading,
                  minWidth: 160,
                }}
              >
                {who}
              </div>
              <div
                style={{
                  fontSize: 18,
                  color: C.text,
                  fontFamily: FONTS.body,
                  lineHeight: 1.5,
                }}
              >
                {quote}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 7: Closing ─────────────────────────────────────────

const Scene7Closing: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({
    frame,
    fps,
    config: { damping: 14, mass: 0.5, stiffness: 80 },
  });

  const sourceOp = interpolate(frame, [60, 80], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: `radial-gradient(ellipse at center, ${C.redDark}22 0%, ${C.bg} 70%)`,
      }}
    >
      <div style={{ textAlign: "center", transform: `scale(${titleScale})` }}>
        <div
          style={{
            fontSize: 28,
            color: C.textMuted,
            fontFamily: FONTS.body,
            marginBottom: 12,
          }}
        >
          This is a developing story.
        </div>
        <div
          style={{
            fontSize: 48,
            fontWeight: 800,
            color: C.white,
            fontFamily: FONTS.heading,
            letterSpacing: -1,
            lineHeight: 1.3,
            maxWidth: 800,
          }}
        >
          The situation in Iran
          <br />
          <span style={{ color: C.red }}>remains fluid.</span>
        </div>
      </div>

      <div
        style={{
          opacity: sourceOp,
          marginTop: 50,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 14, color: C.textDim, fontFamily: FONTS.mono }}>
          Sources: Al Jazeera, CNN, UNICEF, Euronews, Critical Threats, UN News
        </div>
        <div style={{ fontSize: 14, color: C.textDim, fontFamily: FONTS.mono, marginTop: 6 }}>
          March 6, 2026
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Main Composition ─────────────────────────────────────────

const SCENE_DURATIONS = [240, 510, 420, 510, 540, 570, 210]; // frames at 30fps, total ~113s

export const IranUpdate: React.FC<IranUpdateProps> = ({ useAudio }) => {
  const scenes = [
    Scene1Opening,
    Scene2Timeline,
    Scene3Stats,
    Scene4Military,
    Scene5Humanitarian,
    Scene6Diplomatic,
    Scene7Closing,
  ];

  let currentFrame = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {scenes.map((SceneComponent, i) => {
        const start = currentFrame;
        const duration = SCENE_DURATIONS[i];
        currentFrame += duration;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
          <Sequence key={i} from={start} durationInFrames={duration}>
            <SceneComponent />
          </Sequence>
        );
      })}
      {useAudio && <Audio src={staticFile("audio/iran-update-voiceover.mp3")} />}
    </AbsoluteFill>
  );
};

export const defaultIranUpdateProps: IranUpdateProps = {
  useAudio: true,
};

export const IRAN_UPDATE_DURATION = SCENE_DURATIONS.reduce((a, b) => a + b, 0);
