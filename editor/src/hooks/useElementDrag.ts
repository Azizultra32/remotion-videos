// src/hooks/useElementDrag.ts
import { useCallback, useRef } from "react";
import { useEditorStore } from "../store";
import { snapTime } from "../utils/time";

export const useElementDrag = (elementId: string, pxPerSec: number) => {
  const dragStart = useRef<{ x: number; origStart: number } | null>(null);
  const { updateElement, compositionDuration } = useEditorStore();

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

      const state2 = useEditorStore.getState();
      // Shift inverts current snap behavior for this single drag: off+shift →
      // beat snap, any mode+shift → no snap. snapTime() handles the mode table.
      const snapped = snapTime(
        boundedStart,
        state2.snapMode,
        state2.beatData,
        ev.shiftKey,
      );
      updateElement(elementId, { startSec: snapped });
    };
    const onUp = () => {
      dragStart.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [elementId, pxPerSec, updateElement, compositionDuration]);

  return { onMouseDown };
};
