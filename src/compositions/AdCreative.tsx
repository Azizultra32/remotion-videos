import { zColor } from "@remotion/zod-types";
import type React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod Schema
// ---------------------------------------------------------------------------

export const adCreativeSchema = z.object({
  productName: z.string(),
  productImage: z.string(),
  price: z.string(),
  features: z.array(z.string()),
  ctaText: z.string(),
  backgroundColor: zColor(),
  accentColor: zColor(),
  orientation: z.enum(["vertical", "horizontal"]),
  voiceoverUrl: z.string().optional(),
  lipSyncVideoUrl: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Types (derived from schema)
// ---------------------------------------------------------------------------

export type AdCreativeProps = z.infer<typeof adCreativeSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const _TOTAL_FRAMES = 450; // 15 seconds at 30fps

// Section timing (frames)
const REVEAL_START = 0;
const REVEAL_DURATION = 120; // 0–4s
const FEATURES_START = 100;
const FEATURES_DURATION = 180; // ~3.3–9.3s
const PRICE_START = 260;
const PRICE_DURATION = 100; // ~8.6–12s
const CTA_START = 340;
const CTA_DURATION = 110; // ~11.3–15s

// ---------------------------------------------------------------------------
// Product Reveal (zoom in)
// ---------------------------------------------------------------------------

const ProductReveal: React.FC<{
  productName: string;
  productImage: string;
  accentColor: string;
  textColor: string;
  isVertical: boolean;
}> = ({ productName, productImage, accentColor, textColor, isVertical }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const zoom = interpolate(frame, [0, 90], [1.3, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  const nameSlide = spring({
    frame: Math.max(0, frame - 30),
    fps,
    config: { damping: 14, stiffness: 100 },
  });

  const imgSize = isVertical ? 360 : 320;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      {/* Product image with zoom */}
      <div
        style={{
          width: imgSize,
          height: imgSize,
          borderRadius: 24,
          overflow: "hidden",
          boxShadow: `0 20px 60px ${accentColor}44`,
          transform: `scale(${zoom})`,
        }}
      >
        {productImage ? (
          <Img
            src={productImage}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: `linear-gradient(135deg, ${accentColor}, ${accentColor}88)`,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontSize: 80,
              color: "rgba(255,255,255,0.3)",
              fontFamily: "system-ui, sans-serif",
              fontWeight: 800,
            }}
          >
            {productName.charAt(0)}
          </div>
        )}
      </div>

      {/* Product name */}
      <h1
        style={{
          fontSize: isVertical ? 52 : 56,
          fontWeight: 800,
          color: textColor,
          fontFamily: "system-ui, sans-serif",
          marginTop: 32,
          transform: `translateY(${interpolate(nameSlide, [0, 1], [50, 0])}px)`,
          opacity: interpolate(nameSlide, [0, 1], [0, 1]),
          textAlign: "center",
        }}
      >
        {productName}
      </h1>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Feature Highlights (animated list)
// ---------------------------------------------------------------------------

const FeatureHighlights: React.FC<{
  features: string[];
  accentColor: string;
  textColor: string;
  isVertical: boolean;
}> = ({ features, accentColor, textColor, isVertical }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const STAGGER = 25; // frames between each feature appearing

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isVertical ? "flex-start" : "center",
        justifyContent: "center",
        padding: isVertical ? "0 60px" : "0 120px",
      }}
    >
      <h2
        style={{
          fontSize: isVertical ? 36 : 40,
          fontWeight: 700,
          color: textColor,
          fontFamily: "system-ui, sans-serif",
          marginBottom: 32,
          opacity: interpolate(frame, [0, 15], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Why you'll love it
      </h2>
      {features.map((feature, i) => {
        const delay = i * STAGGER + 15;
        const slideIn = spring({
          frame: Math.max(0, frame - delay),
          fps,
          config: { damping: 16, stiffness: 120 },
        });

        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 20,
              transform: `translateX(${interpolate(slideIn, [0, 1], [-200, 0])}px)`,
              opacity: interpolate(slideIn, [0, 1], [0, 1]),
            }}
          >
            {/* Checkmark circle */}
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                backgroundColor: accentColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg
                role="img"
                aria-label="Ad creative decoration"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M5 13l4 4L19 7"
                  stroke="#fff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span
              style={{
                fontSize: isVertical ? 24 : 28,
                fontWeight: 500,
                color: textColor,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {feature}
            </span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Price Tag (animated)
// ---------------------------------------------------------------------------

const PriceTag: React.FC<{
  price: string;
  productName: string;
  accentColor: string;
  textColor: string;
  isVertical: boolean;
}> = ({ price, productName, accentColor, textColor, isVertical }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scaleIn = spring({
    frame,
    fps,
    config: { damping: 8, stiffness: 150, mass: 0.7 },
  });

  const tagRotate = interpolate(scaleIn, [0, 1], [-15, 0]);

  // Subtle shimmer
  const shimmer = interpolate(Math.sin(frame * 0.1), [-1, 1], [0.85, 1]);

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <p
        style={{
          fontSize: isVertical ? 24 : 28,
          color: textColor,
          fontFamily: "system-ui, sans-serif",
          opacity: 0.7,
          marginBottom: 20,
        }}
      >
        {productName}
      </p>

      <div
        style={{
          transform: `scale(${interpolate(scaleIn, [0, 1], [0, 1])}) rotate(${tagRotate}deg)`,
          backgroundColor: accentColor,
          padding: isVertical ? "32px 56px" : "36px 72px",
          borderRadius: 20,
          boxShadow: `0 12px 40px ${accentColor}66`,
          opacity: shimmer,
        }}
      >
        <span
          style={{
            fontSize: isVertical ? 72 : 80,
            fontWeight: 900,
            color: "#fff",
            fontFamily: "system-ui, sans-serif",
            letterSpacing: -1,
          }}
        >
          {price}
        </span>
      </div>

      <p
        style={{
          fontSize: 18,
          color: textColor,
          fontFamily: "system-ui, sans-serif",
          opacity: interpolate(frame, [40, 60], [0, 0.6], {
            extrapolateRight: "clamp",
            extrapolateLeft: "clamp",
          }),
          marginTop: 16,
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        Limited time offer
      </p>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// CTA with urgency
// ---------------------------------------------------------------------------

const CtaSection: React.FC<{
  ctaText: string;
  accentColor: string;
  textColor: string;
  isVertical: boolean;
}> = ({ ctaText, accentColor, textColor, isVertical }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entryScale = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 160, mass: 0.7 },
  });

  // Pulsing glow after entry
  const pulsePhase = Math.max(0, frame - 20);
  const pulse = 1 + Math.sin(pulsePhase * 0.18) * 0.035;
  const glowIntensity = interpolate(Math.sin(pulsePhase * 0.14), [-1, 1], [0.3, 0.8]);

  // Urgency text fade in
  const urgencyOpacity = interpolate(frame, [25, 50], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  // Countdown feel — flicker the arrow
  const arrowOpacity = interpolate(Math.sin(frame * 0.3), [-1, 1], [0.4, 1]);

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Urgency banner */}
      <div
        style={{
          fontSize: isVertical ? 20 : 22,
          fontWeight: 700,
          color: accentColor,
          fontFamily: "system-ui, sans-serif",
          letterSpacing: 3,
          textTransform: "uppercase",
          marginBottom: 28,
          opacity: urgencyOpacity,
        }}
      >
        Don't miss out — Act now
      </div>

      {/* CTA Button */}
      <div
        style={{
          position: "relative",
          transform: `scale(${interpolate(entryScale, [0, 1], [0, 1]) * pulse})`,
        }}
      >
        {/* Glow behind button */}
        <div
          style={{
            position: "absolute",
            inset: -16,
            borderRadius: 24,
            backgroundColor: accentColor,
            opacity: glowIntensity * 0.3,
            filter: "blur(24px)",
          }}
        />
        <div
          style={{
            padding: isVertical ? "28px 60px" : "32px 80px",
            borderRadius: 18,
            backgroundColor: accentColor,
            display: "flex",
            alignItems: "center",
            gap: 16,
            position: "relative",
          }}
        >
          <span
            style={{
              fontSize: isVertical ? 34 : 40,
              fontWeight: 800,
              color: "#fff",
              fontFamily: "system-ui, sans-serif",
              letterSpacing: 1,
            }}
          >
            {ctaText}
          </span>
          <span
            style={{
              fontSize: isVertical ? 30 : 36,
              color: "#fff",
              opacity: arrowOpacity,
            }}
          >
            →
          </span>
        </div>
      </div>

      {/* Subtext */}
      <p
        style={{
          fontSize: 16,
          color: textColor,
          fontFamily: "system-ui, sans-serif",
          opacity: interpolate(frame, [40, 65], [0, 0.5], {
            extrapolateRight: "clamp",
            extrapolateLeft: "clamp",
          }),
          marginTop: 20,
          letterSpacing: 1,
        }}
      >
        Free shipping • 30-day returns
      </p>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Main AdCreative composition
// ---------------------------------------------------------------------------

export const AdCreative: React.FC<AdCreativeProps> = ({
  productName,
  productImage,
  price,
  features,
  ctaText,
  backgroundColor,
  accentColor,
  orientation,
  voiceoverUrl,
  lipSyncVideoUrl,
}) => {
  const textColor = "#ffffff";
  const isVertical = orientation === "vertical";

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {/* Section 1: Product reveal */}
      <Sequence from={REVEAL_START} durationInFrames={REVEAL_DURATION}>
        <ProductReveal
          productName={productName}
          productImage={productImage}
          accentColor={accentColor}
          textColor={textColor}
          isVertical={isVertical}
        />
      </Sequence>

      {/* Section 2: Feature highlights */}
      <Sequence from={FEATURES_START} durationInFrames={FEATURES_DURATION}>
        <FeatureHighlights
          features={features}
          accentColor={accentColor}
          textColor={textColor}
          isVertical={isVertical}
        />
      </Sequence>

      {/* Section 3: Price tag */}
      <Sequence from={PRICE_START} durationInFrames={PRICE_DURATION}>
        <PriceTag
          price={price}
          productName={productName}
          accentColor={accentColor}
          textColor={textColor}
          isVertical={isVertical}
        />
      </Sequence>

      {/* Section 4: CTA with urgency */}
      <Sequence from={CTA_START} durationInFrames={CTA_DURATION}>
        <CtaSection
          ctaText={ctaText}
          accentColor={accentColor}
          textColor={textColor}
          isVertical={isVertical}
        />
      </Sequence>

      {/* Optional voiceover audio track */}
      {voiceoverUrl && <Audio src={staticFile(voiceoverUrl)} volume={0.8} />}

      {/* Optional lip-sync talking head overlay */}
      {lipSyncVideoUrl && (
        <div
          style={{
            position: "absolute",
            bottom: 40,
            right: 40,
            width: 240,
            height: 240,
            borderRadius: "50%",
            overflow: "hidden",
            border: "3px solid rgba(255,255,255,0.3)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}
        >
          <OffthreadVideo
            src={staticFile(lipSyncVideoUrl)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      )}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Default props for Remotion Studio preview
// ---------------------------------------------------------------------------

export const defaultAdCreativePropsHorizontal: AdCreativeProps = {
  productName: "AirPods Max",
  productImage: "",
  price: "$549",
  features: [
    "Active Noise Cancellation",
    "Spatial Audio with head tracking",
    "20-hour battery life",
    "Computational audio",
  ],
  ctaText: "SHOP NOW",
  backgroundColor: "#0a0a1a",
  accentColor: "#ff4757",
  orientation: "horizontal",
};

export const defaultAdCreativePropsVertical: AdCreativeProps = {
  productName: "AirPods Max",
  productImage: "",
  price: "$549",
  features: [
    "Active Noise Cancellation",
    "Spatial Audio with head tracking",
    "20-hour battery life",
    "Computational audio",
  ],
  ctaText: "SHOP NOW",
  backgroundColor: "#0a0a1a",
  accentColor: "#ff4757",
  orientation: "vertical",
};
