export const FULLSCREEN_QUAD_VERTICES = new Float32Array([
  -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
]);

export type FullscreenShaderState<TUniform extends string> = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  locs: Record<TUniform, WebGLUniformLocation | null>;
};

type CreateFullscreenShaderStateOptions<TUniform extends string> = {
  fragmentSource: string;
  label: string;
  uniformNames: readonly TUniform[];
  vertexSource: string;
};

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader | null => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console
    console.error(`${label}:`, gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

export const createFullscreenShaderState = <TUniform extends string>(
  gl: WebGL2RenderingContext,
  {
    fragmentSource,
    label,
    uniformNames,
    vertexSource,
  }: CreateFullscreenShaderStateOptions<TUniform>,
): FullscreenShaderState<TUniform> | null => {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label} vertex`);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    // eslint-disable-next-line no-console
    console.error(`${label} program:`, gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  if (!vao || !buffer) {
    if (vao) gl.deleteVertexArray(vao);
    if (buffer) gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    return null;
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_QUAD_VERTICES, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const locs = Object.fromEntries(
    uniformNames.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<TUniform, WebGLUniformLocation | null>;

  return { gl, program, vao, buffer, locs };
};

export const disposeFullscreenShaderState = <TUniform extends string>(
  state: FullscreenShaderState<TUniform>,
): void => {
  const { gl, buffer, program, vao } = state;
  gl.deleteBuffer(buffer);
  gl.deleteVertexArray(vao);
  gl.deleteProgram(program);
};

export const bindFullscreenShaderState = <TUniform extends string>(
  state: FullscreenShaderState<TUniform>,
): void => {
  const { gl, program, vao } = state;
  Reflect.apply(gl.useProgram, gl, [program]);
  gl.bindVertexArray(vao);
};

export const resizeFullscreenCanvas = (
  canvas: HTMLCanvasElement,
  dpr = 1,
): { height: number; resized: boolean; width: number } => {
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  const resized = canvas.width !== width || canvas.height !== height;
  if (resized) {
    canvas.width = width;
    canvas.height = height;
  }
  return { height, resized, width };
};
