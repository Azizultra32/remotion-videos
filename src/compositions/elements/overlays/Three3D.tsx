import type React from "react";
import { useRef } from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useFrame } from "@react-three/fiber";
import type { Mesh } from "three";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

// Real 3D via @remotion/three + @react-three/fiber. Renders a primitive
// (cube / sphere / torus / cone) with configurable color, position,
// size, and per-axis rotation speed. Ambient + directional lighting
// bakes in so the material reads without the user having to set up a
// scene graph. Positioned in viewport percent inside a rectangular
// sub-canvas — ThreeCanvas manages its own WebGL context per instance.
//
// Deterministic: rotation is driven by useFrame's clock.elapsedTime
// (seeded from Remotion's frame clock in headless render), so any
// (frame, props) tuple produces the same pixels.

const schema = z.object({
  shape: z.enum(["cube", "sphere", "torus", "cone"]),
  color: z.string(),
  x: z.number().min(-50).max(150),
  y: z.number().min(-50).max(150),
  widthPct: z.number().min(5).max(200),
  heightPct: z.number().min(5).max(200),
  scale: z.number().min(0.1).max(8),
  rotXPerSec: z.number().min(-6.28).max(6.28),
  rotYPerSec: z.number().min(-6.28).max(6.28),
  rotZPerSec: z.number().min(-6.28).max(6.28),
  wireframe: z.boolean(),
  fadeInSec: z.number().min(0).max(5),
  fadeOutSec: z.number().min(0).max(5),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  shape: "cube",
  color: "#ff6600",
  x: 50,
  y: 50,
  widthPct: 60,
  heightPct: 60,
  scale: 1,
  rotXPerSec: 0.4,
  rotYPerSec: 0.8,
  rotZPerSec: 0,
  wireframe: false,
  fadeInSec: 0.2,
  fadeOutSec: 0.2,
};

const SpinningMesh: React.FC<{
  shape: Props["shape"];
  color: string;
  scale: number;
  rotXPerSec: number;
  rotYPerSec: number;
  rotZPerSec: number;
  wireframe: boolean;
}> = ({ shape, color, scale, rotXPerSec, rotYPerSec, rotZPerSec, wireframe }) => {
  const meshRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
    meshRef.current.rotation.x = rotXPerSec * t;
    meshRef.current.rotation.y = rotYPerSec * t;
    meshRef.current.rotation.z = rotZPerSec * t;
  });

  const geometry = (() => {
    switch (shape) {
      case "sphere":
        return <sphereGeometry args={[1, 48, 32]} />;
      case "torus":
        return <torusGeometry args={[0.8, 0.3, 24, 96]} />;
      case "cone":
        return <coneGeometry args={[1, 1.6, 48]} />;
      default:
        return <boxGeometry args={[1.4, 1.4, 1.4]} />;
    }
  })();

  return (
    <mesh ref={meshRef} scale={scale}>
      {geometry}
      <meshStandardMaterial color={color} wireframe={wireframe} />
    </mesh>
  );
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    shape,
    color,
    x,
    y,
    widthPct,
    heightPct,
    scale,
    rotXPerSec,
    rotYPerSec,
    rotZPerSec,
    wireframe,
    fadeInSec,
    fadeOutSec,
  } = element.props;

  const localSec = ctx.elementLocalSec;
  const durationSec = element.durationSec;
  const fadeIn =
    fadeInSec <= 0
      ? 1
      : interpolate(localSec, [0, fadeInSec], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const fadeOut =
    fadeOutSec <= 0
      ? 1
      : interpolate(
          localSec,
          [Math.max(0, durationSec - fadeOutSec), durationSec],
          [1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
  const opacity = fadeIn * fadeOut;

  const canvasW = Math.max(8, Math.round(ctx.width * (widthPct / 100)));
  const canvasH = Math.max(8, Math.round(ctx.height * (heightPct / 100)));

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${x - widthPct / 2}%`,
          top: `${y - heightPct / 2}%`,
          width: `${widthPct}%`,
          height: `${heightPct}%`,
          opacity,
        }}
      >
        <ThreeCanvas width={canvasW} height={canvasH}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 5, 5]} intensity={1.2} />
          <directionalLight position={[-4, -2, 3]} intensity={0.4} />
          <SpinningMesh
            shape={shape}
            color={color}
            scale={scale}
            rotXPerSec={rotXPerSec}
            rotYPerSec={rotYPerSec}
            rotZPerSec={rotZPerSec}
            wireframe={wireframe}
          />
        </ThreeCanvas>
      </div>
    </AbsoluteFill>
  );
};

const Three3DModule: ElementModule<Props> = {
  id: "overlay.three3D",
  category: "overlay",
  label: "3D Object",
  description: "Real-time 3D primitive (cube / sphere / torus / cone) via Three.js + @remotion/three.",
  defaultDurationSec: 4,
  defaultTrack: 6,
  schema,
  defaults,
  Renderer,
};

export default Three3DModule;
export { Three3DModule };
