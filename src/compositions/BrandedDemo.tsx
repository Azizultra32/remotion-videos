import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Img,
  staticFile,
} from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import type { CalculateMetadataFunction } from "remotion";

// ── Timing constants ────────────────────────────────────────────────────────────

export const INTRO_DURATION = 90; // 3 seconds at 30fps
export const FEATURE_DURATION = 75; // 2.5 seconds per feature
export const CTA_DURATION = 90; // 3 seconds

// ── Zod Schemas ─────────────────────────────────────────────────────────────────

const brandColorsSchema = z.object({
  primary: zColor(),
  secondary: zColor(),
  accent: zColor(),
  background: zColor(),
  text: zColor(),
});

const brandConfigSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  colors: brandColorsSchema,
  typography: z.object({
    heading: z.string(),
    body: z.string(),
  }),
  social: z
    .object({
      website: z.string().optional(),
      twitter: z.string().optional(),
    })
    .optional(),
});

const featureSchema = z.object({
  title: z.string(),
  description: z.string(),
  icon: z.string(),
});

export const brandedDemoSchema = z.object({
  brandName: z.string(),
  brandConfig: brandConfigSchema,
  features: z.array(featureSchema),
  ctaText: z.string(),
  showLogo: z.boolean(),
});

// ── Types (derived from schema) ─────────────────────────────────────────────────

type BrandColors = z.infer<typeof brandColorsSchema>;
type BrandConfig = z.infer<typeof brandConfigSchema>;
type Feature = z.infer<typeof featureSchema>;
export type BrandedDemoProps = z.infer<typeof brandedDemoSchema>;

// ── calculateMetadata ───────────────────────────────────────────────────────────

export const calculateBrandedDemoMetadata: CalculateMetadataFunction<
  BrandedDemoProps
