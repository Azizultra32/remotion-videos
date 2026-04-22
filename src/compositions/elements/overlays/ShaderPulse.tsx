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

// GLSL fragment shader: full-frame radial gradient + grain, audio-reactive.
//  - uBass   (0..1): drives the gradient center color + pulse radius
//  - uMid    (0..1): drives hue shift
//  - uHigh   (0..1): drives grain amplitude
//  - uTime   (s):    drives grain flicker + slow color drift
//  - uColor  (vec3): base tint set by the element's prop
// Output blends via mix-blend-mode screen at the React layer.
const FRAG_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform vec3 uColor;
out vec4 outColor;

// Hash for grain
float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

// HSV -> RGB for hue shifting
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec2 uv = vUv;
  // Aspect-correct center; radial distance from middle
  vec2 centered = uv - 0.5;
  centered.x *= uResolution.x / uResolution.y;
  float r = length(centered);

  // Pulse radius with bass: larger bass = bigger glow
  float pulse = mix(0.25, 0.65, uBass);
  float fall = smoothstep(pulse, 0.0, r);

  // Hue slowly drifts with time, shifts with mid band
  float hue = fract(uTime * 0.03 + uMid * 0.25);
  vec3 tint = mix(uColor, hsv2rgb(vec3(hue, 0.7, 1.0)), 0.55);

  // Grain rides on high frequencies
  float grain = (hash(uv * uResolution + uTime * 60.0) - 0.5) * uHigh * 0.35;

  vec3 color = tint * fall + grain;
  float alpha = clamp(fall * (0.45 + uBass * 0.55), 0.0, 1.0);
  outColor = vec4(color, alpha);
}
`;

const VERT_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const schema = z.object({
  color: z.string(),
  intensity: z.number().min(0).max(4).step(0.05),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  color: "#ff3a9e",
  intensity: 1.0,
};

// Parse a CSS hex color into a normalized vec3 for the shader.
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
  if (Number.isNaN(n)) return [1, 0.5, 0.5];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { color, intensity } = element.props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glStateRef = useRef<FullscreenShaderState<
    "uResolution" | "uTime" | "uBass" | "uMid" | "uHigh" | "uColor"
  > | null>(null);

  const reactive = useReactiveBands({ ctx, intensity, numberOfSamples: 256 });

  // One-time WebGL setup: program + fullscreen quad VAO
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2");
    if (!gl) {
      // eslint-disable-next-line no-console
      console.warn("ShaderPulse: webgl2 unavailable");
      return;
    }
    const state = createFullscreenShaderState(gl, {
      fragmentSource: FRAG_SHADER,
      label: "ShaderPulse",
      uniformNames: ["uResolution", "uTime", "uBass", "uMid", "uHigh", "uColor"] as const,
      vertexSource: VERT_SHADER,
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

  // Per-frame paint: Remotion re-renders this component on every frame via
  // ctx.frame prop change, so this effect re-fires frame-by-frame.
  useEffect(() => {
    const state = glStateRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas) return;
    const { gl, locs } = state;

    // Fixed DPR preserves byte-identical render sizing across machines.
    resizeFullscreenCanvas(canvas);
    gl.viewport(0, 0, canvas.width, canvas.height);

    bindFullscreenShaderState(state);
    gl.uniform2f(locs.uResolution, canvas.width, canvas.height);
    gl.uniform1f(locs.uTime, reactive.timeSec);
    gl.uniform1f(locs.uBass, reactive.bass);
    gl.uniform1f(locs.uMid, reactive.mid);
    gl.uniform1f(locs.uHigh, reactive.highs);
    const [r, g, b] = hexToRgb(color);
    gl.uniform3f(locs.uColor, r, g, b);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [reactive.bass, reactive.highs, reactive.mid, reactive.timeSec, color]);

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

export const ShaderPulseModule: ElementModule<Props> = {
  id: "overlay.shaderPulse",
  category: "overlay",
  label: "Shader Pulse",
  description:
    "WebGL fragment shader: audio-reactive radial glow + grain. Bass = pulse size, mid = hue drift, highs = grain.",
  defaultDurationSec: 30,
  defaultTrack: 5,
  schema,
  defaults,
  Renderer,
};
