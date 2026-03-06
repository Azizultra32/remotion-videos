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

const testimonialSchema = z.object({
  quote: z.string(),
  author: z.string(),
  role: z.string(),
  rating: z.number(),
});

export const socialProofSchema = z.object({
  testimonials: z.array(testimonialSchema),
  accentColor: zColor(),
});

type Testimonial = z.infer<typeof testimonialSchema>;

type SocialProofProps = z.infer<typeof socialProofSchema>;

const Star: React.FC<{
  filled: boolean;
  index: number;
  animationDelay: number;
  fps: number;
  baseFrame: number;
}> = ({ filled, index, animationDelay, fps, baseFrame }) => {
  const starDelay = animationDelay + index * 4;
  const starSpring = spring({
    frame: baseFrame - starDelay,
    fps,
    config: { damping: 8, stiffness: 150, mass: 0.6 },
  });

  const rotation = interpolate(starSpring, [0, 1], [180, 0]);

  return (
    <div
      style={{
        fontSize: 36,
        transform: `scale(${starSpring}) rotate(${rotation}deg)`,
        display: "inline-block",
        marginRight: 6,
        filter: filled
          ? "drop-shadow(0 0 6px rgba(255, 200, 0, 0.5))"
          : "none",
      }}
    >
      {filled ? "\u2605" : "\u2606"}
    </div>
  );
};

const TestimonialCard: React.FC<{
  testimonial: Testimonial;
  cardFrame: number;
  cardDuration: number;
  fps: number;
  accentColor: string;
}> = ({ testimonial, cardFrame, cardDuration, fps, accentColor }) => {
  // Fade in / fade out
  const fadeIn = interpolate(cardFrame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const fadeOut = interpolate(
    cardFrame,
    [cardDuration - 20, cardDuration],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) }
  );

  const opacity = fadeIn * fadeOut;

  const scaleIn = interpolate(cardFrame, [0, 20], [0.92, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Typewriter effect for quote
  const charsPerFrame = 1.5;
  const typewriterDelay = 15;
  const visibleChars = Math.floor(
    Math.max(0, (cardFrame - typewriterDelay) * charsPerFrame)
  );
  const displayedQuote = testimonial.quote.slice(
    0,
    Math.min(visibleChars, testimonial.quote.length)
  );
  const showCursor =
    cardFrame >= typewriterDelay &&
    visibleChars < testimonial.quote.length;

  // Author appears after quote is mostly done
  const quoteFinishFrame = typewriterDelay + testimonial.quote.length / charsPerFrame;
  const authorOpacity = interpolate(
    cardFrame,
    [quoteFinishFrame - 10, quoteFinishFrame + 5],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const authorSlide = interpolate(
    cardFrame,
    [quoteFinishFrame - 10, quoteFinishFrame + 5],
    [15, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity,
        transform: `scale(${scaleIn})`,
      }}
    >
      <div
        style={{
          maxWidth: 900,
          padding: "50px 70px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Stars */}
        <div
          style={{
            display: "flex",
            marginBottom: 40,
            color: "#FFD700",
          }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              filled={i < testimonial.rating}
              index={i}
              animationDelay={8}
              fps={fps}
              baseFrame={cardFrame}
            />
          ))}
        </div>

        {/* Quote mark */}
        <div
          style={{
            fontSize: 80,
            color: accentColor,
            fontFamily: "Georgia, serif",
            lineHeight: 0.6,
            marginBottom: 20,
            opacity: interpolate(cardFrame, [5, 15], [0, 0.6], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {"\u201C"}
        </div>

        {/* Quote text with typewriter */}
        <div
          style={{
            fontSize: 38,
            color: "rgba(255,255,255,0.95)",
            fontFamily: "Georgia, serif",
            textAlign: "center",
            lineHeight: 1.6,
            minHeight: 160,
            fontStyle: "italic",
            letterSpacing: 0.2,
          }}
        >
          {displayedQuote}
          {showCursor && (
            <span
              style={{
                color: accentColor,
                fontStyle: "normal",
                animation: "none",
                opacity: Math.sin(cardFrame * 0.3) > 0 ? 1 : 0,
              }}
            >
              |
            </span>
          )}
        </div>

        {/* Divider line */}
        <div
          style={{
            width: 60,
            height: 3,
            backgroundColor: accentColor,
            borderRadius: 2,
            marginTop: 36,
            marginBottom: 28,
            opacity: authorOpacity,
            transform: `scaleX(${authorOpacity})`,
          }}
        />

        {/* Author info */}
        <div
          style={{
            opacity: authorOpacity,
            transform: `translateY(${authorSlide}px)`,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: "white",
              fontFamily: "system-ui, sans-serif",
              marginBottom: 6,
            }}
          >
            {testimonial.author}
          </div>
          <div
            style={{
              fontSize: 18,
              color: accentColor,
              fontFamily: "system-ui, sans-serif",
              fontWeight: 500,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {testimonial.role}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const SocialProof: React.FC<SocialProofProps> = ({
  testimonials,
  accentColor = "#6C63FF",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  if (testimonials.length === 0) {
    return (
      <AbsoluteFill style={{ backgroundColor: "#0d0d0d" }}>
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
          No testimonials provided
        </div>
      </AbsoluteFill>
    );
  }

  const cardDuration = durationInFrames / testimonials.length;
  const currentIndex = Math.min(
    Math.floor(frame / cardDuration),
    testimonials.length - 1
  );
  const cardFrame = frame - currentIndex * cardDuration;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0d0d0d",
        overflow: "hidden",
      }}
    >
      {/* Subtle radial gradient */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 40%, ${accentColor}15 0%, transparent 60%)`,
        }}
      />

      {/* Ambient decorative elements */}
      <div
        style={{
          position: "absolute",
          top: -200,
          right: -200,
          width: 500,
          height: 500,
          borderRadius: "50%",
          border: `1px solid ${accentColor}20`,
          opacity: interpolate(frame, [0, 30], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -150,
          left: -150,
          width: 400,
          height: 400,
          borderRadius: "50%",
          border: `1px solid ${accentColor}15`,
          opacity: interpolate(frame, [10, 40], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />

      {/* Current testimonial */}
      <TestimonialCard
        key={currentIndex}
        testimonial={testimonials[currentIndex]}
        cardFrame={cardFrame}
        cardDuration={cardDuration}
        fps={fps}
        accentColor={accentColor}
      />

      {/* Testimonial counter dots */}
      <div
        style={{
          position: "absolute",
          bottom: 45,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 12,
        }}
      >
        {testimonials.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === currentIndex ? 28 : 8,
              height: 8,
              borderRadius: 4,
              backgroundColor:
                i === currentIndex ? accentColor : "rgba(255,255,255,0.2)",
              transition: "none",
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
