// src/components/RenderButton.tsx
// Render-to-MP4 trigger button — wired to the Vite sidecar via useRender().
import { useRender } from "../hooks/useRender";

// Base button style matches ProjectActions' `btn` shape.
const base: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 4,
  fontSize: 11,
  cursor: "pointer",
  border: "1px solid",
};

const idle: React.CSSProperties = {
  ...base,
  background: "#0d2a4a",
  borderColor: "#2a6aad",
  color: "#6bc",
};

const rendering: React.CSSProperties = {
  ...base,
  background: "#1a2a00",
  borderColor: "#5a8",
  color: "#af9",
  cursor: "default",
};

const done: React.CSSProperties = {
  ...base,
  background: "#0a2a0a",
  borderColor: "#3a8a3a",
  color: "#6f6",
  cursor: "pointer",
};

const error: React.CSSProperties = {
  ...base,
  background: "#2a0a0a",
  borderColor: "#8a3a3a",
  color: "#f88",
  cursor: "pointer",
};

const cancelled: React.CSSProperties = {
  ...base,
  background: "#1a1a2a",
  borderColor: "#555",
  color: "#aaa",
};

const cancelLink: React.CSSProperties = {
  fontSize: 10,
  color: "#f88",
  cursor: "pointer",
  textDecoration: "underline",
  background: "none",
  border: "none",
  padding: 0,
};

const progressBar: React.CSSProperties = {
  height: 2,
  background: "#1a3a2a",
  borderRadius: 1,
  marginTop: 2,
  width: 80,
  overflow: "hidden",
};

const progressFill = (pct: number): React.CSSProperties => ({
  height: "100%",
  width: `${pct}%`,
  background: "#5a8",
  transition: "width 0.2s ease",
});

export const RenderButton = () => {
  const { render, status, progress, error: renderError, outPath, outName, cancel } = useRender();

  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  if (status === "rendering") {
    const label = progress ? `Rendering… ${progress.done}/${progress.total}` : "Rendering…";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button style={rendering} disabled title="Render in progress">
            {label}
          </button>
          <button style={cancelLink} onClick={cancel} title="Abort the render">
            Cancel
          </button>
        </div>
        <div style={progressBar}>
          <div style={progressFill(pct)} />
        </div>
      </div>
    );
  }

  if (status === "done" && outName) {
    return (
      <button
        style={done}
        onClick={() => window.open(`/api/out/${encodeURIComponent(outName)}`, "_blank")}
        title={`Render complete: ${outPath ?? outName}`}
      >
        Rendered — click to open
      </button>
    );
  }

  if (status === "error") {
    const msg = renderError ?? "unknown error";
    return (
      <button style={error} onClick={() => render()} title={`Error: ${msg} — click to retry`}>
        Render failed — retry?
      </button>
    );
  }

  if (status === "cancelled") {
    return (
      <button
        style={cancelled}
        onClick={() => render()}
        title="Render was cancelled — click to try again"
      >
        Render cancelled — retry?
      </button>
    );
  }

  // idle
  return (
    <button style={idle} onClick={() => render()} title="Render timeline to MP4 via sidecar">
      Render MP4
    </button>
  );
};
