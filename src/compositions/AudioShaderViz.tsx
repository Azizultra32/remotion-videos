import React, { useMemo } from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Audio,
} from "remotion";
import { z } from "zod";

export const audioShaderVizSchema = z.object({
  audioSrc: z.string(),
  beatsSrc: z.string(),
  shaderPreset: z.enum(["sonar", "spectrum", "tunnel"]).default("sonar"),
  colorPalette: z.enum(["blue", "purple", "fire", "ice"]).default("blue"),
  beatSensitivity: z.number().min(0).max(2).default(1.0),
});

type BeatsFile = {
  duration: number;
  bpm_global: number;
  beats: number[];
  downbeats: number[];
  energy?: Array<{ t: number; db: number }>;
};

const beatsCache = new Map<string, BeatsFile>();

const loadBeats = async (src: string): Promise<BeatsFile> => {
  const cached = beatsCache.get(src);
  if (cached) return cached;
  const res = await fetch(staticFile(src));
  const json = (await res.json()) as BeatsFile;
  beatsCache.set(src, json);
  return json;
};

const useBeats = (src: string): BeatsFile | null => {
  const [data, setData] = React.useState<BeatsFile | null>(
    beatsCache.get(src) ?? null,
  );
  const [handle] = React.useState(() =>
    !beatsCache.get(src) ? delayRender(`beats:${src}`) : null,
  );

  React.useEffect(() => {
    if (beatsCache.get(src)) {
      if (handle !== null) continueRender(handle);
      return;
    }
    loadBeats(src)
      .then((d) => {
        setData(d);
        if (handle !== null) continueRender(handle);
      })
      .catch((e) => {
        console.error(e);
        if (handle !== null) continueRender(handle);
      });
  }, [src, handle]);

  return data;
};

const lowerBound = (arr: number[], t: number): number => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const timeSinceLastBeat = (beats: number[], t: number): number => {
  if (beats.length === 0) return Infinity;
  const i = lowerBound(beats, t);
  const prev = i > 0 ? beats[i - 1] : -Infinity;
  return t - prev;
};

// GLSL Fragment Shader (Sonar Preset)
const sonarShaderSource = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float beatPulse;
uniform float downbeatFlash;
uniform float bassEnergy;
uniform vec3 color1;
uniform vec3 color2;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * resolution.xy) / min(resolution.x, resolution.y);
  float dist = length(uv);

  // Pulsing rings from center
  float rings = sin((dist - time * 0.3) * 20.0 + beatPulse * 10.0) * 0.5 + 0.5;
  rings = pow(rings, 2.0 - beatPulse);

  // Radial gradient
  float radial = 1.0 - smoothstep(0.0, 1.5, dist);

  // Color mix based on bass energy
  vec3 color = mix(color1, color2, rings * bassEnergy);
  color *= radial;
  color += downbeatFlash * 0.3;

  gl_FragColor = vec4(color, 1.0);
}
`;

const ShaderCanvas: React.FC<{
  width: number;
  height: number;
  beatPulse: number;
  downbeatFlash: number;
  bassEnergy: number;
  colorPalette: string;
}> = ({ width, height, beatPulse, downbeatFlash, bassEnergy, colorPalette }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const glRef = React.useRef<WebGLRenderingContext | null>(null);
  const programRef = React.useRef<WebGLProgram | null>(null);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Color palettes
  const palettes: Record<string, { color1: [number, number, number]; color2: [number, number, number] }> = {
    blue: { color1: [0.1, 0.2, 0.5], color2: [0.3, 0.6, 1.0] },
    purple: { color1: [0.3, 0.1, 0.5], color2: [0.8, 0.3, 1.0] },
    fire: { color1: [0.5, 0.1, 0.0], color2: [1.0, 0.5, 0.0] },
    ice: { color1: [0.0, 0.3, 0.4], color2: [0.4, 0.9, 1.0] },
  };

  const palette = palettes[colorPalette] || palettes.blue;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl");
    if (!gl) return;
    glRef.current = gl;

    // Compile shader
    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(
      vertexShader,
      `attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`,
    );
    gl.compileShader(vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragmentShader, sonarShaderSource);
    gl.compileShader(fragmentShader);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    programRef.current = program;

    // Setup geometry
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }, []);

  React.useEffect(() => {
    const gl = glRef.current;
    const program = programRef.current;
    if (!gl || !program) return;

    gl.useProgram(program);

    // Set uniforms
    const resolutionLoc = gl.getUniformLocation(program, "resolution");
    gl.uniform2f(resolutionLoc, width, height);

    const timeLoc = gl.getUniformLocation(program, "time");
    gl.uniform1f(timeLoc, frame / fps);

    const beatPulseLoc = gl.getUniformLocation(program, "beatPulse");
    gl.uniform1f(beatPulseLoc, beatPulse);

    const downbeatFlashLoc = gl.getUniformLocation(program, "downbeatFlash");
    gl.uniform1f(downbeatFlashLoc, downbeatFlash);

    const bassEnergyLoc = gl.getUniformLocation(program, "bassEnergy");
    gl.uniform1f(bassEnergyLoc, bassEnergy);

    const color1Loc = gl.getUniformLocation(program, "color1");
    gl.uniform3f(color1Loc, ...palette.color1);

    const color2Loc = gl.getUniformLocation(program, "color2");
    gl.uniform3f(color2Loc, ...palette.color2);

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, [frame, fps, beatPulse, downbeatFlash, bassEnergy, width, height, palette]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

export const AudioShaderViz: React.FC<z.infer<typeof audioShaderVizSchema>> = ({
  audioSrc,
  beatsSrc,
  shaderPreset,
  colorPalette,
  beatSensitivity,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const beats = useBeats(beatsSrc);
  const timeSec = frame / fps;

  const { beatPulse, downbeatFlash, bassEnergy } = useMemo(() => {
    if (!beats || beats.beats.length === 0) {
      return { beatPulse: 0, downbeatFlash: 0, bassEnergy: 0.5 };
    }

    const sinceBeat = timeSinceLastBeat(beats.beats, timeSec);
    const sinceDown = timeSinceLastBeat(beats.downbeats, timeSec);

    const beatPulse = sinceBeat >= 0 ? Math.exp(-sinceBeat * 8) * beatSensitivity : 0;
    const downbeatFlash = sinceDown >= 0 ? Math.exp(-sinceDown * 5) * beatSensitivity : 0;

    // Get bass energy from energy curve
    let bassEnergy = 0.5;
    if (beats.energy && beats.energy.length > 0) {
      const energyPoint = beats.energy.find((e) => Math.abs(e.t - timeSec) < 0.5);
      if (energyPoint) {
        // Normalize -20dB to 0dB → 0.0 to 1.0
        bassEnergy = Math.max(0, Math.min(1, (energyPoint.db + 20) / 20));
      }
    }

    return { beatPulse, downbeatFlash, bassEnergy };
  }, [beats, timeSec, beatSensitivity]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Audio src={staticFile(audioSrc)} />
      <ShaderCanvas
        width={width}
        height={height}
        beatPulse={beatPulse}
        downbeatFlash={downbeatFlash}
        bassEnergy={bassEnergy}
        colorPalette={colorPalette}
      />
    </AbsoluteFill>
  );
};

export const defaultAudioShaderVizProps: z.infer<typeof audioShaderVizSchema> = {
  audioSrc: "dubfire-sake.mp4",
  beatsSrc: "dubfire-beats.json",
  shaderPreset: "sonar",
  colorPalette: "blue",
  beatSensitivity: 1.0,
};
