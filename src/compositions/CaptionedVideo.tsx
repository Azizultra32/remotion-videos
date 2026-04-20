import { zColor } from "@remotion/zod-types";
import React from "react";
import type { CalculateMetadataFunction } from "remotion";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

const captionWordSchema = z.object({
  word: z.string(),
  startFrame: z.number(),
  endFrame: z.number(),
});

const captionLineSchema = z.object({
  text: z.string(),
  startFrame: z.number(),
  endFrame: z.number(),
  words: z.array(captionWordSchema).optional(),
});

export const captionedVideoSchema = z.object({
  captions: z.array(captionLineSchema),
  fontSize: z.number().default(48),
  fontFamily: z.string().default("system-ui, sans-serif"),
  textColor: zColor().default("#ffffff"),
  highlightColor: zColor().default("#FFD700"),
  backgroundColor: zColor().default("#000000"),
  position: z.enum(["bottom", "center", "top"]).default("bottom"),
  style: z.enum(["karaoke", "fade-in", "typewriter", "pop"]).default("karaoke"),
});

type CaptionWord = z.infer<typeof captionWordSchema>;
type CaptionLine = z.infer<typeof captionLineSchema>;
export type CaptionedVideoProps = z.infer<typeof captionedVideoSchema>;

const positionMap: Record<CaptionedVideoProps["position"], number> = {
  top: 20,
  center: 50,
  bottom: 80,
};

const baseWordStyle: React.CSSProperties = {
  display: "inline-block",
  whiteSpace: "pre",
};

export const calculateCaptionedVideoMetadata: CalculateMetadataFunction<CaptionedVideoProps> = ({
  props,
}) => {
  const durationInFrames = props.captions.reduce(
    (maxDuration, caption) => Math.max(maxDuration, caption.endFrame),
    1,
  );

  return {
    durationInFrames,
  };
};

