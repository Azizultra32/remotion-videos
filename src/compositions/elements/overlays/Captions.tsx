import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { parseSrt, type Caption } from "@remotion/captions";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

// Caption / subtitle track. Accepts raw SRT text (typical output of
// @remotion/install-whisper-cpp or any SRT file). Shows the active
// caption at the playhead within the element's time range. Renders
// bottom-centered with a styled chip — TikTok-ish look that reads
// cleanly over any background.

const schema = z.object({
  srt: z.string(),
  offsetSec: z.number().min(-60).max(60), // nudge captions if audio is off
  fontSize: z.number().min(12).max(400),
  fontFamily: z.string(),
  fontWeight: z.number().min(100).max(900),
  color: z.string(),
  strokeColor: z.string(),
  strokeWidth: z.number().min(0).max(20),
  background: z.string(),
  y: z.number().min(0).max(100), // vertical anchor %
  paddingPx: z.number().min(0).max(120),
  borderRadius: z.number().min(0).max(80),
  maxWidthPct: z.number().min(10).max(100),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  srt: "1\n00:00:00,000 --> 00:00:02,500\nEdit me — paste SRT content here.\n",
  offsetSec: 0,
  fontSize: 42,
  fontFamily: "'Helvetica Neue', Helvetica, Inter, system-ui, sans-serif",
  fontWeight: 700,
  color: "#ffffff",
  strokeColor: "#000000",
  strokeWidth: 0,
  background: "rgba(0,0,0,0.55)",
  y: 85,
  paddingPx: 14,
  borderRadius: 6,
  maxWidthPct: 80,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    srt,
    offsetSec,
    fontSize,
    fontFamily,
    fontWeight,
    color,
    strokeColor,
    strokeWidth,
    background,
    y,
    paddingPx,
    borderRadius,
    maxWidthPct,
  } = element.props;

  const captions: Caption[] = useMemo(() => {
    if (!srt || srt.trim().length === 0) return [];
    try {
      return parseSrt({ input: srt }).captions;
    } catch {
      return [];
    }
  }, [srt]);

  const playheadMs = (ctx.elementLocalSec + offsetSec) * 1000;
  const active = captions.find((c) => c.startMs <= playheadMs && playheadMs < c.endMs);

  if (!active) return null;

  const textShadow =
    strokeWidth > 0
      ? Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          const dx = Math.cos(a) * strokeWidth;
          const dy = Math.sin(a) * strokeWidth;
          return `${dx.toFixed(1)}px ${dy.toFixed(1)}px 0 ${strokeColor}`;
        }).join(", ")
      : "none";

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: `${y}%`,
          left: "50%",
          transform: "translate(-50%, -50%)",
          maxWidth: `${maxWidthPct}%`,
          padding: `${paddingPx}px ${paddingPx * 1.5}px`,
          background,
          borderRadius,
          fontFamily,
          fontSize,
          fontWeight,
          color,
          textShadow,
          textAlign: "center",
          lineHeight: 1.2,
        }}
      >
        {active.text}
      </div>
    </AbsoluteFill>
  );
};

const CaptionsModule: ElementModule<Props> = {
  id: "overlay.captions",
  category: "overlay",
  label: "Captions / Subtitles",
  description: "Caption overlay from an SRT string — active line shown at the playhead.",
  defaultDurationSec: 10,
  defaultTrack: 7,
  schema,
  defaults,
  Renderer,
};

export default CaptionsModule;
export { CaptionsModule };
