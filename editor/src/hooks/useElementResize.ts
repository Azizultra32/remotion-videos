import { useCallback, useRef } from "react";
import { useEditorStore } from "../store";
import { snapTime } from "../utils/time";

const MIN_DURATION = 0.05;

// Drag the left or right edge of a timeline bar to change its bounds.
// "left" pins the end; "right" pins the start. Both snap to beats when
// enabled (shift inverts), and clamp to composition bounds + MIN_DURATION.
export const useElementResize = (elementId: string, pxPerSec: number, edge: "left" | "right") => {
  const dragStart = useRef<{
    x: number;
    origStart: number;
    origDuration: number;
  } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const state = useEditorStore.getState();
      const el = state.elements.find((x) => x.id === elementId);
      if (!el) return;
      dragStart.current = {
        x: e.clientX,
        origStart: el.startSec,
        origDuration: el.durationSec,
      };

      const onMove = (ev: MouseEvent) => {
        if (!dragStart.current) return;
        const s = useEditorStore.getState();
        const compDur = s.compositionDuration;
        const dx = ev.clientX - dragStart.current.x;
        const dSec = dx / pxPerSec;

        if (edge === "left") {
          const origEnd = dragStart.current.origStart + dragStart.current.origDuration;
          let newStart = dragStart.current.origStart + dSec;
          newStart = Math.max(0, Math.min(origEnd - MIN_DURATION, newStart));
          newStart = snapTime(newStart, s.snapMode, s.beatData, ev.shiftKey);
          newStart = Math.max(0, Math.min(origEnd - MIN_DURATION, newStart));
          s.updateElement(elementId, {
            startSec: newStart,
            durationSec: origEnd - newStart,
          });
        } else {
          let newEnd = dragStart.current.origStart + dragStart.current.origDuration + dSec;
          newEnd = Math.max(dragStart.current.origStart + MIN_DURATION, Math.min(compDur, newEnd));
          newEnd = snapTime(newEnd, s.snapMode, s.beatData, ev.shiftKey);
          newEnd = Math.max(dragStart.current.origStart + MIN_DURATION, Math.min(compDur, newEnd));
          s.updateElement(elementId, {
            durationSec: newEnd - dragStart.current.origStart,
          });
        }
      };
      const onUp = () => {
        dragStart.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [elementId, pxPerSec, edge],
  );

  return { onMouseDown };
};
