import { describe, expect, it, vi } from "vitest";
import {
  bindFullscreenShaderState,
  createFullscreenShaderState,
  disposeFullscreenShaderState,
  FULLSCREEN_QUAD_VERTICES,
  resizeFullscreenCanvas,
} from "./fullscreenShaderRuntime";

type FakeLocation = { name: string };

const makeFakeGl = () => {
  const locations = new Map<string, FakeLocation>();
  const createShader = vi.fn((type: number) => ({ type }));
  const shaderSource = vi.fn();
  const compileShader = vi.fn();
  const getShaderParameter = vi.fn(() => true);
  const getShaderInfoLog = vi.fn(() => "");
  const deleteShader = vi.fn();
  const createProgram = vi.fn(() => ({ kind: "program" }));
  const attachShader = vi.fn();
  const bindAttribLocation = vi.fn();
  const linkProgram = vi.fn();
  const getProgramParameter = vi.fn(() => true);
  const getProgramInfoLog = vi.fn(() => "");
  const deleteProgram = vi.fn();
  const createVertexArray = vi.fn(() => ({ kind: "vao" }));
  const bindVertexArray = vi.fn();
  const deleteVertexArray = vi.fn();
  const createBuffer = vi.fn(() => ({ kind: "buffer" }));
  const bindBuffer = vi.fn();
  const bufferData = vi.fn();
  const enableVertexAttribArray = vi.fn();
  const vertexAttribPointer = vi.fn();
  const deleteBuffer = vi.fn();
  const getUniformLocation = vi.fn((_program: unknown, name: string) => {
    const location = { name };
    locations.set(name, location);
    return location as unknown as WebGLUniformLocation;
  });
  const useProgram = vi.fn();

  const gl = {
    ARRAY_BUFFER: 0x8892,
    COMPILE_STATUS: 0x8b81,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8b30,
    LINK_STATUS: 0x8b82,
    STATIC_DRAW: 0x88e4,
    VERTEX_SHADER: 0x8b31,
    attachShader,
    bindAttribLocation,
    bindBuffer,
    bindVertexArray,
    bufferData,
    compileShader,
    createBuffer,
    createProgram,
    createShader,
    createVertexArray,
    deleteBuffer,
    deleteProgram,
    deleteShader,
    deleteVertexArray,
    enableVertexAttribArray,
    getProgramInfoLog,
    getProgramParameter,
    getShaderInfoLog,
    getShaderParameter,
    getUniformLocation,
    linkProgram,
    shaderSource,
    useProgram,
    vertexAttribPointer,
  } as unknown as WebGL2RenderingContext;

  return {
    gl,
    locations,
    spies: {
      bindBuffer,
      bindVertexArray,
      bufferData,
      createBuffer,
      createProgram,
      createShader,
      createVertexArray,
      deleteBuffer,
      deleteProgram,
      deleteShader,
      deleteVertexArray,
      getUniformLocation,
      useProgram,
    },
  };
};

