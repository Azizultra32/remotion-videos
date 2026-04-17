// src/hooks/useElementDrag.ts
import { useCallback, useRef } from "react";
import { useEditorStore } from "../store";
import { snapToBeat } from "../utils/time";

export const useElementDrag = (elementId: string, pxPerSec: number) => {
  const dragStart = useRef<{ x: number; origStart: number } | null>(null);
  const { updateElement, beatData, compositionDuration } = useEditorStore();
  const beats = beatData?.beats ?? [];

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const state = useEditorStore.getState();
    const el = state.elements.find((e) => e.id === elementId);
    if (!el) return;
    dragStart.current = { x: e.clientX, origStart: el.startSec };
    const onMove = (ev: MouseEvent) => {
      if (!dragStart.current) return;
      const currentEl = useEditorStore.getState().elements.find((e) => e.id === elementId);
      if (!currentEl) return;

      const dx = ev.clientX - dragStart.current.x;
      const rawNewStart = dragStart.current.origStart + dx / pxPerSec;

      // IMPORTANT FIX: Enforce bounds - prevent dragging before 0 or past composition end
      const maxStart = state.compositionDuration - currentEl.durationSec;
      const boundedStart = Math.min(maxStart, Math.max(0, rawNewStart));

      const snapped = ev.shiftKey ? boundedStart : snapToBeat(boundedStart, beats);
      updateElement(elementId, { startSec: snapped });
    };
    const onUp = () => {
      dragStart.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [elementId, pxPerSec, updateElement, beats, compositionDuration]);

  return { onMouseDown };
};
