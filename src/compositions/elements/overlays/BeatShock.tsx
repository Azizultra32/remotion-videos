import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import {
  bindFullscreenShaderState,
  createFullscreenShaderState,
  disposeFullscreenShaderState,
  type FullscreenShaderState,
  resizeFullscreenCanvas,
} from "../fullscreenShaderRuntime";
import { collectRecentTriggerAges, selectTriggerTimes } from "../triggerRuntime";
import type { ElementModule, ElementRendererProps } from "../types";

// BeatShock — a beat-triggered chromatic-aberration shock ring.
// On each beat (or downbeat/drop), a ring expands outward from the center
// and fades over trailSec. The ring is drawn with RGB channel offset for
// a chromatic-aberration look. Multiple rings can be visible concurrently
// (decaying from older beats) so rapid beats produce stacked rings.
//
// All timing comes from the active beat array — this is what "beat-matched"
// means in this codebase. Every pixel is derived from (frame, fps, beats[])
// so the same audio always produces the same rings.

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uResolution;
// Per-beat ages (seconds since each nearby beat). Negative = future beat
// (unused). Packed so we can draw up to 16 overlapping rings per frame.
uniform float uAges[16];
uniform int   uActiveCount;
uniform float uTrail;       // ring lifetime in seconds (default 0.18)
uniform float uSpeed;       // ring expansion speed (radius per second, in NDC)
uniform vec3  uColor;       // base ring tint
uniform float uAberration;  // channel offset magnitude (0..0.04 ~ subtle..extreme)
out vec4 outColor;

float ringMask(float dist, float radius, float thickness) {
  // Single-sided smooth ring at radius with half-thickness thickness
  float d = abs(dist - radius);
  return 1.0 - smoothstep(0.0, thickness, d);
}

void main() {
  vec2 uv = vUv;
  vec2 centered = uv - 0.5;
  centered.x *= uResolution.x / uResolution.y;
  float r = length(centered);

  float rThick = 0.012; // ring thickness in NDC

  float red = 0.0;
  float grn = 0.0;
  float blu = 0.0;

  for (int i = 0; i < 16; i++) {
    if (i >= uActiveCount) break;
    float age = uAges[i];
    if (age < 0.0 || age > uTrail) continue;
    float fade = 1.0 - age / uTrail;
    float radius = age * uSpeed;
    // Chromatic aberration: each channel draws its own ring at slightly
    // different radius. More age -> more separation for a trailing
    // rainbow effect.
    float sep = uAberration * (0.3 + age / uTrail);
    red += ringMask(r, radius + sep, rThick) * fade;
    grn += ringMask(r, radius, rThick) * fade;
    blu += ringMask(r, radius - sep, rThick) * fade;
  }

  vec3 ringColor = vec3(red, grn, blu) * uColor;
  // Gamma + alpha — additive blend layer
  float alpha = clamp(max(max(red, grn), blu), 0.0, 1.0);
  outColor = vec4(ringColor, alpha);
}
`;

const VERT = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const schema = z.object({
  triggerOn: z.enum(["beats", "downbeats", "drops"]),
  trailSec: z.number().min(0.05).max(5).step(0.05),
  speed: z.number().min(0.05).max(5).step(0.05), // ring expansion speed (NDC units per sec)
  color: z.string(), // ring tint
  aberration: z.number().min(0).max(0.1).step(0.001), // chromatic aberration (0..0.04)
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  triggerOn: "downbeats",
  trailSec: 0.35,
  speed: 0.9,
  color: "#ffffff",
  aberration: 0.018,
};

const hexToRgb = (hex: string): [number, number, number] => {
  const m = hex.replace("#", "").trim();
  const expanded =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const n = parseInt(expanded, 16);
  if (Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { triggerOn, trailSec, speed, color, aberration } = element.props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glStateRef = useRef<FullscreenShaderState<
    "uResolution" | "uAges" | "uActiveCount" | "uTrail" | "uSpeed" | "uColor" | "uAberration"
  > | null>(null);

  // Which beat array to drive rings from.
  const triggerTimes = selectTriggerTimes(ctx.beats, triggerOn);

  // Current time in seconds at this frame
  const tSec = ctx.frame / Math.max(1, ctx.fps);

  // Ages of the last up-to-16 beats within the trail window. Oldest first.
  const ages = useMemo(
    () =>
      collectRecentTriggerAges({
        triggerTimes,
        tSec,
        trailSec,
        limit: 16,
      }),
    [triggerTimes, tSec, trailSec],
  );

  // One-time WebGL setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2");
    if (!gl) return;
    const state = createFullscreenShaderState(gl, {
      fragmentSource: FRAG,
      label: "BeatShock",
      uniformNames: [
        "uResolution",
        "uAges",
        "uActiveCount",
        "uTrail",
        "uSpeed",
        "uColor",
        "uAberration",
      ] as const,
      vertexSource: VERT,
    });
    if (!state) return;
    glStateRef.current = state;
    return () => {
      const current = glStateRef.current;
      if (!current) return;
      disposeFullscreenShaderState(current);
      glStateRef.current = null;
    };
  }, []);

  // Per-frame paint
  useEffect(() => {
    const state = glStateRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas) return;
    const { gl, locs } = state;
    resizeFullscreenCanvas(canvas);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Pack ages into a fixed-size Float32Array; unused slots get -1 (skipped).
    const packed = new Float32Array(16).fill(-1);
    ages.slice(0, 16).forEach((a, i) => {
      packed[i] = a;
    });

    bindFullscreenShaderState(state);
    gl.uniform2f(locs.uResolution, canvas.width, canvas.height);
    gl.uniform1fv(locs.uAges, packed);
    gl.uniform1i(locs.uActiveCount, Math.min(16, ages.length));
    gl.uniform1f(locs.uTrail, trailSec);
    gl.uniform1f(locs.uSpeed, speed);
    const [r, g, b] = hexToRgb(color);
    gl.uniform3f(locs.uColor, r, g, b);
    gl.uniform1f(locs.uAberration, aberration);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [ages, trailSec, speed, color, aberration]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        mixBlendMode: "screen",
      }}
    />
  );
};

export const BeatShockModule: ElementModule<Props> = {
  id: "overlay.beatShock",
  category: "overlay",
  label: "Beat Shock",
  description:
    "WebGL shader: chromatic-aberration ring burst on every beat/downbeat/drop. Trail decays over ~350ms.",
  defaultDurationSec: 30,
  defaultTrack: 6,
  schema,
  defaults,
  Renderer,
};
