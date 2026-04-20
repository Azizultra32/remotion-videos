import type React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

const stageStatusSchema = z.enum(["passed", "failed", "running", "pending"]);

const stageDataSchema = z.object({
  name: z.string(),
  status: stageStatusSchema,
  findings: z.number(),
  duration: z.string(),
});

export const mmxPipelineReportSchema = z.object({
  stages: z.array(stageDataSchema),
  runId: z.string(),
  targetRepo: z.string(),
  totalCost: z.string(),
});

type StageStatus = z.infer<typeof stageStatusSchema>;

type StageData = z.infer<typeof stageDataSchema>;

type MMXPipelineReportProps = z.infer<typeof mmxPipelineReportSchema>;

const STATUS_COLORS: Record<StageStatus, string> = {
  passed: "#22c55e",
  failed: "#ef4444",
  running: "#f59e0b",
  pending: "#6b7280",
};

export const MMXPipelineReport: React.FC<MMXPipelineReportProps> = ({
  stages,
  runId,
  targetRepo,
  totalCost,
}) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0f172a",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <Sequence from={0} durationInFrames={60}>
        <Header runId={runId} targetRepo={targetRepo} />
      </Sequence>

      {/* Pipeline stages — stagger each by 40 frames */}
      {stages.map((stage, i) => (
        <Sequence key={stage.name} from={30 + i * 40} durationInFrames={400}>
          <StageCard stage={stage} index={i} total={stages.length} />
        </Sequence>
      ))}

      {/* Summary */}
      <Sequence from={350} durationInFrames={100}>
        <Summary stages={stages} totalCost={totalCost} />
      </Sequence>
    </AbsoluteFill>
  );
};

const Header: React.FC<{ runId: string; targetRepo: string }> = ({ runId, targetRepo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({ frame, fps, config: { damping: 200 } });
  const subOpacity = interpolate(frame, [15, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <h1
        style={{
          color: "#e2e8f0",
          fontSize: 64,
          fontWeight: 800,
          transform: `scale(${titleScale})`,
          margin: 0,
          letterSpacing: 4,
        }}
      >
        MMX PIPELINE REPORT
      </h1>
      <div
        style={{
          display: "flex",
          gap: 40,
          marginTop: 20,
          opacity: subOpacity,
        }}
      >
        <span style={{ color: "#94a3b8", fontSize: 24 }}>Run: {runId}</span>
        <span style={{ color: "#94a3b8", fontSize: 24 }}>Target: {targetRepo}</span>
      </div>
    </AbsoluteFill>
  );
};

const StageCard: React.FC<{
  stage: StageData;
  index: number;
  total: number;
}> = ({ stage, index, total: _total }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slideIn = spring({ frame, fps, config: { damping: 15 } });
  const x = interpolate(slideIn, [0, 1], [-200, 0]);

  const cardY = 120 + index * 100;
  const cardWidth = 1600;
  const barWidth = interpolate(slideIn, [0, 1], [0, cardWidth]);

  const statusColor = STATUS_COLORS[stage.status];

  return (
    <div
      style={{
        position: "absolute",
        left: 160,
        top: cardY,
        width: cardWidth,
        transform: `translateX(${x}px)`,
        opacity: slideIn,
      }}
    >
      {/* Background bar */}
      <div
        style={{
          width: barWidth,
          height: 80,
          backgroundColor: "#1e293b",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          paddingLeft: 24,
          paddingRight: 24,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Status indicator */}
        <div
          style={{
            width: 6,
            height: 50,
            backgroundColor: statusColor,
            borderRadius: 3,
            marginRight: 20,
          }}
        />

        {/* Stage name */}
        <span
          style={{
            color: "#e2e8f0",
            fontSize: 28,
            fontWeight: 700,
            width: 280,
            fontFamily: "monospace",
          }}
        >
          {stage.name}
        </span>

        {/* Status badge */}
        <div
          style={{
            backgroundColor: `${statusColor}20`,
            color: statusColor,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 6,
            paddingBottom: 6,
            borderRadius: 8,
            fontSize: 18,
            fontWeight: 600,
            textTransform: "uppercase",
            marginRight: 40,
          }}
        >
          {stage.status}
        </div>

        {/* Findings count */}
        <span style={{ color: "#94a3b8", fontSize: 22, marginRight: 40 }}>
          {stage.findings > 0 ? `${stage.findings} findings` : "—"}
        </span>

        {/* Duration */}
        <span style={{ color: "#64748b", fontSize: 20 }}>{stage.duration}</span>
      </div>
    </div>
  );
};

const Summary: React.FC<{
  stages: StageData[];
  totalCost: string;
}> = ({ stages, totalCost }) => {
  const frame = useCurrentFrame();
  const { fps: _fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const passed = stages.filter((s) => s.status === "passed").length;
  const failed = stages.filter((s) => s.status === "failed").length;
  const totalFindings = stages.reduce((sum, s) => sum + s.findings, 0);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 60,
        opacity: fadeIn,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 60,
          backgroundColor: "#1e293b",
          paddingLeft: 48,
          paddingRight: 48,
          paddingTop: 20,
          paddingBottom: 20,
          borderRadius: 16,
        }}
      >
        <Stat label="Passed" value={String(passed)} color="#22c55e" />
        <Stat label="Failed" value={String(failed)} color="#ef4444" />
        <Stat label="Findings" value={String(totalFindings)} color="#3b82f6" />
        <Stat label="Cost" value={totalCost} color="#f59e0b" />
      </div>
    </AbsoluteFill>
  );
};

const Stat: React.FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div style={{ textAlign: "center" }}>
    <div style={{ color, fontSize: 36, fontWeight: 800 }}>{value}</div>
    <div style={{ color: "#94a3b8", fontSize: 18, marginTop: 4 }}>{label}</div>
  </div>
);
