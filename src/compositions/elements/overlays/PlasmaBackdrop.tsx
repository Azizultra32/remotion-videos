import type React from "react";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { useFFT } from "../../../hooks/useFFT";
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
  const ex = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(ex, 16);
  if (Number.isNaN(n)) return [1, 0.5, 1];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
};

const compile = (gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null => {
  const s = gl.createShader(type); if (!s) return null;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console
    console.error("plasma shader:", gl.getShaderInfoLog(s)); gl.deleteShader(s); return null;
  }
  return s;
};

const makeProgram = (gl: WebGL2RenderingContext): WebGLProgram | null => {
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
  const { colorA, colorB, scale, intensity } = element.props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glStateRef = useRef<{
    gl: WebGL2RenderingContext;
    prog: WebGLProgram;
    vao: WebGLVertexArrayObject;
    locs: Record<string, WebGLUniformLocation | null>;
  } | null>(null);

  const fft = useFFT({
    src: ctx.audioSrc ?? "",
    frame: ctx.frame,
    fps: ctx.fps,
    numberOfSamples: 256,
    assetRegistry: ctx.assetRegistry,
  });

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const gl = canvas.getContext("webgl2"); if (!gl) return;
    const prog = makeProgram(gl); if (!prog) return;
    const vao = gl.createVertexArray(); if (!vao) return;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
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
        uColorA: gl.getUniformLocation(prog, "uColorA"),
        uColorB: gl.getUniformLocation(prog, "uColorB"),
        uScale: gl.getUniformLocation(prog, "uScale"),
      },
    };
    return () => {
      if (!glStateRef.current) return;
      glStateRef.current.gl.deleteProgram(prog);
      glStateRef.current.gl.deleteVertexArray(vao);
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

    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(locs.uResolution, canvas.width, canvas.height);
    gl.uniform1f(locs.uTime, ctx.frame / Math.max(1, ctx.fps));
    gl.uniform1f(locs.uBass, (fft?.bass ?? 0) * intensity);
    gl.uniform1f(locs.uMid, (fft?.mid ?? 0) * intensity);
    gl.uniform1f(locs.uHigh, (fft?.highs ?? 0) * intensity);
    const [ar, ag, ab] = hexToRgb(colorA);
    const [br, bg, bb] = hexToRgb(colorB);
    gl.uniform3f(locs.uColorA, ar, ag, ab);
    gl.uniform3f(locs.uColorB, br, bg, bb);
    gl.uniform1f(locs.uScale, scale);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [ctx.frame, ctx.fps, fft?.bass, fft?.mid, fft?.highs, colorA, colorB, scale, intensity]);

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
  description: "Domain-warped noise backdrop. Flow speed = mid band, brightness = bass, shimmer = highs.",
  defaultDurationSec: 60,
  defaultTrack: 4,
  schema,
  defaults,
  Renderer,
};
