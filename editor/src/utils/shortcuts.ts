// Context-aware keyboard shortcut dispatcher. Lifted in spirit from
// motion-canvas/packages/ui/src/contexts/shortcuts.tsx (MIT) — a context
// stack controls which bindings fire, so the same key can mean different
// things over the timeline vs. the viewport vs. the presenter.
//
// This file is pure TS: parser, matcher, dispatcher. The React glue that
// maintains the context stack lives in ../contexts/shortcuts.tsx.

export type ParsedKey = {
  key: string; // normalized KeyboardEvent.key (Space → " ", letters lowercase)
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
};

export type ShortcutBinding = {
  pattern: string;
  context: string;
  handler: () => void;
  // When true, the binding fires even if the keyboard event's target is an
  // INPUT/TEXTAREA/contenteditable element. Reserve for escape / cancel.
  alwaysAllow?: boolean;
};

// Normalize a key name to its KeyboardEvent.key representation.
const KEY_ALIASES: Record<string, string> = {
  space: " ",
  enter: "Enter",
  escape: "Escape",
  esc: "Escape",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};

const normalizeKey = (raw: string): string => {
  const low = raw.toLowerCase();
  if (low in KEY_ALIASES) return KEY_ALIASES[low];
  // Preserve case for letters (JS KeyboardEvent.key uses shifted form on
  // shift-letter, but we compare case-insensitively in matchesEvent so
  // normalizing to lowercase here is fine).
  return low;
};

export const parseKeyPattern = (pattern: string): ParsedKey => {
  if (!pattern || !pattern.trim()) {
    throw new Error("parseKeyPattern: empty pattern");
  }
  const parts = pattern.split("+").map((p) => p.trim());
  const keyRaw = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1).map((m) => m.toLowerCase());
  return {
    key: normalizeKey(keyRaw),
    shift: modifiers.includes("shift"),
    ctrl: modifiers.includes("ctrl") || modifiers.includes("control"),
    meta: modifiers.includes("meta") || modifiers.includes("cmd") || modifiers.includes("command"),
    alt: modifiers.includes("alt") || modifiers.includes("option"),
  };
};

export const matchesEvent = (e: KeyboardEvent, parsed: ParsedKey): boolean => {
  const evKey = e.key.toLowerCase();
  const patKey = parsed.key.toLowerCase();
  if (evKey !== patKey) return false;
  // Strict modifier match — unspecified modifiers must NOT be pressed.
  if (!!e.shiftKey !== parsed.shift) return false;
  if (!!e.ctrlKey !== parsed.ctrl) return false;
  if (!!e.metaKey !== parsed.meta) return false;
  if (!!e.altKey !== parsed.alt) return false;
  return true;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof target !== "object") return false;
  const t = target as { tagName?: string; isContentEditable?: boolean };
  if (t.isContentEditable) return true;
  const tag = t.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
};

// Dispatch a keyboard event against a set of bindings scoped by an active
// context stack. Stack order: element 0 is the least-specific (usually
// "global"), the last element is the most specific (e.g. "timeline" when
// the pointer is over the timeline). The most-specific matching binding
// wins.
//
// Returns true if a binding fired.
export const dispatchBindings = (
  e: KeyboardEvent,
  contextStack: string[],
  bindings: ShortcutBinding[],
): boolean => {
  const editable = isEditableTarget(e.target);
  // Walk from most- to least-specific.
  for (let i = contextStack.length - 1; i >= 0; i--) {
    const ctx = contextStack[i];
    for (const b of bindings) {
      if (b.context !== ctx) continue;
      if (editable && !b.alwaysAllow) continue;
      let parsed: ParsedKey;
      try {
        parsed = parseKeyPattern(b.pattern);
      } catch {
        continue;
      }
      if (matchesEvent(e, parsed)) {
        b.handler();
        return true;
      }
    }
  }
  return false;
};
