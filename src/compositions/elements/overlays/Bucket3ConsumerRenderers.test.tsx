import type React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBeatsAPI } from "../../../hooks/useBeats";

const reactiveState = vi.hoisted(() => ({
  bass: 0.25,
  highs: 0.75,
  mid: 0.5,
  hasAudio: true,
  timeSec: 1.25,
}));

vi.mock("../audioReactiveRuntime", () => ({
  selectReactiveBandValue: (
    bands: { bass: number; mid: number; highs: number },
    band: "bass" | "mid" | "highs",
  ) => bands[band],
  useReactiveBands: () => reactiveState,
}));

vi.mock("remotion", () => ({
  AbsoluteFill: ({
    children,
    style,
  }: {
    children: React.ReactNode;
    style?: React.CSSProperties;
  }) => (
    <div data-testid="absolute-fill" style={style}>
      {children}
    </div>
  ),
  interpolate: (
    value: number,
    input: [number, number],
    output: [number, number],
    options?: { extrapolateLeft?: "clamp" | "extend"; extrapolateRight?: "clamp" | "extend" },
  ) => {
    const [inputStart, inputEnd] = input;
    const [outputStart, outputEnd] = output;
    let progress = (value - inputStart) / (inputEnd - inputStart);

    if (value < inputStart && options?.extrapolateLeft === "clamp") progress = 0;
    if (value > inputEnd && options?.extrapolateRight === "clamp") progress = 1;

    return outputStart + (outputEnd - outputStart) * progress;
  },
}));

vi.mock("@remotion/three", () => ({
  ThreeCanvas: ({
    children,
    height,
    width,
  }: {
    children: React.ReactNode;
    height: number;
    width: number;
  }) => (
    <div data-height={String(height)} data-testid="three-canvas" data-width={String(width)}>
      {children}
    </div>
  ),
}));

vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn(),
}));

import { BassGlowOverlayModule } from "../audio/BassGlowOverlay";
import { BeatShockModule } from "./BeatShock";
import { BloomGlowModule } from "./BloomGlow";
import { GlitchShockModule } from "./GlitchShock";
import { PlasmaBackdropModule } from "./PlasmaBackdrop";
import Three3DModule from "./Three3D";

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
  const uniform1f = vi.fn();
  const uniform1fv = vi.fn();
  const uniform1i = vi.fn();
  const uniform2f = vi.fn();
  const uniform3f = vi.fn();
  const uniform4fv = vi.fn();
  const enable = vi.fn();
  const blendFunc = vi.fn();
  const clear = vi.fn();
  const clearColor = vi.fn();
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
    clearColor,
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
    uniform1fv,
    uniform1i,
    uniform2f,
    uniform3f,
    uniform4fv,
    useProgram,
    vertexAttribPointer,
    viewport,
  } as unknown as WebGL2RenderingContext;

  return {
    gl,
    spies: {
      blendFunc,
      clearColor,
      drawArrays,
      uniform1f,
      uniform1fv,
      uniform1i,
      uniform2f,
      uniform3f,
      uniform4fv,
      viewport,
    },
  };
};

const baseCtx = {
  absTimeSec: 0,
  assetRegistry: null,
  audioSrc: "projects/demo/song.wav",
  beats: makeBeatsAPI(null),
  beatsSrc: null,
  elementLocalSec: 0,
  elementProgress: 0,
  events: [],
  fps: 20,
  frame: 0,
  height: 1080,
  width: 1920,
};

const findCallByLocation = (
  calls: unknown[][],
  locationName: string,
): unknown[] | undefined =>
  calls.find((call) => {
    const location = call[0] as { name?: string } | undefined;
    return location?.name === locationName;
  });

