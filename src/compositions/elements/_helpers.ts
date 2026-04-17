import { z } from "zod";

export const makeZ = <S extends z.ZodRawShape>(shape: S) => z.object(shape);

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const expDecay = (timeSince: number, decay: number) =>
  Math.exp(-decay * Math.max(0, timeSince));

export const gaussian = (t: number, peak: number, sigma: number) =>
  Math.exp(-Math.pow(t - peak, 2) / (2 * sigma * sigma));

export const FONT_STACK = "'Helvetica Neue', Helvetica, Inter, system-ui, sans-serif";

export const resolveStatic = (src: string, staticFile: (s: string) => string): string =>
  src.startsWith("http") || src.startsWith("/") ? src : staticFile(src);