> = ({ props }) => {
  const duration =
    INTRO_DURATION + props.features.length * FEATURE_DURATION + CTA_DURATION;
  return {
    durationInFrames: duration,
  };
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const IntroSection: React.FC<{
  config: BrandConfig;
  showLogo: boolean;
  brandName: string;
}> = ({ config, showLogo, brandName }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 12, mass: 0.5 } });
  const titleY = spring({
    frame: frame - 10,
    fps,
    config: { damping: 14 },
  });
  const taglineOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const underlineWidth = interpolate(frame, [40, 70], [0, 200], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: config.colors.background,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* Decorative gradient orb */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${config.colors.primary}22, transparent 70%)`,
          top: -100,
          right: -100,
        }}
      />

      {showLogo && (
        <div
          style={{
            transform: `scale(${logoScale})`,
            marginBottom: 20,
          }}
        >
          <Img
            src={staticFile(`brands/${brandName}/logos/logo.svg`)}
            style={{ width: 160, height: 160, objectFit: "contain" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      <h1
        style={{
          fontFamily: config.typography.heading,
          fontSize: 80,
          fontWeight: 800,
          color: config.colors.text,
          margin: 0,
          transform: `translateY(${interpolate(titleY, [0, 1], [40, 0])}px)`,
          opacity: titleY,
          letterSpacing: -2,
        }}
      >
        {config.name}
      </h1>

      <div
        style={{
          width: underlineWidth,
          height: 4,
          borderRadius: 2,
          background: `linear-gradient(90deg, ${config.colors.primary}, ${config.colors.secondary})`,
        }}
      />

      <p
        style={{
          fontFamily: config.typography.body,
          fontSize: 36,
          color: config.colors.primary,
          margin: 0,
          opacity: taglineOpacity,
          fontWeight: 500,
        }}
      >
        {config.tagline}
      </p>
    </AbsoluteFill>
  );
};

const FeatureSlide: React.FC<{
  feature: Feature;
  config: BrandConfig;
  index: number;
}> = ({ feature, config, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100 },
  });

  const iconBounce = spring({
    frame: frame - 8,
    fps,
    config: { damping: 8, mass: 0.6, stiffness: 200 },
  });

  const slideX = interpolate(entrance, [0, 1], [120, 0]);
  const slideOpacity = interpolate(entrance, [0, 1], [0, 1]);

  const isEven = index % 2 === 0;
  const gradientAngle = isEven ? "135deg" : "225deg";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: config.colors.background,
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
      }}
    >
      {/* Accent stripe */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: 6,
          background: `linear-gradient(90deg, ${config.colors.primary}, ${config.colors.accent})`,
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: isEven ? "row" : "row-reverse",
          alignItems: "center",
          gap: 80,
          width: "100%",
          maxWidth: 1600,
          transform: `translateX(${slideX}px)`,
          opacity: slideOpacity,
        }}
      >
        {/* Icon circle */}
        <div
          style={{
            width: 280,
            height: 280,
            borderRadius: "50%",
            background: `linear-gradient(${gradientAngle}, ${config.colors.primary}, ${config.colors.secondary})`,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexShrink: 0,
            transform: `scale(${iconBounce})`,
            boxShadow: `0 20px 60px ${config.colors.primary}33`,
          }}
        >
          <span style={{ fontSize: 100 }}>{feature.icon}</span>
        </div>

        {/* Text content */}
        <div style={{ flex: 1 }}>
          <h2
            style={{
              fontFamily: config.typography.heading,
              fontSize: 56,
              fontWeight: 700,
              color: config.colors.text,
              margin: 0,
              marginBottom: 20,
            }}
          >
            {feature.title}
          </h2>
          <p
            style={{
              fontFamily: config.typography.body,
              fontSize: 30,
              color: config.colors.text + "bb",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            {feature.description}
          </p>
        </div>
      </div>

      {/* Feature number badge */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          right: 60,
          fontFamily: config.typography.heading,
          fontSize: 24,
          fontWeight: 700,
          color: config.colors.primary + "44",
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </div>
    </AbsoluteFill>
  );
};

const CTASection: React.FC<{
  config: BrandConfig;
  ctaText: string;
  brandName: string;
  showLogo: boolean;
}> = ({ config, ctaText, brandName, showLogo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bgScale = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 80 },
  });

  const buttonScale = spring({
    frame: frame - 15,
    fps,
    config: { damping: 10, mass: 0.8 },
  });

  const pulseOpacity = interpolate(
    frame % 40,
    [0, 20, 39],
    [0.4, 0.8, 0.4],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${config.colors.primary}, ${config.colors.secondary})`,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        gap: 40,
      }}
    >
      {/* Pulsing ring */}
      <div
        style={{
          position: "absolute",
          width: 800 * bgScale,
          height: 800 * bgScale,
          borderRadius: "50%",
          border: `2px solid rgba(255,255,255,${pulseOpacity})`,
        }}
      />

      {showLogo && (
        <div style={{ transform: `scale(${bgScale})`, marginBottom: 10 }}>
          <Img
            src={staticFile(`brands/${brandName}/logos/logo.svg`)}
            style={{
              width: 100,
              height: 100,
              objectFit: "contain",
              filter: "brightness(0) invert(1)",
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      <h2
        style={{
          fontFamily: config.typography.heading,
          fontSize: 64,
          fontWeight: 800,
          color: "#ffffff",
          margin: 0,
          opacity: bgScale,
          textAlign: "center",
        }}
      >
        {ctaText}
      </h2>

      {/* CTA button */}
      <div
        style={{
          transform: `scale(${buttonScale})`,
          backgroundColor: "#ffffff",
          borderRadius: 50,
          padding: "18px 60px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
        }}
      >
        <span
          style={{
            fontFamily: config.typography.heading,
            fontSize: 28,
            fontWeight: 700,
            color: config.colors.primary,
          }}
        >
          {config.social?.website?.replace("https://", "") || "Learn More"}
        </span>
      </div>

      {config.social?.twitter && (
        <p
          style={{
            fontFamily: config.typography.body,
            fontSize: 22,
            color: "rgba(255,255,255,0.7)",
            margin: 0,
            opacity: interpolate(frame, [20, 40], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          Follow us {config.social.twitter}
        </p>
      )}
    </AbsoluteFill>
  );
};

// ── Main Composition ───────────────────────────────────────────────────────────

export const BrandedDemo: React.FC<BrandedDemoProps> = ({
  brandName,
  brandConfig,
  features,
  ctaText,
  showLogo,
}) => {
  return (
    <AbsoluteFill>
      {/* Intro */}
      <Sequence from={0} durationInFrames={INTRO_DURATION}>
        <IntroSection
          config={brandConfig}
          showLogo={showLogo}
          brandName={brandName}
        />
      </Sequence>

      {/* Feature slides */}
      {features.map((feature, i) => (
        <Sequence
          key={i}
          from={INTRO_DURATION + i * FEATURE_DURATION}
          durationInFrames={FEATURE_DURATION}
        >
          <FeatureSlide feature={feature} config={brandConfig} index={i} />
        </Sequence>
      ))}

      {/* CTA */}
      <Sequence
        from={INTRO_DURATION + features.length * FEATURE_DURATION}
        durationInFrames={CTA_DURATION}
      >
        <CTASection
          config={brandConfig}
          ctaText={ctaText}
          brandName={brandName}
          showLogo={showLogo}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
