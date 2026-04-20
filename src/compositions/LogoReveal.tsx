import { zColor } from "@remotion/zod-types";
import type React from "react";
import type { CalculateMetadataFunction } from "remotion";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

export const logoRevealSchema = z.object({
  logoUrl: z.string().default(""),
  brandName: z.string().default("Brand"),
  tagline: z.string().default("").optional(),
  style: z.enum(["fade-scale", "particles", "wipe", "morph-in"]).default("fade-scale"),
  backgroundColor: zColor().default("#000000"),
  accentColor: zColor().default("#ffffff"),
  duration: z.number().default(90),
});

export type LogoRevealProps = z.infer<typeof logoRevealSchema>;

export const defaultLogoRevealProps: LogoRevealProps = {
  logoUrl: "",
  brandName: "Brand",
  tagline: "",
  style: "fade-scale",
  backgroundColor: "#000000",
  accentColor: "#ffffff",
  duration: 90,
};

export const calculateLogoRevealMetadata: CalculateMetadataFunction<LogoRevealProps> = ({
  props,
}) => {
  return {
    durationInFrames: props.duration,
  };
};

const LOGO_BOX_WIDTH = 620;
const LOGO_BOX_HEIGHT = 340;

const LogoCore: React.FC<{
  logoUrl: string;
  brandName: string;
  accentColor: string;
  filter?: string;
}> = ({ logoUrl, brandName, accentColor, filter }) => {
  const hasLogo = logoUrl.trim().length > 0;

  return (
    <div
      style={{
        width: LOGO_BOX_WIDTH,
        height: LOGO_BOX_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        filter,
      }}
    >
      {hasLogo ? (
        <Img
          src={logoUrl}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
          }}
        />
      ) : (
        <div
          style={{
            fontFamily: "system-ui, sans-serif",
            fontSize: 124,
            fontWeight: 800,
            letterSpacing: -2,
            color: accentColor,
            textAlign: "center",
            lineHeight: 1,
            maxWidth: "100%",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            paddingLeft: 24,
            paddingRight: 24,
          }}
        >
          {brandName || "Brand"}
        </div>
      )}
    </div>
  );
};

