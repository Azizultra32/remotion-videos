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

// Bloom-like glow: soft gaussian-ish halos centered on a procedural "light
// point" that wanders slowly, driven by mid band. Bass modulates intensity,
// highs add fine-grained film grain. Not a true post-process (Remotion's
// per-frame model doesn't easily give us the prior frame's texture); this
// is a faked-bloom that stands in well over dark compositions and layers
// cleanly over plasma/pulse via mix-blend-mode: screen.

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2  uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform vec3  uColor;
uniform float uHaloCount;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  vec2 ar = vec2(uResolution.x / uResolution.y, 1.0);
  vec3 glow = vec3(0.0);
  // Draw N wandering halos. Each halo's center = slowly-moving noise trajectory.
  int count = int(clamp(uHaloCount, 1.0, 6.0));
  for (int i = 0; i < 6; i++) {
    if (i >= count) break;
    float fi = float(i);
    float t = uTime * (0.08 + fi * 0.03) + fi * 12.3;
    vec2 center = vec2(
      0.5 + 0.42 * sin(t * 1.2 + fi),
      0.5 + 0.35 * cos(t * 0.9 + fi * 2.7)
    );
    vec2 d = (uv - center) * ar;
    float r = length(d);
    // Gaussian-ish halo; size pulses with bass
    float size = 0.2 + uBass * 0.35;
    float g = exp(-pow(r / size, 2.0));
    glow += uColor * g * (0.45 + uMid * 0.55);
  }
  // Grain on highs
  float grain = (hash(uv * uResolution + uTime * 100.0) - 0.5) * uHigh * 0.4;
  vec3 color = glow + grain;
  float alpha = clamp(max(max(glow.r, glow.g), glow.b), 0.0, 0.85);
  outColor = vec4(color, alpha);
}
`;

const VERT = `#version 300 es
in vec2 aPosition; out vec2 vUv;
void main() { vUv = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const schema = z.object({
  color: z.string(),
  haloCount: z.number().int().min(1).max(6),
  intensity: z.number().min(0).max(4).step(0.05),
});

type Props = z.infer<typeof schema>;

const defaults: Props = { color: "#fef3c7", haloCount: 3, intensity: 1.0 };

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
  if (Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { color, haloCount, intensity } = element.props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glStateRef = useRef<FullscreenShaderState<
    "uResolution" | "uTime" | "uBass" | "uMid" | "uHigh" | "uColor" | "uHaloCount"
  > | null>(null);

  const reactive = useReactiveBands({ ctx, intensity, numberOfSamples: 256 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2");
    if (!gl) return;
    const state = createFullscreenShaderState(gl, {
      fragmentSource: FRAG,
      label: "BloomGlow",
      uniformNames: [
        "uResolution",
        "uTime",
        "uBass",
        "uMid",
        "uHigh",
        "uColor",
        "uHaloCount",
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
    const [r, g, b] = hexToRgb(color);
    gl.uniform3f(locs.uColor, r, g, b);
    gl.uniform1f(locs.uHaloCount, haloCount);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [reactive.bass, reactive.highs, reactive.mid, reactive.timeSec, color, haloCount]);

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

export const BloomGlowModule: ElementModule<Props> = {
  id: "overlay.bloomGlow",
  category: "overlay",
  label: "Bloom Glow",
  description:
    "Wandering soft-glow halos (faux bloom). Size pulses with bass, brightness with mid, grain with highs.",
  defaultDurationSec: 60,
  defaultTrack: 5,
  schema,
  defaults,
  Renderer,
};