describe("fullscreenShaderRuntime", () => {
  it("builds a program, fullscreen quad, and uniform map", () => {
    const fakeGl = makeFakeGl();
    const state = createFullscreenShaderState(fakeGl.gl, {
      fragmentSource: "void main() {}",
      label: "test runtime",
      uniformNames: ["uResolution", "uTime"] as const,
      vertexSource: "void main() {}",
    });

    expect(state).not.toBeNull();
    expect(fakeGl.spies.createShader).toHaveBeenCalledTimes(2);
    expect(fakeGl.spies.createProgram).toHaveBeenCalledTimes(1);
    expect(fakeGl.spies.createVertexArray).toHaveBeenCalledTimes(1);
    expect(fakeGl.spies.createBuffer).toHaveBeenCalledTimes(1);
    expect(fakeGl.spies.bufferData).toHaveBeenCalledWith(
      fakeGl.gl.ARRAY_BUFFER,
      FULLSCREEN_QUAD_VERTICES,
      fakeGl.gl.STATIC_DRAW,
    );
    expect(fakeGl.spies.getUniformLocation).toHaveBeenCalledTimes(2);
    expect(state?.locs.uResolution).toEqual(fakeGl.locations.get("uResolution"));
    expect(state?.locs.uTime).toEqual(fakeGl.locations.get("uTime"));
  });

  it("disposes program, vao, and buffer", () => {
    const fakeGl = makeFakeGl();
    const state = createFullscreenShaderState(fakeGl.gl, {
      fragmentSource: "void main() {}",
      label: "test runtime",
      uniformNames: ["uResolution"] as const,
      vertexSource: "void main() {}",
    });
    expect(state).not.toBeNull();
    if (!state) {
      throw new Error("expected fullscreen shader state");
    }

    disposeFullscreenShaderState(state);

    expect(fakeGl.spies.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(fakeGl.spies.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(fakeGl.spies.deleteProgram).toHaveBeenCalledTimes(1);
  });

  it("binds the linked program and vertex array before drawing", () => {
    const fakeGl = makeFakeGl();
    const state = createFullscreenShaderState(fakeGl.gl, {
      fragmentSource: "void main() {}",
      label: "test runtime",
      uniformNames: ["uResolution"] as const,
      vertexSource: "void main() {}",
    });
    expect(state).not.toBeNull();
    if (!state) {
      throw new Error("expected fullscreen shader state");
    }

    bindFullscreenShaderState(state);

    expect(fakeGl.spies.useProgram).toHaveBeenCalledWith(state.program);
    expect(fakeGl.spies.bindVertexArray).toHaveBeenLastCalledWith(state.vao);
  });

  it("returns null and cleans up shaders when compilation fails", () => {
    const fakeGl = makeFakeGl();
    (fakeGl.gl.getShaderParameter as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const state = createFullscreenShaderState(fakeGl.gl, {
      fragmentSource: "void main() {}",
      label: "broken runtime",
      uniformNames: ["uResolution"] as const,
      vertexSource: "void main() {}",
    });

    expect(state).toBeNull();
    expect(fakeGl.spies.deleteShader).toHaveBeenCalled();
    expect(fakeGl.spies.createProgram).not.toHaveBeenCalled();
  });

  it("returns null and deletes the program when linking fails", () => {
    const fakeGl = makeFakeGl();
    (fakeGl.gl.getProgramParameter as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const state = createFullscreenShaderState(fakeGl.gl, {
      fragmentSource: "void main() {}",
      label: "broken link",
      uniformNames: ["uResolution"] as const,
      vertexSource: "void main() {}",
    });

    expect(state).toBeNull();
    expect(fakeGl.spies.deleteShader).toHaveBeenCalledTimes(2);
    expect(fakeGl.spies.deleteProgram).toHaveBeenCalledTimes(1);
    expect(fakeGl.spies.createVertexArray).not.toHaveBeenCalled();
    expect(fakeGl.spies.createBuffer).not.toHaveBeenCalled();
  });

  it("returns null and cleans up partial allocations when vao or buffer creation fails", () => {
    const fakeGl = makeFakeGl();
    (fakeGl.gl.createVertexArray as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ kind: "vao" })
      .mockReturnValueOnce(null);
    (fakeGl.gl.createBuffer as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ kind: "buffer" });

    const missingBuffer = createFullscreenShaderState(fakeGl.gl, {
      fragmentSource: "void main() {}",
      label: "missing buffer",
      uniformNames: ["uResolution"] as const,
      vertexSource: "void main() {}",
    });
    const missingVao = createFullscreenShaderState(fakeGl.gl, {
      fragmentSource: "void main() {}",
      label: "missing vao",
      uniformNames: ["uResolution"] as const,
      vertexSource: "void main() {}",
    });

    expect(missingBuffer).toBeNull();
    expect(missingVao).toBeNull();
    expect(fakeGl.spies.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(fakeGl.spies.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(fakeGl.spies.deleteProgram).toHaveBeenCalledTimes(2);
  });

  it("sizes backing buffers from floored CSS pixels with deterministic DPR", () => {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      get: () => 99.75,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      get: () => 0.4,
    });

    const first = resizeFullscreenCanvas(canvas);
    expect(first).toEqual({ height: 1, resized: true, width: 99 });
    expect(canvas.width).toBe(99);
    expect(canvas.height).toBe(1);

    const second = resizeFullscreenCanvas(canvas, 4);
    expect(second).toEqual({ height: 1, resized: true, width: 399 });
    expect(canvas.width).toBe(399);
    expect(canvas.height).toBe(1);
  });
});
