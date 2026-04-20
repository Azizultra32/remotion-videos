import { zColor } from "@remotion/zod-types";
import type React from "react";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

const locationSchema = z.object({
  name: z.string(),
  x: z.number(),
  y: z.number(),
  color: zColor(),
});

export const mapAnimationSchema = z.object({
  locations: z.array(locationSchema),
  connectionSpeed: z.number(),
  backgroundColor: zColor(),
});

type Location = z.infer<typeof locationSchema>;

type MapAnimationProps = z.infer<typeof mapAnimationSchema>;

type Connection = {
  from: number;
  to: number;
};

const buildConnections = (locations: Location[]): Connection[] => {
  const connections: Connection[] = [];
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      const dx = locations[i].x - locations[j].x;
      const dy = locations[i].y - locations[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 400) {
        connections.push({ from: i, to: j });
      }
    }
  }
  if (connections.length === 0 && locations.length >= 2) {
    for (let i = 0; i < locations.length - 1; i++) {
      connections.push({ from: i, to: i + 1 });
    }
  }
  return connections;
};

const REGION_DOTS: Array<{ x: number; y: number; size: number }> = [
  // North America
  { x: 180, y: 180, size: 4 },
  { x: 200, y: 200, size: 3 },
  { x: 220, y: 170, size: 3 },
  { x: 160, y: 160, size: 3 },
  { x: 240, y: 210, size: 4 },
  { x: 190, y: 230, size: 3 },
  { x: 260, y: 190, size: 3 },
  { x: 170, y: 200, size: 2 },
  { x: 210, y: 240, size: 3 },
  { x: 230, y: 250, size: 2 },
  // South America
  { x: 310, y: 380, size: 4 },
  { x: 300, y: 350, size: 3 },
  { x: 320, y: 420, size: 3 },
  { x: 290, y: 400, size: 3 },
  { x: 330, y: 450, size: 2 },
  { x: 305, y: 320, size: 2 },
  // Europe
  { x: 540, y: 160, size: 4 },
  { x: 520, y: 140, size: 3 },
  { x: 560, y: 150, size: 3 },
  { x: 530, y: 180, size: 3 },
  { x: 550, y: 170, size: 2 },
  { x: 510, y: 170, size: 3 },
  { x: 570, y: 140, size: 2 },
  { x: 500, y: 150, size: 2 },
  // Africa
  { x: 560, y: 300, size: 4 },
  { x: 540, y: 270, size: 3 },
  { x: 580, y: 330, size: 3 },
  { x: 550, y: 350, size: 3 },
  { x: 570, y: 280, size: 2 },
  { x: 530, y: 320, size: 2 },
  // Asia
  { x: 700, y: 180, size: 4 },
  { x: 720, y: 200, size: 3 },
  { x: 680, y: 160, size: 3 },
  { x: 740, y: 220, size: 3 },
  { x: 660, y: 190, size: 3 },
  { x: 760, y: 240, size: 2 },
  { x: 630, y: 170, size: 3 },
  { x: 650, y: 200, size: 2 },
  { x: 710, y: 150, size: 2 },
  // East Asia
  { x: 800, y: 210, size: 4 },
  { x: 820, y: 230, size: 3 },
  { x: 780, y: 200, size: 3 },
  { x: 830, y: 250, size: 2 },
  // Oceania
  { x: 850, y: 400, size: 4 },
  { x: 870, y: 420, size: 3 },
  { x: 830, y: 390, size: 3 },
  { x: 860, y: 380, size: 2 },
];

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 560;

const LocationDot: React.FC<{
  location: Location;
  index: number;
  fps: number;
  connectionSpeed: number;
}> = ({ location, index, fps, connectionSpeed }) => {
  const frame = useCurrentFrame();

  const delay = index * Math.max(3, Math.round(15 / connectionSpeed));
  const dotSpring = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 120, mass: 0.8 },
  });

  const pulsePhase = ((frame - delay) / fps) * 2 * Math.PI * 0.5;
  const pulseScale = 1 + Math.sin(pulsePhase) * 0.15;
  const pulseOpacity = 0.3 + Math.sin(pulsePhase) * 0.15;

  const labelOpacity = interpolate(frame - delay, [15, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <g>
      {/* Pulse ring */}
      <circle
        cx={location.x}
        cy={location.y}
        r={20 * dotSpring * pulseScale}
        fill="none"
        stroke={location.color}
        strokeWidth={1.5}
        opacity={pulseOpacity * dotSpring}
      />
      {/* Glow */}
      <circle
        cx={location.x}
        cy={location.y}
        r={14 * dotSpring}
        fill={location.color}
        opacity={0.2 * dotSpring}
      />
      {/* Main dot */}
      <circle
        cx={location.x}
        cy={location.y}
        r={8 * dotSpring}
        fill={location.color}
        opacity={dotSpring}
      />
      {/* Inner bright dot */}
      <circle
        cx={location.x}
        cy={location.y}
        r={3 * dotSpring}
        fill="white"
        opacity={0.8 * dotSpring}
      />
      {/* Label */}
      <text
        x={location.x}
        y={location.y - 22}
        textAnchor="middle"
        fill="white"
        fontSize={13}
        fontFamily="system-ui, sans-serif"
        fontWeight={600}
        opacity={labelOpacity}
      >
        {location.name}
      </text>
    </g>
  );
};

