import { getElementModule, getElementSourcePath } from "@compositions/elements/registry";
import { useElementDrag } from "../hooks/useElementDrag";
import { useElementResize } from "../hooks/useElementResize";
import { useEditorStore } from "../store";
import type { TimelineElement as TimelineElementType } from "../types";
import { openInEditor } from "../utils/openInEditor";

type Props = {
  element: TimelineElementType;
  pxPerSec: number;
  height: number;
};

// Category-based color, falls back to the old hard-coded map for legacy types.
const categoryColors: Record<string, string> = {
  text: "#4CAF50",
  audio: "#9C27B0",
  shape: "#FF9800",
  overlay: "#00BCD4",
  video: "#2196F3",
};
const legacyColors: Record<string, string> = {
  text: "#4CAF50",
  image: "#2196F3",
  effect: "#FF9800",
  "beat-flash": "#E91E63",
};

const HANDLE_W = 6;

export const TimelineElement = ({ element, pxPerSec, height }: Props) => {
  const drag = useElementDrag(element.id, pxPerSec);
  const resizeL = useElementResize(element.id, pxPerSec, "left");
  const resizeR = useElementResize(element.id, pxPerSec, "right");
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const isSelected = selectedElementId === element.id;

  const mod = getElementModule(element.type);
  const color = mod
    ? (categoryColors[mod.category] ?? "#666")
    : (legacyColors[element.type] ?? "#666");

  const leftPx = element.startSec * pxPerSec;
  const widthPx = Math.max(HANDLE_W * 2 + 4, element.durationSec * pxPerSec);

  return (
    <div
      style={{
        position: "absolute",
        left: leftPx,
        top: 0,
        width: widthPx,
        height,
        backgroundColor: color,
        border: isSelected ? "2px solid #fff" : "1px solid rgba(0,0,0,0.3)",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        fontSize: 11,
        color: "#fff",
        fontWeight: 500,
        overflow: "hidden",
        userSelect: "none",
        boxSizing: "border-box",
      }}
    >
      {/* Left resize handle */}
      <div
        onMouseDown={(e) => {
          resizeL.onMouseDown(e);
          selectElement(element.id);
        }}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: HANDLE_W,
          cursor: "ew-resize",
          background: isSelected ? "rgba(255,255,255,0.2)" : "transparent",
        }}
      />
      {/* Body — click/drag to move, click to select, double-click to open source */}
      <div
        onMouseDown={(e) => {
          drag.onMouseDown(e);
          selectElement(element.id);
        }}
        onDoubleClick={() => {
          const src = getElementSourcePath(element.type);
          if (src) void openInEditor(src);
        }}
        title={(() => {
          const src = getElementSourcePath(element.type);
          return src ? `${element.label} — double-click to open ${src}` : element.label;
        })()}
        style={{
          position: "absolute",
          left: HANDLE_W,
          right: HANDLE_W,
          top: 0,
          bottom: 0,
          cursor: "grab",
          paddingLeft: 4,
          paddingRight: 4,
          display: "flex",
          alignItems: "center",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
        }}
      >
        {element.label}
      </div>
      {/* Right resize handle */}
      <div
        onMouseDown={(e) => {
          resizeR.onMouseDown(e);
          selectElement(element.id);
        }}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: HANDLE_W,
          cursor: "ew-resize",
          background: isSelected ? "rgba(255,255,255,0.2)" : "transparent",
        }}
      />
    </div>
  );
};
