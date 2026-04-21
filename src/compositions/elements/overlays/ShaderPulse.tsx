import type React from "react";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { useFFT } from "../../../hooks/useFFT";
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
  const expanded = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(expanded, 16);
  if (Number.isNaN(n)) return [1, 0.5, 0.5];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
};

const compileShader = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console
    console.error("shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const createProgram = (gl: WebGL2RenderingContext): WebGLProgram | null => {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aPosition");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    // eslint-disable-next-line no-console
    console.error("program link error:", gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { color, intensity } = element.props;
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
  });

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
    const prog = createProgram(gl);
    if (!prog) return;
    const vao = gl.createVertexArray();
    if (!vao) return;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    // Fullscreen quad in clip space
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    glStateRef.current = {
      gl,
      prog,
      vao,
      locs: {
        uResolution: gl.getUniformLocation(prog, "uResolution"),
        uTime: gl.getUniformLocation(prog, "uTime"),
        uBass: gl.getUniformLocation(prog, "uBass"),
        uMid: gl.getUniformLocation(prog, "uMid"),
        uHigh: gl.getUniformLocation(prog, "uHigh"),
        uColor: gl.getUniformLocation(prog, "uColor"),
      },
    };
    return () => {
      if (!glStateRef.current) return;
      const { gl } = glStateRef.current;
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      glStateRef.current = null;
    };
  }, []);

  // Per-frame paint: Remotion re-renders this component on every frame via
  // ctx.frame prop change, so this effect re-fires frame-by-frame.
  useEffect(() => {
    const state = glStateRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas) return;
    const { gl, prog, vao, locs } = state;

    // Size the drawing buffer to the canvas's CSS size; Remotion's composition
    // width/height already constrain this via the parent.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const targetW = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const targetH = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(locs.uResolution, canvas.width, canvas.height);
    gl.uniform1f(locs.uTime, ctx.frame / Math.max(1, ctx.fps));
    gl.uniform1f(locs.uBass, (fft?.bass ?? 0) * intensity);
    gl.uniform1f(locs.uMid, (fft?.mid ?? 0) * intensity);
    gl.uniform1f(locs.uHigh, (fft?.highs ?? 0) * intensity);
    const [r, g, b] = hexToRgb(color);
    gl.uniform3f(locs.uColor, r, g, b);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [ctx.frame, ctx.fps, fft?.bass, fft?.mid, fft?.highs, color, intensity]);

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
  description: "WebGL fragment shader: audio-reactive radial glow + grain. Bass = pulse size, mid = hue drift, highs = grain.",
  defaultDurationSec: 30,
  defaultTrack: 5,
  schema,
  defaults,
  Renderer,
};
