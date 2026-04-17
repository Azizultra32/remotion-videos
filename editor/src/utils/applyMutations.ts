import type { TimelineElement } from "../types";
import { useEditorStore } from "../store";

// Mutations the chat layer emits. These mirror the 5 store actions the sidecar
// CHAT_SYSTEM prompt documents. Everything is validated defensively because
// the LLM can (and will) return malformed entries.
export type ChatMutation =
  | { op: "addElement"; element: TimelineElement }
  | {
      op: "updateElement";
      id: string;
      patch: Partial<Omit<TimelineElement, "id" | "type">> & {
        props?: Record<string, unknown>;
      };
    }
  | { op: "removeElement"; id: string }
  | { op: "seekTo"; sec: number }
  | { op: "setPlaying"; playing: boolean };

export type MutationResult = {
  applied: number;
  skipped: number;
  errors: string[];
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const validateElement = (raw: unknown): TimelineElement | null => {
  if (!isObject(raw)) return null;
  const {
    id,
    type,
    trackIndex,
    startSec,
    durationSec,
    label,
    props,
  } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !id) return null;
  if (typeof type !== "string" || !type) return null;
  if (typeof trackIndex !== "number") return null;
  if (typeof startSec !== "number") return null;
  if (typeof durationSec !== "number" || durationSec <= 0) return null;
  return {
    id,
    type,
    trackIndex,
    startSec,
    durationSec,
    label: typeof label === "string" ? label : type,
    props: isObject(props) ? props : {},
  };
};

// Applies a list of mutations to the store. Unknown ops / malformed entries
// are skipped with a recorded error; valid ops go through even if earlier
// entries were bad.
export const applyMutations = (mutations: unknown): MutationResult => {
  const result: MutationResult = { applied: 0, skipped: 0, errors: [] };
  if (!Array.isArray(mutations)) {
    result.errors.push("mutations is not an array");
    return result;
  }

  const s = useEditorStore.getState();

  for (let i = 0; i < mutations.length; i++) {
    const m = mutations[i];
    if (!isObject(m) || typeof m.op !== "string") {
      result.skipped++;
      result.errors.push(`[${i}] not an object or missing op`);
      continue;
    }
    try {
      switch (m.op) {
        case "addElement": {
          const el = validateElement(m.element);
          if (!el) {
            result.skipped++;
            result.errors.push(`[${i}] addElement: invalid element`);
            break;
          }
          // De-dupe by id — if an id collides, swap to update semantics.
          const existing = useEditorStore.getState().elements.find((x) => x.id === el.id);
          if (existing) {
            s.updateElement(el.id, el);
          } else {
            s.addElement(el);
          }
          result.applied++;
          break;
        }
        case "updateElement": {
          if (typeof m.id !== "string" || !isObject(m.patch)) {
            result.skipped++;
            result.errors.push(`[${i}] updateElement: missing id or patch`);
            break;
          }
          const current = useEditorStore.getState().elements.find((x) => x.id === m.id);
          if (!current) {
            result.skipped++;
            result.errors.push(`[${i}] updateElement: no element ${m.id}`);
            break;
          }
          const patch = m.patch as Record<string, unknown>;
          const merged: Partial<TimelineElement> = {};
          if (typeof patch.startSec === "number") merged.startSec = patch.startSec;
          if (typeof patch.durationSec === "number" && patch.durationSec > 0)
            merged.durationSec = patch.durationSec;
          if (typeof patch.trackIndex === "number") merged.trackIndex = patch.trackIndex;
          if (typeof patch.label === "string") merged.label = patch.label;
          if (isObject(patch.props))
            merged.props = { ...current.props, ...patch.props };
          s.updateElement(m.id, merged);
          result.applied++;
          break;
        }
        case "removeElement": {
          if (typeof m.id !== "string") {
            result.skipped++;
            result.errors.push(`[${i}] removeElement: missing id`);
            break;
          }
          s.removeElement(m.id);
          result.applied++;
          break;
        }
        case "seekTo": {
          if (typeof m.sec !== "number") {
            result.skipped++;
            result.errors.push(`[${i}] seekTo: sec must be a number`);
            break;
          }
          s.setCurrentTime(Math.max(0, m.sec));
          result.applied++;
          break;
        }
        case "setPlaying": {
          if (typeof m.playing !== "boolean") {
            result.skipped++;
            result.errors.push(`[${i}] setPlaying: playing must be boolean`);
            break;
          }
          s.setPlaying(m.playing);
          result.applied++;
          break;
        }
        default: {
          result.skipped++;
          result.errors.push(`[${i}] unknown op: ${String(m.op)}`);
        }
      }
    } catch (err) {
      result.skipped++;
      result.errors.push(`[${i}] threw: ${(err as Error).message}`);
    }
  }

  return result;
};
