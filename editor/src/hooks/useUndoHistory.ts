// src/hooks/useUndoHistory.ts
//
// Cmd-Z / Cmd-Shift-Z (Ctrl-Z / Ctrl-Shift-Z on non-Mac) undo/redo for
// timeline element mutations. Separate from the chat-turn undo already
// shipped in useChat.ts — that one rolls back an entire LLM turn as a
// single unit; this one is element-level, for any mutation regardless
// of entry point (drag, chat, CLI).
//
// Mechanics:
//   - Subscribe to store.elements changes; before applying, capture the
//     previous state onto the undo stack.
//   - On Cmd-Z, pop the top of undo, push current state onto redo,
//     apply the popped snapshot.
//   - On Cmd-Shift-Z, pop redo, push current onto undo, apply.
//   - Any non-undo forward mutation clears redo (standard undo model).
//   - On project switch (audioSrc change), clear both stacks — the old
//     project's history isn't meaningful after hydrate from disk.
//
// Capped at 50 entries per stack; older entries drop off.

import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import type { TimelineElement } from "../types";
import { stemFromAudioSrc } from "../utils/url";

const MAX_HISTORY = 50;

const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
};

export const useUndoHistory = () => {
  // Two stacks of element-array snapshots. Each entry is a full snapshot of
  // store.elements at a moment in time. References are shared with the
  // store so memory footprint is small unless elements change structurally.
  const undoStackRef = useRef<TimelineElement[][]>([]);
  const redoStackRef = useRef<TimelineElement[][]>([]);
  // True while we're applying an undo/redo — skip recording so we don't
  // treat the restore itself as a new forward action.
  const applyingRef = useRef(false);
  const currentStemRef = useRef<string | null>(null);

  useEffect(() => {
    // Record: on every elements change that isn't caused by our own undo/redo,
    // push the PREVIOUS elements onto the undo stack. Clear redo.
    const unsubRecord = useEditorStore.subscribe((state, prev) => {
      if (applyingRef.current) return;
      if (state.elements === prev.elements) return;
      // Skip ref-different-but-content-equal setState calls. These come from
      // useTimelineSync.hydrate() echoing our own autosave back to the store
      // (POST save -> fs.watch -> SSE change -> GET load -> setState with a
      // fresh-from-JSON.parse array). Treating them as user actions causes a
      // dupe push + redoStack wipe, which breaks Cmd-Z: 1 of every N presses
      // is a no-op and redo is lost. Verified via browser verification on
      // 2026-04-18.
      if (JSON.stringify(state.elements) === JSON.stringify(prev.elements)) return;
      undoStackRef.current.push(prev.elements);
      if (undoStackRef.current.length > MAX_HISTORY) {
        undoStackRef.current.shift();
      }
      redoStackRef.current = [];
    });

    // Reset stacks on project switch.
    const unsubProjectSwitch = useEditorStore.subscribe((state, prev) => {
      const nextStem = stemFromAudioSrc(state.audioSrc);
      const prevStem = stemFromAudioSrc(prev.audioSrc);
      if (nextStem !== prevStem) {
        currentStemRef.current = nextStem;
        undoStackRef.current = [];
        redoStackRef.current = [];
      }
    });

    currentStemRef.current = stemFromAudioSrc(
      useEditorStore.getState().audioSrc,
    );

    return () => {
      unsubRecord();
      unsubProjectSwitch();
    };
  }, []);

  useEffect(() => {
    const applyUndo = () => {
      const prev = undoStackRef.current.pop();
      if (!prev) return;
      redoStackRef.current.push(useEditorStore.getState().elements);
      if (redoStackRef.current.length > MAX_HISTORY) {
        redoStackRef.current.shift();
      }
      applyingRef.current = true;
      try {
        useEditorStore.setState({ elements: prev });
      } finally {
        applyingRef.current = false;
      }
    };

    const applyRedo = () => {
      const next = redoStackRef.current.pop();
      if (!next) return;
      undoStackRef.current.push(useEditorStore.getState().elements);
      if (undoStackRef.current.length > MAX_HISTORY) {
        undoStackRef.current.shift();
      }
      applyingRef.current = true;
      try {
        useEditorStore.setState({ elements: next });
      } finally {
        applyingRef.current = false;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        applyUndo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        applyRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
};
