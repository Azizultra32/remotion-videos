import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBeatsAPI } from "../../../hooks/useBeats";

const reactiveState = vi.hoisted(() => ({
  bass: 0.25,
  highs: 0.75,
  mid: 0.5,
  timeSec: 1.25,
}));

vi.mock("../audioReactiveRuntime", () => ({
  useReactiveBands: () => reactiveState,
}));

import { ShaderPulseModule } from "./ShaderPulse";

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

  const viewport = vi.fn();
  const useProgram = vi.fn();
  const uniform2f = vi.fn();
  const uniform1f = vi.fn();
  const uniform3f = vi.fn();
  const enable = vi.fn();
  const blendFunc = vi.fn();
  const clear = vi.fn();
  const drawArrays = vi.fn();

  const gl = {
    ARRAY_BUFFER: 0x8892,
    BLEND: 0x0be2,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8b81,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8b30,
    LINK_STATUS: 0x8b82,
    ONE: 1,
    SRC_ALPHA: 0x0302,
    STATIC_DRAW: 0x88e4,
    TRIANGLES: 0x0004,
    VERTEX_SHADER: 0x8b31,
    attachShader,
    bindAttribLocation,
    bindBuffer,
    bindVertexArray,
    blendFunc,
    bufferData,
    clear,
    compileShader,
    createBuffer,
    createProgram,
    createShader,
    createVertexArray,
    deleteBuffer,
    deleteProgram,
    deleteShader,
    deleteVertexArray,
    drawArrays,
    enable,
    enableVertexAttribArray,
    getProgramInfoLog,
    getProgramParameter,
    getShaderInfoLog,
    getShaderParameter,
    getUniformLocation,
    linkProgram,
    shaderSource,
    uniform1f,
    uniform2f,
    uniform3f,
    useProgram,
    vertexAttribPointer,
    viewport,
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
      deleteProgram,
      deleteVertexArray,
      drawArrays,
      enable,
      getUniformLocation,
      uniform1f,
      uniform2f,
      uniform3f,
      viewport,
    },
  };
};

const baseCtx = {
  absTimeSec: 0,
  assetRegistry: null,
  audioSrc: null,
  beats: makeBeatsAPI(null),
  beatsSrc: null,
  elementLocalSec: 0,
  elementProgress: 0,
  events: [],
  fps: 30,
  frame: 0,
  height: 1080,
  width: 1920,
};

const baseElement = {
  durationSec: 4,
  id: "shader-pulse-1",
  label: "Shader Pulse",
  props: {
    color: "#ff3a9e",
    intensity: 1,
  },
  startSec: 0,
  trackIndex: 5,
  type: "overlay.shaderPulse",
};

describe("ShaderPulse fullscreen WebGL runtime", () => {
  let canvasMetrics: { height: number; width: number };
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fakeGl: ReturnType<typeof makeFakeGl>;
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let originalClientWidth: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;
  let originalDevicePixelRatio: PropertyDescriptor | undefined;

  beforeEach(() => {
    canvasMetrics = { height: 180, width: 320 };
    fakeGl = makeFakeGl();

    originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "clientWidth",
    );
    originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "clientHeight",
    );
    originalDevicePixelRatio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");

    Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return canvasMetrics.width;
      },
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return canvasMetrics.height;
      },
    });
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 3,
      writable: true,
    });

    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation((contextId: string) => (contextId === "webgl2" ? fakeGl.gl : null));

    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    getContextSpy.mockRestore();
    vi.unstubAllGlobals();

    if (originalClientWidth) {
      Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", originalClientWidth);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", originalClientHeight);
    }
    if (originalDevicePixelRatio) {
      Object.defineProperty(window, "devicePixelRatio", originalDevicePixelRatio);
    }
  });

  it("uploads a fullscreen clip-space quad and draws six vertices", async () => {
    await act(async () => {
      root.render(<ShaderPulseModule.Renderer ctx={baseCtx} element={baseElement} />);
    });

    expect(fakeGl.spies.bufferData).toHaveBeenCalledTimes(1);
    const [target, data, usage] = fakeGl.spies.bufferData.mock.calls[0] as [
      number,
      Float32Array,
      number,
    ];

    expect(target).toBe(fakeGl.gl.ARRAY_BUFFER);
    expect(usage).toBe(fakeGl.gl.STATIC_DRAW);
    expect(data).toBeInstanceOf(Float32Array);
    expect(Array.from(data)).toEqual([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

    expect(fakeGl.spies.drawArrays).toHaveBeenCalledWith(fakeGl.gl.TRIANGLES, 0, 6);
  });

  it("sizes the drawing buffer from CSS pixels with fixed DPR=1", async () => {
    canvasMetrics = { height: 0.4, width: 99.75 };

    await act(async () => {
      root.render(<ShaderPulseModule.Renderer ctx={baseCtx} element={baseElement} />);
    });

    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.width).toBe(99);
    expect(canvas?.height).toBe(1);
    expect(fakeGl.spies.viewport).toHaveBeenCalledWith(0, 0, 99, 1);

    const resolutionCall = fakeGl.spies.uniform2f.mock.calls.find(
      ([location]) => (location as FakeLocation).name === "uResolution",
    );
    expect(resolutionCall).toEqual([fakeGl.locations.get("uResolution"), 99, 1]);
  });

  it("keeps the sizing deterministic even when devicePixelRatio is higher", async () => {
    canvasMetrics = { height: 180, width: 320 };

    await act(async () => {
      root.render(<ShaderPulseModule.Renderer ctx={baseCtx} element={baseElement} />);
    });

    const canvas = container.querySelector("canvas");
    expect(canvas?.width).toBe(320);
    expect(canvas?.height).toBe(180);

    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 4,
      writable: true,
    });
    reactiveState.timeSec = 2.5;

    await act(async () => {
      root.render(
        <ShaderPulseModule.Renderer
          ctx={{
            ...baseCtx,
            frame: 1,
          }}
          element={baseElement}
        />,
      );
    });

    expect(canvas?.width).toBe(320);
    expect(canvas?.height).toBe(180);
    expect(fakeGl.spies.viewport).toHaveBeenLastCalledWith(0, 0, 320, 180);
  });

  it("uploads normalized shader colors for shorthand and invalid hex inputs", async () => {
    await act(async () => {
      root.render(
        <ShaderPulseModule.Renderer
          ctx={baseCtx}
          element={{
            ...baseElement,
            props: {
              ...baseElement.props,
              color: "#0f8",
            },
          }}
        />,
      );
    });

    const firstColorCall = fakeGl.spies.uniform3f.mock.calls.find(
      ([location]) => (location as FakeLocation).name === "uColor",
    );
    expect(firstColorCall).toEqual([fakeGl.locations.get("uColor"), 0, 1, 136 / 255]);

    await act(async () => {
      root.render(
        <ShaderPulseModule.Renderer
          ctx={{
            ...baseCtx,
            frame: 2,
          }}
          element={{
            ...baseElement,
            props: {
              ...baseElement.props,
              color: "not-a-hex",
            },
          }}
        />,
      );
    });

    const colorCalls = fakeGl.spies.uniform3f.mock.calls.filter(
      ([location]) => (location as FakeLocation).name === "uColor",
    );
    expect(colorCalls[colorCalls.length - 1]).toEqual([
      fakeGl.locations.get("uColor"),
      1,
      0.5,
      0.5,
    ]);
  });
});