export const CaptionedVideo: React.FC<CaptionedVideoProps> = ({
  captions,
  fontSize = 48,
  fontFamily = "system-ui, sans-serif",
  textColor = "#ffffff",
  highlightColor = "#FFD700",
  backgroundColor = "#000000",
  position = "bottom",
  style = "karaoke",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const visibleCaptions = captions.filter(
    (caption) => frame >= caption.startFrame && frame <= caption.endFrame,
  );

  const lineTextStyle: React.CSSProperties = {
    fontFamily,
    fontSize,
    fontWeight: 700,
    lineHeight: 1.28,
    letterSpacing: 0.2,
    textAlign: "center",
    textShadow: "0 2px 10px rgba(0, 0, 0, 0.65)",
    margin: 0,
  };

  const renderWord = (word: CaptionWord, index: number): React.ReactNode => {
    const safeEndFrame = Math.max(word.startFrame + 1, word.endFrame);

    if (style === "karaoke") {
      const isCurrent = frame >= word.startFrame && frame <= word.endFrame;
      const isPast = frame > word.endFrame;
      const wordSpring = spring({
        frame: Math.max(0, frame - word.startFrame),
        fps,
        config: { damping: 20, stiffness: 220, mass: 0.7 },
      });
      const currentScale = interpolate(wordSpring, [0, 1], [1, 1.08], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

      return (
        <span
          key={`karaoke-${index}`}
          style={{
            ...baseWordStyle,
            color: isCurrent ? highlightColor : textColor,
            opacity: isPast || isCurrent ? 1 : 0.45,
            transform: `scale(${isCurrent ? currentScale : 1})`,
          }}
        >
          {word.word}
        </span>
      );
    }

    if (style === "fade-in") {
      const entrySpring = spring({
        frame: Math.max(0, frame - word.startFrame),
        fps,
        config: { damping: 16, stiffness: 140, mass: 0.75 },
      });
      const opacity = interpolate(entrySpring, [0, 1], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const translateY = interpolate(entrySpring, [0, 1], [18, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

      return (
        <span
          key={`fade-${index}`}
          style={{
            ...baseWordStyle,
            color: textColor,
            opacity,
            transform: `translateY(${translateY}px)`,
          }}
        >
          {word.word}
        </span>
      );
    }

    if (style === "typewriter") {
      const visibleCharCount = Math.floor(
        interpolate(frame, [word.startFrame, safeEndFrame], [0, word.word.length], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      );
      const revealedWord = word.word.slice(0, Math.max(0, visibleCharCount));
      const wordOpacity = interpolate(frame, [word.startFrame - 1, word.startFrame], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

      return (
        <span
          key={`type-${index}`}
          style={{
            ...baseWordStyle,
            color: textColor,
            opacity: wordOpacity,
            minWidth: `${Math.max(1, word.word.length) * 0.5}ch`,
          }}
        >
          {revealedWord}
        </span>
      );
    }

    const popSpring = spring({
      frame: Math.max(0, frame - word.startFrame),
      fps,
      config: { damping: 10, stiffness: 210, mass: 0.6 },
    });
    const popScale = interpolate(popSpring, [0, 1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const popOpacity = interpolate(popSpring, [0, 0.25, 1], [0, 1, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    return (
      <span
        key={`pop-${index}`}
        style={{
          ...baseWordStyle,
          color: textColor,
          opacity: popOpacity,
          transform: `scale(${popScale})`,
          transformOrigin: "50% 65%",
        }}
      >
        {word.word}
      </span>
    );
  };

  const renderFullLine = (line: CaptionLine): React.ReactNode => {
    const safeEndFrame = Math.max(line.startFrame + 1, line.endFrame);

    if (style === "karaoke") {
      const emphasis = interpolate(frame, [line.startFrame, safeEndFrame], [0.6, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      return (
        <p style={{ ...lineTextStyle, color: highlightColor, opacity: emphasis }}>{line.text}</p>
      );
    }

    if (style === "fade-in") {
      const lineSpring = spring({
        frame: Math.max(0, frame - line.startFrame),
        fps,
        config: { damping: 16, stiffness: 140, mass: 0.75 },
      });
      const lineOpacity = interpolate(lineSpring, [0, 1], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const lineY = interpolate(lineSpring, [0, 1], [20, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

      return (
        <p
          style={{
            ...lineTextStyle,
            color: textColor,
            opacity: lineOpacity,
            transform: `translateY(${lineY}px)`,
          }}
        >
          {line.text}
        </p>
      );
    }

    if (style === "typewriter") {
      const visibleChars = Math.floor(
        interpolate(frame, [line.startFrame, safeEndFrame], [0, line.text.length], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      );
      const typedText = line.text.slice(0, Math.max(0, visibleChars));

      return <p style={{ ...lineTextStyle, color: textColor }}>{typedText}</p>;
    }

    const linePop = spring({
      frame: Math.max(0, frame - line.startFrame),
      fps,
      config: { damping: 10, stiffness: 200, mass: 0.6 },
    });
    const lineScale = interpolate(linePop, [0, 1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const lineOpacity = interpolate(linePop, [0, 0.25, 1], [0, 1, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    return (
      <p
        style={{
          ...lineTextStyle,
          color: textColor,
          opacity: lineOpacity,
          transform: `scale(${lineScale})`,
          transformOrigin: "50% 65%",
        }}
      >
        {line.text}
      </p>
    );
  };

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {visibleCaptions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: `${positionMap[position]}%`,
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "90%",
            maxWidth: 1800,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              padding: "30px 56px",
              borderRadius: 26,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.42) 25%, rgba(0,0,0,0.52) 50%, rgba(0,0,0,0.42) 75%, rgba(0,0,0,0.08) 100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              maxWidth: "100%",
            }}
          >
            {visibleCaptions.map((line, lineIndex) => {
              if (!line.words || line.words.length === 0) {
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
                  <React.Fragment key={`line-${lineIndex}`}>{renderFullLine(line)}</React.Fragment>
                );
              }

              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
                  key={`line-${lineIndex}`}
                  style={{
                    ...lineTextStyle,
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    alignItems: "center",
                    rowGap: 8,
                    columnGap: 10,
                    color: textColor,
                  }}
                >
                  {line.words.map((word, index) => renderWord(word, index))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

export const defaultCaptionedVideoProps: CaptionedVideoProps = {
  captions: [
    {
      text: "Welcome to the caption preview",
      startFrame: 0,
      endFrame: 80,
      words: [
        { word: "Welcome", startFrame: 0, endFrame: 15 },
        { word: "to", startFrame: 16, endFrame: 27 },
        { word: "the", startFrame: 28, endFrame: 39 },
        { word: "caption", startFrame: 40, endFrame: 57 },
        { word: "preview", startFrame: 58, endFrame: 80 },
      ],
    },
    {
      text: "Each word animates in sync",
      startFrame: 90,
      endFrame: 160,
      words: [
        { word: "Each", startFrame: 90, endFrame: 104 },
        { word: "word", startFrame: 105, endFrame: 119 },
        { word: "animates", startFrame: 120, endFrame: 139 },
        { word: "in", startFrame: 140, endFrame: 149 },
        { word: "sync", startFrame: 150, endFrame: 160 },
      ],
    },
    {
      text: "Lines without word timing still animate cleanly",
      startFrame: 170,
      endFrame: 250,
    },
    {
      text: "Switch styles for different effects",
      startFrame: 260,
      endFrame: 340,
      words: [
        { word: "Switch", startFrame: 260, endFrame: 276 },
        { word: "styles", startFrame: 277, endFrame: 293 },
        { word: "for", startFrame: 294, endFrame: 304 },
        { word: "different", startFrame: 305, endFrame: 326 },
        { word: "effects", startFrame: 327, endFrame: 340 },
      ],
    },
  ],
  fontSize: 52,
  fontFamily: "system-ui, sans-serif",
  textColor: "#ffffff",
  highlightColor: "#FFD700",
  backgroundColor: "#000000",
  position: "bottom",
  style: "karaoke",
};
