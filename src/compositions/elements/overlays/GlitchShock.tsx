import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

// Beat-triggered glitch/datamosh rectangles. Each beat fires up to 8
// rectangles at random horizontal bands that display RGB-offset "tears"
// for the first ~80ms of the beat interval, then decay. Seed derived from
// the beat time so renders stay deterministic.
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2  uResolution;
uniform float uAges[8];           // per-rectangle age in seconds (-1 = inactive)
uniform vec4  uRects[8];          // [yStart, yHeight, xOffsetR, xOffsetB] per rect
uniform int   uActiveCount;
uniform float uTrail;
uniform vec3  uColor;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  float sumR = 0.0, sumG = 0.0, sumB = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uActiveCount) break;
    float age = uAges[i];
    if (age < 0.0 || age > uTrail) continue;
    vec4 rect = uRects[i];
    float yStart = rect.x;
    float yHeight = rect.y;
    // Only inside this rect's vertical band
    if (uv.y < yStart || uv.y > yStart + yHeight) continue;

    float fade = pow(1.0 - age / uTrail, 1.5);
    // Displace the rect horizontally with RGB split
    float offR = rect.z * fade;
    float offB = rect.w * fade;

    // Per-rect noise pattern modulated by age
    float n = hash(vec2(floor(uv.x * uResolution.x / 8.0), age * 40.0));
    float edge = smoothstep(0.2, 0.95, n);

    sumR += edge * fade; // offset handled by drawing the rect itself — here we produce value
    sumG += edge * fade;
    sumB += edge * fade;
    // Then add chromatic shifts using UV offset
    float rShift = smoothstep(0.2, 0.95, hash(vec2(floor((uv.x + offR) * uResolution.x / 8.0), age * 40.0)));
    float bShift = smoothstep(0.2, 0.95, hash(vec2(floor((uv.x + offB) * uResolution.x / 8.0), age * 40.0)));
    sumR = max(sumR, rShift * fade);
    sumB = max(sumB, bShift * fade);
  }
  vec3 tint = uColor;
  vec3 color = vec3(sumR * tint.r, sumG * tint.g, sumB * tint.b);
  float alpha = clamp(max(max(sumR, sumG), sumB) * 0.85, 0.0, 1.0);
  outColor = vec4(color, alpha);
}
`;

const VERT = `#version 300 es
in vec2 aPosition; out vec2 vUv;
void main() { vUv = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const schema = z.object({
  triggerOn: z.enum(["beats", "downbeats", "drops"]),
  trailSec: z.number().min(0.02).max(2).step(0.01),
  rectCount: z.number().int().min(1).max(8),
  maxOffset: z.number().min(0).max(0.5).step(0.005),
  color: z.string(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  triggerOn: "downbeats",
  trailSec: 0.12,
  rectCount: 5,
  maxOffset: 0.06,
  color: "#ffffff",
};

const hexToRgb = (hex: string): [number, number, number] => {
  const m = hex.replace("#", "").trim();
  const ex = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(ex, 16);
  if (Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
};

// Deterministic PRNG seeded by a float so renders stay byte-identical
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
  const s = gl.createShader(type); if (!s) return null;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error("glitch shader:", gl.getShaderInfoLog(s)); return null; }
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
  const { triggerOn, trailSec, rectCount, maxOffset, color } = element.props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glStateRef = useRef<{
    gl: WebGL2RenderingContext;
    prog: WebGLProgram;
    vao: WebGLVertexArrayObject;
    locs: Record<string, WebGLUniformLocation | null>;
  } | null>(null);

  const beatArr =
    triggerOn === "beats" ? ctx.beats.beats :
    triggerOn === "downbeats" ? ctx.beats.downbeats :
    ctx.beats.drops;

  const tSec = ctx.frame / Math.max(1, ctx.fps);

  // For the most recent beat within trailSec, generate rectCount rectangles
  // deterministically seeded by that beat's timestamp.
  const pack = useMemo(() => {
    // Find the most recent beat within trail
    let lastBeat = -1;
    for (const b of beatArr) {
      if (b > tSec) break;
      if (tSec - b <= trailSec) lastBeat = b;
    }
    if (lastBeat < 0) return { ages: new Float32Array(8).fill(-1), rects: new Float32Array(32), count: 0 };
    const rnd = mulberry32(Math.floor(lastBeat * 1000));
    const ages = new Float32Array(8).fill(-1);
    const rects = new Float32Array(32);
    const count = Math.min(rectCount, 8);
    const age = tSec - lastBeat;
    for (let i = 0; i < count; i++) {
      ages[i] = age;
      const yStart = rnd() * 0.9;
      const yHeight = 0.05 + rnd() * 0.15;
      const offR = (rnd() * 2 - 1) * maxOffset;
      const offB = (rnd() * 2 - 1) * maxOffset;
      rects[i * 4 + 0] = yStart;
      rects[i * 4 + 1] = yHeight;
      rects[i * 4 + 2] = offR;
      rects[i * 4 + 3] = offB;
    }
    return { ages, rects, count };
  }, [beatArr, tSec, trailSec, rectCount, maxOffset]);

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
        uAges: gl.getUniformLocation(prog, "uAges"),
        uRects: gl.getUniformLocation(prog, "uRects"),
        uActiveCount: gl.getUniformLocation(prog, "uActiveCount"),
        uTrail: gl.getUniformLocation(prog, "uTrail"),
        uColor: gl.getUniformLocation(prog, "uColor"),
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
    gl.useProgram(prog); gl.bindVertexArray(vao);
    gl.uniform2f(locs.uResolution, canvas.width, canvas.height);
    gl.uniform1fv(locs.uAges, pack.ages);
    gl.uniform4fv(locs.uRects, pack.rects);
    gl.uniform1i(locs.uActiveCount, pack.count);
    gl.uniform1f(locs.uTrail, trailSec);
    const [r, g, b] = hexToRgb(color);
    gl.uniform3f(locs.uColor, r, g, b);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [pack, trailSec, color]);

  return (
    <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", mixBlendMode: "screen" }} />
  );
};

export const GlitchShockModule: ElementModule<Props> = {
  id: "overlay.glitchShock",
  category: "overlay",
  label: "Glitch Shock",
  description: "Beat-triggered datamosh rectangles with RGB-offset tears. Up to 8 rects per beat, decays in 120ms.",
  defaultDurationSec: 30,
  defaultTrack: 6,
  schema,
  defaults,
  Renderer,
};
