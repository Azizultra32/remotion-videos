import type React from "react";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { useReactiveBands } from "../audioReactiveRuntime";
import {
  bindFullscreenShaderState,
  createFullscreenShaderState,
  disposeFullscreenShaderState,
  type FullscreenShaderState,
  resizeFullscreenCanvas,
} from "../fullscreenShaderRuntime";
import type { ElementModule, ElementRendererProps } from "../types";

// Plasma backdrop — domain-warped noise flowing organically. Continuous
// audio-reactive: bass drives overall intensity, mid drives flow speed, highs
// add fine-grained shimmer. Palette cycles over time + can be offset by the
// user's color prop. Classic "music-video ambient" backdrop layer.

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2  uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uScale;
out vec4 outColor;

// Cheap 2D value-noise + smooth interpolation
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Fractal Brownian motion — stacked octaves of noise for organic texture
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  // Aspect-correct so the plasma doesn't stretch
  uv.x *= uResolution.x / uResolution.y;
  uv *= uScale;

  // Flow speed modulated by mid band
  float t = uTime * (0.15 + uMid * 0.6);

  // Domain warping — the classic trick for making noise feel fluid.
  // Offset each query by another noise query, and chain it twice for depth.
  vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(1.7, 9.2) + t));
  vec2 r = vec2(
    fbm(uv + q * 2.0 + t * 2.0),
    fbm(uv + q * 2.0 + vec2(8.3, 2.8) + t * 2.0)
  );
  float f = fbm(uv + 2.0 * r);

  // Map f -> palette using smooth cos interpolation between the two user colors
  vec3 color = mix(uColorA, uColorB, smoothstep(0.2, 0.8, f));

  // Bass drives brightness, highs add shimmer
  float brightness = 0.35 + uBass * 0.7;
  float shimmer = uHigh * 0.3 * (hash(uv * 100.0 + uTime) - 0.5);
  vec3 outRgb = color * brightness + shimmer;
  outColor = vec4(outRgb, clamp(brightness, 0.0, 1.0));
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
  colorA: z.string(),
  colorB: z.string(),
  scale: z.number().min(0.1).max(10).step(0.05),
  intensity: z.number().min(0).max(4).step(0.05),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  colorA: "#5b21b6",
  colorB: "#f0abfc",
  scale: 2.5,
  intensity: 1.0,
};

const hexToRgb = (hex: string): [number, number, number] => {
  const m = hex.replace("#", "").trim();
  const ex =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const n = parseInt(ex, 16);
  if (Number.isNaN(n)) return [1, 0.5, 1];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { colorA, colorB, scale, intensity } = element.props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glStateRef = useRef<FullscreenShaderState<
    "uResolution" | "uTime" | "uBass" | "uMid" | "uHigh" | "uColorA" | "uColorB" | "uScale"
  > | null>(null);

  const reactive = useReactiveBands({ ctx, intensity, numberOfSamples: 256 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2");
    if (!gl) return;
    const state = createFullscreenShaderState(gl, {
      fragmentSource: FRAG,
      label: "PlasmaBackdrop",
      uniformNames: [
        "uResolution",
        "uTime",
        "uBass",
        "uMid",
        "uHigh",
        "uColorA",
        "uColorB",
        "uScale",
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

  useEffect(() => {
    const state = glStateRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas) return;
    const { gl, locs } = state;
    resizeFullscreenCanvas(canvas);
    gl.viewport(0, 0, canvas.width, canvas.height);

    bindFullscreenShaderState(state);
    gl.uniform2f(locs.uResolution, canvas.width, canvas.height);
    gl.uniform1f(locs.uTime, reactive.timeSec);
    gl.uniform1f(locs.uBass, reactive.bass);
    gl.uniform1f(locs.uMid, reactive.mid);
    gl.uniform1f(locs.uHigh, reactive.highs);
    const [ar, ag, ab] = hexToRgb(colorA);
    const [br, bg, bb] = hexToRgb(colorB);
    gl.uniform3f(locs.uColorA, ar, ag, ab);
    gl.uniform3f(locs.uColorB, br, bg, bb);
    gl.uniform1f(locs.uScale, scale);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [reactive.bass, reactive.highs, reactive.mid, reactive.timeSec, colorA, colorB, scale]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
};

export const PlasmaBackdropModule: ElementModule<Props> = {
  id: "overlay.plasmaBackdrop",
  category: "overlay",
  label: "Plasma Backdrop",
  description:
    "Domain-warped noise backdrop. Flow speed = mid band, brightness = bass, shimmer = highs.",
  defaultDurationSec: 60,
  defaultTrack: 4,
  schema,
  defaults,
  Renderer,
};
