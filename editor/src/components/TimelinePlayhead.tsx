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
      className="editor-playhead"
      style={{
        height,
        transform: "translateX(0)",
      }}
    />
  );
};
