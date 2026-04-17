// src/hooks/useElementDrag.ts
import { useCallback, useRef } from "react";
import { useEditorStore } from "../store";
import { snapToBeat } from "../utils/time";

export const useElementDrag = (elementId: string, pxPerSec: number) => {
  const dragStart = useRef<{ x: number; origStart: number } | null>(null);
  const { updateElement, beatData } = useEditorStore();
  const beats = beatData?.beats ?? [];

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = useEditorStore.getState().elements.find((e) => e.id === elementId);
    if (!el) return;
    dragStart.current = { x: e.clientX, origStart: el.startSec };
    const onMove = (ev: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = ev.clientX - dragStart.current.x;
      const newStart = Math.max(0, dragStart.current.origStart + dx / pxPerSec);
      const snapped = ev.shiftKey ? newStart : snapToBeat(newStart, beats);
      updateElement(elementId, { startSec: snapped });
    };
    const onUp = () => {
      dragStart.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [elementId, pxPerSec, updateElement, beats]);

  return { onMouseDown };
};
