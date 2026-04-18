// src/components/ProjectActions.tsx
// Top-bar actions: Render to MP4, Export project.json, Import project.json.
import { useRef, useState } from "react";
import {
  downloadProjectFile,
  importProjectFromFile,
} from "../utils/projectJson";
import { RenderButton } from "./RenderButton";

const btn: React.CSSProperties = {
  padding: "4px 10px",
  background: "#1a2a3a",
  border: "1px solid #368",
  borderRadius: 4,
  color: "#8cf",
  fontSize: 11,
  cursor: "pointer",
};

export const ProjectActions = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await importProjectFromFile(f);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // Reset so selecting the same file again re-triggers onChange.
    e.target.value = "";
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <RenderButton />
      <button
        onClick={() => downloadProjectFile()}
        title="Download current timeline as .musicvideo.json (feeds `remotion render --props=...`)"
        style={btn}
      >
        Export JSON
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        title="Load a .musicvideo.json file"
        style={{ ...btn, background: "#2a1a3a", borderColor: "#63a", color: "#c8f" }}
      >
        Import JSON
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={onImport}
      />
      {error && (
        <span style={{ fontSize: 10, color: "#f88" }} title={error}>
          import failed: {error.slice(0, 40)}
        </span>
      )}
    </div>
  );
};
