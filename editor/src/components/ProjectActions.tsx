// src/components/ProjectActions.tsx
// Top-bar actions: Render to MP4, Export project.json, Import project.json.
import { useRef, useState } from "react";
import { downloadProjectFile, importProjectFromFile } from "../utils/projectJson";
import { RenderButton } from "./RenderButton";

const btnCls = "editor-btn editor-btn--accent";

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
        type="button"
        onClick={() => downloadProjectFile()}
        title="Download current timeline as .musicvideo.json (feeds `remotion render --props=...`)"
        className={btnCls}
      >
        Export JSON
      </button>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        title="Load a .musicvideo.json file"
        className={btnCls}
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
        <span style={{ fontSize: 10, color: "var(--danger)" }} title={error}>
          import failed: {error.slice(0, 40)}
        </span>
      )}
    </div>
  );
};