const FadeScaleStyle: React.FC<{
  frame: number;
  fps: number;
  brandName: string;
  tagline?: string;
  logoUrl: string;
  accentColor: string;
}> = ({ frame, fps, brandName, tagline, logoUrl, accentColor }) => {
  const settle = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.8 },
  });

  const logoScale = interpolate(settle, [0, 1], [0.8, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const logoOpacity = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glowOpacity = interpolate(frame, [0, 36], [0, 0.65], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const brandSpring = spring({
    frame: Math.max(0, frame - 14),
    fps,
    config: { damping: 18, stiffness: 120 },
  });
  const taglineSpring = spring({
    frame: Math.max(0, frame - 22),
    fps,
    config: { damping: 18, stiffness: 120 },
  });

  const brandY = interpolate(brandSpring, [0, 1], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const brandOpacity = interpolate(frame, [14, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(taglineSpring, [0, 1], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineOpacity = interpolate(frame, [24, 44], [0, 0.9], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      <div
        style={{
          position: "absolute",
          width: 720,
          height: 720,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accentColor}3D 0%, ${accentColor}10 35%, transparent 72%)`,
          opacity: glowOpacity,
          transform: "translateY(-80px)",
        }}
      />

      <div style={{ opacity: logoOpacity, transform: `scale(${logoScale})` }}>
        <LogoCore logoUrl={logoUrl} brandName={brandName} accentColor={accentColor} />
      </div>

      {brandName.trim().length > 0 ? (
        <h1
          style={{
            fontFamily: "system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 64,
            margin: "24px 0 0 0",
            color: "#ffffff",
            letterSpacing: -1,
            opacity: brandOpacity,
            transform: `translateY(${brandY}px)`,
          }}
        >
          {brandName}
        </h1>
      ) : null}

      {tagline && tagline.trim().length > 0 ? (
        <p
          style={{
            fontFamily: "system-ui, sans-serif",
            fontWeight: 400,
            fontSize: 30,
            margin: "10px 0 0 0",
            color: "#ffffff",
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
          }}
        >
          {tagline}
        </p>
      ) : null}
    </>
  );
};

const PARTICLE_COUNT = 36;

const ParticlesStyle: React.FC<{
  frame: number;
  fps: number;
  brandName: string;
  tagline?: string;
  logoUrl: string;
  accentColor: string;
}> = ({ frame, fps, brandName, tagline, logoUrl, accentColor }) => {
  const logoOpacity = interpolate(frame, [28, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const logoScale = interpolate(frame, [28, 50], [0.94, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleOpacity = interpolate(frame, [42, 62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [42, 62], [26, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const glowOpacity = interpolate(frame, [16, 45], [0, 0.75], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      <div
        style={{
          position: "absolute",
          width: 560,
          height: 560,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accentColor}55 0%, ${accentColor}18 45%, transparent 78%)`,
          opacity: glowOpacity,
          transform: "translateY(-80px)",
        }}
      />

      {new Array(PARTICLE_COUNT).fill(true).map((_, index) => {
        const settle = spring({
          frame: Math.max(0, frame - index),
          fps,
          config: { damping: 16, stiffness: 95, mass: 0.7 },
        });

        const radius = 460 + Math.sin(index * 1.618) * 190;
        const startX = Math.cos(index * 2.414) * radius + Math.sin(index * 1.618) * 70;
        const startY = Math.sin(index * 2.414) * radius * 0.58 + Math.cos(index * 1.618) * 80;

        const x = interpolate(settle, [0, 1], [startX, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const y = interpolate(settle, [0, 1], [startY, -80], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        const size = 5 + (index % 4);
        const particleOpacity = interpolate(frame, [0, 35, 60], [0, 1, 0.08], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
            key={`particle-${index}`}
            style={{
              position: "absolute",
              width: size,
              height: size,
              borderRadius: "50%",
              backgroundColor: accentColor,
              opacity: particleOpacity,
              transform: `translate(${x}px, ${y}px)`,
              boxShadow: `0 0 14px ${accentColor}`,
            }}
          />
        );
      })}

      <div style={{ opacity: logoOpacity, transform: `scale(${logoScale})` }}>
        <LogoCore logoUrl={logoUrl} brandName={brandName} accentColor={accentColor} />
      </div>

      {brandName.trim().length > 0 ? (
        <h1
          style={{
            fontFamily: "system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 64,
            margin: "24px 0 0 0",
            color: "#ffffff",
            letterSpacing: -1,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
          }}
        >
          {brandName}
        </h1>
      ) : null}

      {tagline && tagline.trim().length > 0 ? (
        <p
          style={{
            fontFamily: "system-ui, sans-serif",
            fontWeight: 400,
            fontSize: 30,
            margin: "10px 0 0 0",
            color: "#ffffff",
            opacity: interpolate(frame, [50, 70], [0, 0.85], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {tagline}
        </p>
      ) : null}
    </>
  );
};

const WipeStyle: React.FC<{
  frame: number;
  brandName: string;
  tagline?: string;
  logoUrl: string;
  accentColor: string;
}> = ({ frame, brandName, tagline, logoUrl, accentColor }) => {
  const reveal = interpolate(frame, [0, 44], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const edgeX = interpolate(frame, [0, 44], [-40, LOGO_BOX_WIDTH + 40], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const shineX = interpolate(frame, [52, 84], [-620, 760], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      <div
        style={{
          position: "relative",
          width: LOGO_BOX_WIDTH,
          height: LOGO_BOX_HEIGHT,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `inset(0 ${100 - reveal}% 0 0)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <LogoCore logoUrl={logoUrl} brandName={brandName} accentColor={accentColor} />

          <div
            style={{
              position: "absolute",
              width: 220,
              height: "150%",
              transform: `translateX(${shineX}px) translateY(0px) rotate(18deg)`,
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.75) 50%, transparent 100%)",
              mixBlendMode: "screen",
              opacity: interpolate(frame, [52, 84], [0, 0.5], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          />
        </div>

        <div
          style={{
            position: "absolute",
            top: -30,
            left: edgeX,
            width: 10,
            height: LOGO_BOX_HEIGHT + 60,
            background: `linear-gradient(180deg, transparent 0%, ${accentColor} 40%, ${accentColor} 60%, transparent 100%)`,
            boxShadow: `0 0 28px ${accentColor}`,
            opacity: interpolate(frame, [0, 44], [0.2, 0.9], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        />
      </div>

      {brandName.trim().length > 0 ? (
        <h1
          style={{
            fontFamily: "system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 64,
            margin: "24px 0 0 0",
            color: "#ffffff",
            letterSpacing: -1,
            opacity: interpolate(frame, [28, 50], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            transform: `translateY(${interpolate(frame, [28, 50], [22, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}px)`,
          }}
        >
          {brandName}
        </h1>
      ) : null}

      {tagline && tagline.trim().length > 0 ? (
        <p
          style={{
            fontFamily: "system-ui, sans-serif",
            fontWeight: 400,
            fontSize: 30,
            margin: "10px 0 0 0",
            color: "#ffffff",
            opacity: interpolate(frame, [44, 64], [0, 0.85], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {tagline}
        </p>
      ) : null}
    </>
  );
};

const MorphInStyle: React.FC<{
  frame: number;
  brandName: string;
  tagline?: string;
  logoUrl: string;
  accentColor: string;
}> = ({ frame, brandName, tagline, logoUrl, accentColor }) => {
  const blur = interpolate(frame, [0, 50], [26, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, 50], [1.24, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(frame, [0, 16], [0.25, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const visibleChars = Math.floor(
    interpolate(frame, [56, 56 + brandName.length * 3], [0, brandName.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const typedName = brandName.slice(0, visibleChars);

  const cursorOpacity = interpolate(Math.sin(frame * 0.45), [-1, 1], [0.2, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      <div
        style={{
          position: "absolute",
          width: 760,
          height: 760,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accentColor}2D 0%, ${accentColor}12 42%, transparent 70%)`,
          transform: "translateY(-80px)",
          opacity: interpolate(frame, [0, 40], [0.2, 0.75], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />

      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
        }}
      >
        <LogoCore
          logoUrl={logoUrl}
          brandName={brandName}
          accentColor={accentColor}
          filter={`blur(${blur}px)`}
        />
      </div>

      {brandName.trim().length > 0 ? (
        <h1
          style={{
            fontFamily: "system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 64,
            margin: "24px 0 0 0",
            color: "#ffffff",
            letterSpacing: -1,
            minHeight: 76,
          }}
        >
          {typedName}
          {frame >= 56 && visibleChars < brandName.length ? (
            <span style={{ opacity: cursorOpacity }}>|</span>
          ) : null}
        </h1>
      ) : null}

      {tagline && tagline.trim().length > 0 ? (
        <p
          style={{
            fontFamily: "system-ui, sans-serif",
            fontWeight: 400,
            fontSize: 30,
            margin: "10px 0 0 0",
            color: "#ffffff",
            opacity: interpolate(frame, [68, 88], [0, 0.85], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {tagline}
        </p>
      ) : null}
    </>
  );
};

export const LogoReveal: React.FC<LogoRevealProps> = ({
  logoUrl,
  brandName,
  tagline,
  style,
  backgroundColor,
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: 1600,
          height: 900,
          overflow: "hidden",
        }}
      >
        {style === "fade-scale" ? (
          <FadeScaleStyle
            frame={frame}
            fps={fps}
            brandName={brandName}
            tagline={tagline}
            logoUrl={logoUrl}
            accentColor={accentColor}
          />
        ) : null}

        {style === "particles" ? (
          <ParticlesStyle
            frame={frame}
            fps={fps}
            brandName={brandName}
            tagline={tagline}
            logoUrl={logoUrl}
            accentColor={accentColor}
          />
        ) : null}

        {style === "wipe" ? (
          <WipeStyle
            frame={frame}
            brandName={brandName}
            tagline={tagline}
            logoUrl={logoUrl}
            accentColor={accentColor}
          />
        ) : null}

        {style === "morph-in" ? (
          <MorphInStyle
            frame={frame}
            brandName={brandName}
            tagline={tagline}
            logoUrl={logoUrl}
            accentColor={accentColor}
          />
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
