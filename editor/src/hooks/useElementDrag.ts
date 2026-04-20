// src/hooks/useElementDrag.ts
import { useCallback, useRef } from "react";
import { useEditorStore } from "../store";
import { snapTime } from "../utils/time";

export const useElementDrag = (elementId: string, pxPerSec: number) => {
  const dragStart = useRef<{ x: number; origStart: number } | null>(null);
  const { updateElement, compositionDuration } = useEditorStore();

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
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
        // Pipeline-origin elements always beat-snap on drag so they stay
        // musically precise even when the global snapMode is "off". Holding
        // Shift during the drag inverts this (lets you free-drag a pipeline
        // element temporarily without unlocking the global setting).
        const isPipeline = currentEl.origin === "pipeline";
        const effectiveSnapMode = isPipeline && !ev.shiftKey ? "beat" : state2.snapMode;
        // Shift inverts current snap behavior for this single drag: off+shift →
        // beat snap, any mode+shift → no snap. snapTime() handles the mode table.
        const snapped = snapTime(boundedStart, effectiveSnapMode, state2.beatData, ev.shiftKey);
        updateElement(elementId, { startSec: snapped });
      };
      const onUp = () => {
        dragStart.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        // If this was a pipeline element, persist the new time back to
        // analysis.json. Without this, SSE's next tick restores the event
        // at its authoritative original timestamp and the drag appears
        // to revert.
        const post = useEditorStore.getState();
        const el = post.elements.find((x) => x.id === elementId);
        if (!el || el.origin !== "pipeline") return;
        const m = /^pipeline-(.+)-(\d+(?:\.\d+)?)$/.exec(el.id);
        if (!m) return;
        const stem = m[1];
        const origSec = Number(m[2]);
        // Pipeline elements are 2-s windows centered on the event.
        const newSec = el.startSec + el.durationSec / 2;
        if (!Number.isFinite(newSec) || Math.abs(newSec - origSec) < 0.05) return;
        const beat = post.beatData;
        const currentEvents =
          (beat?.phase2_events_sec?.length ? beat.phase2_events_sec : beat?.phase1_events_sec) ??
          [];
        const nextEvents = currentEvents.filter((t) => Math.abs(t - origSec) > 0.05).concat(newSec);
        void fetch("/api/analyze/events/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stem, events: nextEvents }),
        }).catch(() => {
          /* SSE won't refresh; local store edit still stands */
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [elementId, pxPerSec, updateElement, compositionDuration],
  );

  return { onMouseDown };
};
