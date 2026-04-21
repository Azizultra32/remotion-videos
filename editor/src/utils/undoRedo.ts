// editor/src/utils/undoRedo.ts
//
// Undo/redo stacks for the timeline elements array, exposed as module-
// level functions so BOTH the keyboard handler (useUndoHistory) and
// visible UI buttons (TransportControls) drive the same underlying
// state. Previously the stacks lived inside useUndoHistory's useRef,
// reachable only via kbd events — no button could fire them.
//
// Subscription + kbd listeners still live in useUndoHistory; that hook
// calls `recordChange` on each real mutation and `clearHistory` on
// project switch. Buttons call `undo()` / `redo()` directly.

import { useEditorStore } from "../store";
import type { TimelineElement } from "../types";

const MAX_HISTORY = 50;

const undoStack: TimelineElement[][] = [];
const redoStack: TimelineElement[][] = [];
let applying = false;

// Listener fanout so React components can re-render their disabled
// state when the stacks change. Buttons subscribe via useUndoRedoState
// (below). No Zustand — we want this independent of the element-store
// subscription cycle to avoid re-entry when undo sets state.
const listeners = new Set<() => void>();
const notify = () => { for (const fn of listeners) fn(); };

export const isApplyingUndoRedo = (): boolean => applying;

export const recordChange = (prev: TimelineElement[]): void => {
  if (applying) return;
  undoStack.push(prev);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  notify();
};

export const clearHistory = (): void => {
  undoStack.length = 0;
  redoStack.length = 0;
  notify();
};

export const undo = (): boolean => {
  const prev = undoStack.pop();
  if (!prev) return false;
  redoStack.push(useEditorStore.getState().elements);
  if (redoStack.length > MAX_HISTORY) redoStack.shift();
  applying = true;
  try {
    useEditorStore.setState({ elements: prev });
  } finally {
    applying = false;
    notify();
  }
  return true;
};

export const redo = (): boolean => {
  const next = redoStack.pop();
  if (!next) return false;
  undoStack.push(useEditorStore.getState().elements);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  applying = true;
  try {
    useEditorStore.setState({ elements: next });
  } finally {
    applying = false;
    notify();
  }
  return true;
};

export const canUndo = (): boolean => undoStack.length > 0;
export const canRedo = (): boolean => redoStack.length > 0;

// React hook for components that want to reactively reflect stack state
// (e.g. to disable buttons when there's nothing to undo). No store, just
// a listener fanout + forced re-render on push/pop.
import { useEffect, useState } from "react";
export const useUndoRedoState = (): { canUndo: boolean; canRedo: boolean } => {
  const [, tick] = useState(0);
  useEffect(() => {
    const cb = () => tick((n) => n + 1);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);
  return { canUndo: canUndo(), canRedo: canRedo() };
};
