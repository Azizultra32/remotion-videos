import type React from "react";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { useFFT } from "../../../hooks/useFFT";
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
  const ex = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(ex, 16);
  if (Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
};

const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
  const s = gl.createShader(type); if (!s) return null;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error("bloom:", gl.getShaderInfoLog(s)); return null; }
  return s;
};
const makeProgram = (gl: WebGL2RenderingContext) => {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const p = gl.createProgram(); if (!p) return null;
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, "aPosition"); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  return p;
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { color, haloCount, intensity } = element.props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glStateRef = useRef<{
    gl: WebGL2RenderingContext; prog: WebGLProgram; vao: WebGLVertexArrayObject;
    locs: Record<string, WebGLUniformLocation | null>;
  } | null>(null);

  const fft = useFFT({ src: ctx.audioSrc ?? "", frame: ctx.frame, fps: ctx.fps, numberOfSamples: 256, assetRegistry: ctx.assetRegistry });

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const gl = canvas.getContext("webgl2"); if (!gl) return;
    const prog = makeProgram(gl); if (!prog) return;
    const vao = gl.createVertexArray(); if (!vao) return;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    glStateRef.current = {
      gl, prog, vao,
      locs: {
        uResolution: gl.getUniformLocation(prog, "uResolution"),
        uTime: gl.getUniformLocation(prog, "uTime"),
        uBass: gl.getUniformLocation(prog, "uBass"),
        uMid: gl.getUniformLocation(prog, "uMid"),
        uHigh: gl.getUniformLocation(prog, "uHigh"),
        uColor: gl.getUniformLocation(prog, "uColor"),
        uHaloCount: gl.getUniformLocation(prog, "uHaloCount"),
      },
    };
    return () => {
      if (!glStateRef.current) return;
      glStateRef.current.gl.deleteProgram(prog); glStateRef.current.gl.deleteVertexArray(vao);
      glStateRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = glStateRef.current; const canvas = canvasRef.current;
    if (!state || !canvas) return;
    const { gl, prog, vao, locs } = state;
    const dpr = 1; // Fixed for deterministic renders
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog); gl.bindVertexArray(vao);
    gl.uniform2f(locs.uResolution, canvas.width, canvas.height);
    gl.uniform1f(locs.uTime, ctx.frame / Math.max(1, ctx.fps));
    gl.uniform1f(locs.uBass, (fft?.bass ?? 0) * intensity);
    gl.uniform1f(locs.uMid, (fft?.mid ?? 0) * intensity);
    gl.uniform1f(locs.uHigh, (fft?.highs ?? 0) * intensity);
    const [r, g, b] = hexToRgb(color);
    gl.uniform3f(locs.uColor, r, g, b);
    gl.uniform1f(locs.uHaloCount, haloCount);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [ctx.frame, ctx.fps, fft?.bass, fft?.mid, fft?.highs, color, haloCount, intensity]);

  return (
    <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", mixBlendMode: "screen" }} />
  );
};

export const BloomGlowModule: ElementModule<Props> = {
  id: "overlay.bloomGlow",
  category: "overlay",
  label: "Bloom Glow",
  description: "Wandering soft-glow halos (faux bloom). Size pulses with bass, brightness with mid, grain with highs.",
  defaultDurationSec: 60,
  defaultTrack: 5,
  schema,
  defaults,
  Renderer,
};
