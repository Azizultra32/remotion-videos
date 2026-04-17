// src/hooks/useKeyboardShortcuts.ts
// Editor-wide keybindings. Attached once at App mount.
//
//   space           play/pause
//   ← / →           step 1 second
//   shift + ← / →   step 5 seconds
//   ,  / .          step 1 frame
//   home            rewind to 0
//   end             seek to last second
import { useEffect } from "react";
import { useEditorStore } from "../store";

const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
};

export const useKeyboardShortcuts = () => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const s = useEditorStore.getState();
      const step = e.shiftKey ? 5 : 1;
      const frameStep = 1 / s.fps;

      switch (e.key) {
        case " ":
          e.preventDefault();
          s.setPlaying(!s.isPlaying);
          return;
        case "ArrowRight":
          e.preventDefault();
          s.setCurrentTime(Math.min(s.compositionDuration, s.currentTimeSec + step));
          return;
        case "ArrowLeft":
          e.preventDefault();
          s.setCurrentTime(Math.max(0, s.currentTimeSec - step));
          return;
        case ".":
          e.preventDefault();
          s.setCurrentTime(Math.min(s.compositionDuration, s.currentTimeSec + frameStep));
          return;
        case ",":
          e.preventDefault();
          s.setCurrentTime(Math.max(0, s.currentTimeSec - frameStep));
          return;
        case "Home":
          e.preventDefault();
          s.setCurrentTime(0);
          return;
        case "End":
          e.preventDefault();
          s.setCurrentTime(Math.max(0, s.compositionDuration - 1));
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
};
