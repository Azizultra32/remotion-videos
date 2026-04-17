// src/components/TimelineElement.tsx
import type { TimelineElement as TimelineElementType } from "../types";
import { useElementDrag } from "../hooks/useElementDrag";
import { useEditorStore } from "../store";

interface TimelineElementProps {
  element: TimelineElementType;
  pxPerSec: number;
}

const elementColors: Record<string, string> = {
  text: "#4CAF50",
  image: "#2196F3",
  effect: "#FF9800",
  "beat-flash": "#E91E63",
};

export const TimelineElement = ({ element, pxPerSec }: TimelineElementProps) => {
  const { onMouseDown } = useElementDrag(element.id, pxPerSec);
  const { selectedElementId, selectElement } = useEditorStore();
  const isSelected = selectedElementId === element.id;

  const leftPx = element.startSec * pxPerSec;
  const widthPx = element.durationSec * pxPerSec;
  const color = elementColors[element.type] || "#666";

  return (
    <div
      onMouseDown={(e) => {
        onMouseDown(e);
        selectElement(element.id);
      }}
      style={{
        position: "absolute",
        left: leftPx,
        top: 20,
        width: widthPx,
        height: 32,
        backgroundColor: color,
        border: isSelected ? "2px solid #fff" : "1px solid rgba(0,0,0,0.3)",
        borderRadius: 4,
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        paddingLeft: 8,
        paddingRight: 8,
        fontSize: 11,
        color: "#fff",
        fontWeight: 500,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        userSelect: "none",
      }}
    >
      {element.label}
    </div>
  );
};