const ConnectionLine: React.FC<{
  from: Location;
  to: Location;
  index: number;
  locationCount: number;
  fps: number;
  connectionSpeed: number;
}> = ({ from, to, index, locationCount, fps: _fps, connectionSpeed }) => {
  const frame = useCurrentFrame();

  const baseDelay = locationCount * Math.max(3, Math.round(15 / connectionSpeed));
  const lineDelay = baseDelay + index * Math.max(4, Math.round(12 / connectionSpeed));

  const progress = interpolate(
    frame - lineDelay,
    [0, Math.max(10, Math.round(30 / connectionSpeed))],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  if (progress <= 0) return null;

  const _currentX = from.x + (to.x - from.x) * progress;
  const _currentY = from.y + (to.y - from.y) * progress;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const midX = from.x + dx * 0.5;
  const midY = from.y + dy * 0.5 - Math.abs(dx) * 0.12;

  const t = progress;
  const curveX = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * midX + t * t * to.x;
  const curveY = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * midY + t * t * to.y;

  const pathD = `M ${from.x} ${from.y} Q ${midX} ${midY} ${curveX} ${curveY}`;

  const particleT = ((frame - lineDelay) % 40) / 40;
  const pX =
    (1 - particleT) * (1 - particleT) * from.x +
    2 * (1 - particleT) * particleT * midX +
    particleT * particleT * to.x;
  const pY =
    (1 - particleT) * (1 - particleT) * from.y +
    2 * (1 - particleT) * particleT * midY +
    particleT * particleT * to.y;

  return (
    <g>
      <path
        d={pathD}
        fill="none"
        stroke={`${from.color}88`}
        strokeWidth={2}
        strokeLinecap="round"
      />
      {progress >= 1 && <circle cx={pX} cy={pY} r={3} fill="white" opacity={0.7} />}
    </g>
  );
};

export const MapAnimation: React.FC<MapAnimationProps> = ({
  locations,
  connectionSpeed,
  backgroundColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const connections = useMemo(() => buildConnections(locations), [locations]);

  const mapBgOpacity = interpolate(frame, [0, 20], [0, 0.3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleSlide = interpolate(frame, [0, 15], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const activeCount = locations.filter((_, i) => {
    const delay = i * Math.max(3, Math.round(15 / connectionSpeed));
    return frame > delay + 10;
  }).length;

  const counterOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        overflow: "hidden",
      }}
    >
      {/* Subtle grid background */}
      <AbsoluteFill style={{ opacity: 0.05 }}>
        <svg role="img" aria-label="World map" width="100%" height="100%">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth={0.5} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </AbsoluteFill>

      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: 40,
          left: 60,
          opacity: titleOpacity,
          transform: `translateY(${titleSlide}px)`,
          zIndex: 10,
        }}
      >
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            color: "white",
            fontFamily: "system-ui, sans-serif",
            letterSpacing: -1,
          }}
        >
          Global Network
        </div>
        <div
          style={{
            fontSize: 18,
            color: "rgba(255,255,255,0.5)",
            fontFamily: "system-ui, sans-serif",
            marginTop: 4,
          }}
        >
          Expanding worldwide
        </div>
      </div>

      {/* Active locations counter */}
      <div
        style={{
          position: "absolute",
          top: 40,
          right: 60,
          opacity: counterOpacity,
          zIndex: 10,
          textAlign: "right",
        }}
      >
        <div
          style={{
            fontSize: 56,
            fontWeight: 800,
            color: "white",
            fontFamily: "system-ui, sans-serif",
            lineHeight: 1,
          }}
        >
          {activeCount}
        </div>
        <div
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.5)",
            fontFamily: "system-ui, sans-serif",
            textTransform: "uppercase",
            letterSpacing: 2,
          }}
        >
          Locations
        </div>
      </div>

      {/* Map container */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -45%)",
          width: MAP_WIDTH,
          height: MAP_HEIGHT,
        }}
      >
        <svg
          role="img"
          aria-label="Map regions and connections"
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
        >
          {/* Background region dots */}
          {REGION_DOTS.map((dot, i) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
              key={`bg-${i}`}
              cx={dot.x}
              cy={dot.y}
              r={dot.size}
              fill="rgba(255,255,255,0.12)"
              opacity={mapBgOpacity}
            />
          ))}

          {/* Connection lines */}
          {connections.map((conn, i) => (
            <ConnectionLine
              // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
              key={`conn-${i}`}
              from={locations[conn.from]}
              to={locations[conn.to]}
              index={i}
              locationCount={locations.length}
              fps={fps}
              connectionSpeed={connectionSpeed}
            />
          ))}

          {/* Location dots */}
          {locations.map((loc, i) => (
            <LocationDot
              // biome-ignore lint/suspicious/noArrayIndexKey: deterministic Remotion render; array never reorders
              key={`loc-${i}`}
              location={loc}
              index={i}
              fps={fps}
              connectionSpeed={connectionSpeed}
            />
          ))}
        </svg>
      </div>

      {/* Bottom accent line */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background:
            locations.length > 0
              ? `linear-gradient(90deg, ${locations.map((l, i) => `${l.color} ${(i / (locations.length - 1 || 1)) * 100}%`).join(", ")})`
              : "rgba(255,255,255,0.2)",
          opacity: interpolate(frame, [0, 30], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
    </AbsoluteFill>
  );
};
