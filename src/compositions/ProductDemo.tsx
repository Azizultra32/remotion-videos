import { zColor } from "@remotion/zod-types";
import type React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";
import { AnimatedTitle } from "../components";

export const productDemoSchema = z.object({
  productName: z.string(),
  tagline: z.string(),
  features: z.array(z.string()),
  ctaText: z.string(),
  backgroundColor: zColor(),
  primaryColor: zColor(),
  textColor: zColor(),
});

type ProductDemoProps = z.infer<typeof productDemoSchema>;

export const ProductDemo: React.FC<ProductDemoProps> = ({
  productName,
  tagline,
  features,
  ctaText,
  backgroundColor,
  primaryColor,
  textColor,
}) => {
  const _frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {/* Title sequence */}
      <Sequence from={0} durationInFrames={90}>
        <TitleScene
          productName={productName}
          tagline={tagline}
          primaryColor={primaryColor}
          textColor={textColor}
        />
      </Sequence>

      {/* Features sequence */}
      {features.map((feature, i) => (
        <Sequence key={feature} from={90 + i * 50} durationInFrames={50}>
          <FeatureScene
            feature={feature}
            index={i}
            primaryColor={primaryColor}
            textColor={textColor}
          />
        </Sequence>
      ))}

      {/* CTA sequence */}
      <Sequence from={durationInFrames - 60} durationInFrames={60}>
        <CTAScene
          ctaText={ctaText}
          productName={productName}
          primaryColor={primaryColor}
          textColor={textColor}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

const TitleScene: React.FC<{
  productName: string;
  tagline: string;
  primaryColor: string;
  textColor: string;
}> = ({ productName, tagline, primaryColor, textColor }) => {
  const frame = useCurrentFrame();
  const taglineOpacity = interpolate(frame, [20, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <AnimatedTitle
        text={productName}
        animationType="scale"
        fontSize={96}
        fontWeight={800}
        color={primaryColor}
        fontFamily="system-ui, sans-serif"
        letterSpacing={0}
        springConfig={{ damping: 200 }}
      />
      <p
        style={{
          fontSize: 36,
          color: textColor,
          fontFamily: "system-ui, sans-serif",
          opacity: taglineOpacity,
          marginTop: 16,
        }}
      >
        {tagline}
      </p>
    </AbsoluteFill>
  );
};

const FeatureScene: React.FC<{
  feature: string;
  index: number;
  primaryColor: string;
  textColor: string;
}> = ({ feature, index, primaryColor, textColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slideIn = spring({ frame, fps, config: { damping: 15 } });
  const x = interpolate(slideIn, [0, 1], [100, 0]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        paddingLeft: 200,
        paddingRight: 200,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          transform: `translateX(${x}px)`,
          opacity: slideIn,
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: primaryColor,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            color: "white",
            fontSize: 28,
            fontWeight: 700,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {index + 1}
        </div>
        <span
          style={{
            fontSize: 56,
            fontWeight: 600,
            color: textColor,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {feature}
        </span>
      </div>
    </AbsoluteFill>
  );
};

const CTAScene: React.FC<{
  ctaText: string;
  productName: string;
  primaryColor: string;
  textColor: string;
}> = ({ ctaText, productName, primaryColor, textColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          backgroundColor: primaryColor,
          paddingLeft: 60,
          paddingRight: 60,
          paddingTop: 24,
          paddingBottom: 24,
          borderRadius: 16,
          transform: `scale(${scale})`,
        }}
      >
        <span
          style={{
            color: "white",
            fontSize: 48,
            fontWeight: 700,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {ctaText}
        </span>
      </div>
      <p
        style={{
          color: textColor,
          fontSize: 24,
          marginTop: 20,
          opacity: interpolate(frame, [15, 30], [0, 0.6], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {productName}
      </p>
    </AbsoluteFill>
  );
};