describe("Bucket 3 consumer renderers", () => {
  let canvasMetrics: { height: number; width: number };
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fakeGl: ReturnType<typeof makeFakeGl>;
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let originalClientWidth: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    reactiveState.bass = 0.25;
    reactiveState.mid = 0.5;
    reactiveState.highs = 0.75;
    reactiveState.hasAudio = true;
    reactiveState.timeSec = 1.25;

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
  });

  it("maps reactive bands into BassGlowOverlay opacity and hides when audio is absent", async () => {
    await act(async () => {
      root.render(
        <BassGlowOverlayModule.Renderer
          ctx={baseCtx}
          element={{
            durationSec: 4,
            id: "bass-glow-1",
            label: "Bass Glow",
            props: {
              ...BassGlowOverlayModule.defaults,
              band: "highs",
              opacityBase: 0.1,
              opacityScale: 0.4,
            },
            startSec: 0,
            trackIndex: 3,
            type: BassGlowOverlayModule.id,
          }}
        />,
      );
    });

    const overlay = container.firstElementChild as HTMLDivElement | null;
    expect(overlay).not.toBeNull();
    expect(Number(overlay?.style.opacity ?? 0)).toBeCloseTo(0.4, 9);

    reactiveState.hasAudio = false;
    await act(async () => {
      root.render(
        <BassGlowOverlayModule.Renderer
          ctx={{ ...baseCtx, audioSrc: null }}
          element={{
            durationSec: 4,
            id: "bass-glow-2",
            label: "Bass Glow",
            props: BassGlowOverlayModule.defaults,
            startSec: 0,
            trackIndex: 3,
            type: BassGlowOverlayModule.id,
          }}
        />,
      );
    });

    expect(container.firstElementChild).toBeNull();
  });

  it("uploads recent trigger ages into BeatShock uniforms", async () => {
    await act(async () => {
      root.render(
        <BeatShockModule.Renderer
          ctx={{
            ...baseCtx,
            beats: makeBeatsAPI({
              beats: [0.1, 0.4, 0.9],
              downbeats: [0.8, 1.0],
            }),
            fps: 10,
            frame: 10,
          }}
          element={{
            durationSec: 4,
            id: "beat-shock-1",
            label: "Beat Shock",
            props: {
              ...BeatShockModule.defaults,
              triggerOn: "downbeats",
              trailSec: 0.4,
            },
            startSec: 0,
            trackIndex: 6,
            type: BeatShockModule.id,
          }}
        />,
      );
    });

    expect(findCallByLocation(fakeGl.spies.uniform1i.mock.calls, "uActiveCount")?.[1]).toBe(2);
    const agesCall = findCallByLocation(fakeGl.spies.uniform1fv.mock.calls, "uAges");
    expect(agesCall).toBeDefined();
    const packed = agesCall?.[1] as Float32Array;
    expect(packed[0]).toBeCloseTo(0.2, 6);
    expect(packed[1]).toBeCloseTo(0, 6);
    expect(packed[2]).toBeCloseTo(-1, 6);
    expect(findCallByLocation(fakeGl.spies.uniform1f.mock.calls, "uTrail")?.[1]).toBe(0.4);
    expect(fakeGl.spies.drawArrays).toHaveBeenCalledWith(fakeGl.gl.TRIANGLES, 0, 6);
  });

  it("wires reactive uniforms into BloomGlow and PlasmaBackdrop", async () => {
    await act(async () => {
      root.render(
        <>
          <BloomGlowModule.Renderer
            ctx={baseCtx}
            element={{
              durationSec: 4,
              id: "bloom-1",
              label: "Bloom",
              props: {
                ...BloomGlowModule.defaults,
                color: "#fef3c7",
                haloCount: 4,
              },
              startSec: 0,
              trackIndex: 5,
              type: BloomGlowModule.id,
            }}
          />
          <PlasmaBackdropModule.Renderer
            ctx={baseCtx}
            element={{
              durationSec: 4,
              id: "plasma-1",
              label: "Plasma",
              props: {
                ...PlasmaBackdropModule.defaults,
                colorA: "#112233",
                colorB: "#445566",
                scale: 3.5,
              },
              startSec: 0,
              trackIndex: 4,
              type: PlasmaBackdropModule.id,
            }}
          />
        </>,
      );
    });

    expect(findCallByLocation(fakeGl.spies.uniform1f.mock.calls, "uHaloCount")?.[1]).toBe(4);
    expect(findCallByLocation(fakeGl.spies.uniform1f.mock.calls, "uBass")?.[1]).toBe(0.25);
    expect(findCallByLocation(fakeGl.spies.uniform1f.mock.calls, "uMid")?.[1]).toBe(0.5);
    expect(findCallByLocation(fakeGl.spies.uniform1f.mock.calls, "uHigh")?.[1]).toBe(0.75);
    expect(findCallByLocation(fakeGl.spies.uniform1f.mock.calls, "uScale")?.[1]).toBe(3.5);
    expect(findCallByLocation(fakeGl.spies.uniform3f.mock.calls, "uColorA")?.slice(1)).toEqual([
      0x11 / 255,
      0x22 / 255,
      0x33 / 255,
    ]);
    expect(findCallByLocation(fakeGl.spies.uniform3f.mock.calls, "uColorB")?.slice(1)).toEqual([
      0x44 / 255,
      0x55 / 255,
      0x66 / 255,
    ]);
  });

  it("packs deterministic rect data for GlitchShock when a trigger is inside the trail", async () => {
    await act(async () => {
      root.render(
        <GlitchShockModule.Renderer
          ctx={{
            ...baseCtx,
            beats: makeBeatsAPI({
              beats: [0.7, 0.9],
            }),
            fps: 10,
            frame: 10,
          }}
          element={{
            durationSec: 4,
            id: "glitch-1",
            label: "Glitch",
            props: {
              ...GlitchShockModule.defaults,
              rectCount: 3,
              trailSec: 0.2,
              triggerOn: "beats",
            },
            startSec: 0,
            trackIndex: 6,
            type: GlitchShockModule.id,
          }}
        />,
      );
    });

    expect(findCallByLocation(fakeGl.spies.uniform1i.mock.calls, "uActiveCount")?.[1]).toBe(3);
    const agesCall = findCallByLocation(fakeGl.spies.uniform1fv.mock.calls, "uAges");
    expect(agesCall).toBeDefined();
    const ages = agesCall?.[1] as Float32Array;
    expect(ages[0]).toBeCloseTo(0.1, 6);
    expect(ages[1]).toBeCloseTo(0.1, 6);
    expect(ages[2]).toBeCloseTo(0.1, 6);
    const rectsCall = findCallByLocation(fakeGl.spies.uniform4fv.mock.calls, "uRects");
    expect(rectsCall).toBeDefined();
    const rects = rectsCall?.[1] as Float32Array;
    expect(rects.length).toBe(32);
    expect(Array.from(rects.slice(0, 12)).some((value) => value !== 0)).toBe(true);
  });

  it("renders a sized ThreeCanvas with fade-controlled opacity", async () => {
    await act(async () => {
      root.render(
        <Three3DModule.Renderer
          ctx={{
            ...baseCtx,
            elementLocalSec: 3.75,
          }}
          element={{
            durationSec: 4,
            id: "three-1",
            label: "3D",
            props: {
              ...Three3DModule.defaults,
              fadeOutSec: 0.5,
              heightPct: 20,
              widthPct: 40,
            },
            startSec: 0,
            trackIndex: 6,
            type: Three3DModule.id,
          }}
        />,
      );
    });

    const canvas = container.querySelector('[data-testid="three-canvas"]');
    expect(canvas?.getAttribute("data-width")).toBe("768");
    expect(canvas?.getAttribute("data-height")).toBe("216");
    const wrapper = canvas?.parentElement as HTMLDivElement | null;
    expect(Number(wrapper?.style.opacity ?? 0)).toBeCloseTo(0.5, 9);
  });
});
