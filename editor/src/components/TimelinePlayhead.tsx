import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";

type Props = {
  pxPerSec: number;
  height: number;
};

export const TimelinePlayhead = ({ pxPerSec, height }: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const paint = (t: number) => {
      const el = ref.current;
      if (!el) return;
      el.style.transform = `translateX(${t * pxPerSec}px)`;
    };
    paint(useEditorStore.getState().currentTimeSec);
    return useEditorStore.subscribe((state, prev) => {
      if (state.currentTimeSec !== prev.currentTimeSec) paint(state.currentTimeSec);
    });
  }, [pxPerSec]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 2,
        height,
        background: "#fff",
        boxShadow: "0 0 4px rgba(255,255,255,0.7)",
        transform: "translateX(0)",
        pointerEvents: "none",
        zIndex: 4,
      }}
    />
  );
};
