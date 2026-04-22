import type { CSSProperties } from "react";
import { z } from "zod";

export const MediaVisualEffectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("blur"),
    px: z.number().min(0).max(64).step(0.5),
  }),
  z.object({
    type: z.literal("brightness"),
    amount: z.number().min(0).max(8).step(0.05),
  }),
  z.object({
    type: z.literal("contrast"),
    amount: z.number().min(0).max(8).step(0.05),
  }),
  z.object({
    type: z.literal("saturate"),
    amount: z.number().min(0).max(8).step(0.05),
  }),
  z.object({
    type: z.literal("grayscale"),
    amount: z.number().min(0).max(1).step(0.01),
  }),
  z.object({
    type: z.literal("hueRotate"),
    deg: z.number().min(-360).max(360).step(1),
  }),
]);

export type MediaVisualEffect = z.infer<typeof MediaVisualEffectSchema>;

export const buildMediaFilterString = (
  effects: readonly MediaVisualEffect[],
): string | undefined => {
  const filters = effects.map((effect) => {
    if (effect.type === "blur") return `blur(${effect.px}px)`;
    if (effect.type === "brightness") return `brightness(${effect.amount})`;
    if (effect.type === "contrast") return `contrast(${effect.amount})`;
    if (effect.type === "saturate") return `saturate(${effect.amount})`;
    if (effect.type === "grayscale") return `grayscale(${effect.amount})`;
    return `hue-rotate(${effect.deg}deg)`;
  });

  return filters.length > 0 ? filters.join(" ") : undefined;
};

export const buildMediaEffectStyle = ({
  opacity,
  scale,
  blendMode,
  effects = [],
  absoluteFill = false,
}: {
  opacity?: number;
  scale?: number;
  blendMode?: CSSProperties["mixBlendMode"];
  effects?: readonly MediaVisualEffect[];
  absoluteFill?: boolean;
}): CSSProperties => {
  const transform = scale != null && Math.abs(scale - 1) > 0.0001 ? `scale(${scale})` : undefined;
  const filter = buildMediaFilterString(effects);

  return {
    ...(absoluteFill ? { position: "absolute", inset: 0 } : {}),
    ...(opacity == null ? {} : { opacity }),
    ...(transform ? { transform } : {}),
    ...(blendMode && blendMode !== "normal" ? { mixBlendMode: blendMode } : {}),
    ...(filter ? { filter } : {}),
  };
};
