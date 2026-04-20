// src/utils/projectJson.ts
// Export + import of the editor's current state as a self-contained JSON
// file. Same shape is accepted by `npx remotion render ... --props=<json>`
// so the file is the render contract, not a separate format.

import { useEditorStore } from "../store";
import type { TimelineElement } from "../types";

export type ProjectFile = {
  version: 1;
  audioSrc: string | null;
  beatsSrc: string | null;
  backgroundColor: string;
  fps: number;
  compositionDuration: number;
  elements: TimelineElement[];
};

export const exportProject = (): ProjectFile => {
  const s = useEditorStore.getState();
  return {
    version: 1,
    audioSrc: s.audioSrc,
    beatsSrc: s.beatsSrc,
    backgroundColor: "#000000",
    fps: s.fps,
    compositionDuration: s.compositionDuration,
    elements: s.elements,
  };
};

export const downloadProjectFile = (name = "musicvideo") => {
  const data = exportProject();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.musicvideo.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const importProjectFromFile = async (file: File): Promise<void> => {
  const text = await file.text();
  const data = JSON.parse(text) as ProjectFile;
  if (data.version !== 1) {
    throw new Error(`Unsupported project version: ${data.version}`);
  }
  useEditorStore.setState({
    audioSrc: data.audioSrc ?? null,
    beatsSrc: data.beatsSrc ?? null,
    fps: data.fps ?? 24,
    compositionDuration: data.compositionDuration ?? 90,
    elements: Array.isArray(data.elements) ? data.elements : [],
    selectedElementId: null,
    currentTimeSec: 0,
    isPlaying: false,
  });
};
