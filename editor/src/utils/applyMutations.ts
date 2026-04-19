import type { TimelineElement } from "../types";
import { useEditorStore } from "../store";
import { ELEMENT_REGISTRY } from "@compositions/elements/registry";
import { stemFromAudioSrc } from "./url";

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
  | { op: "setPlaying"; playing: boolean }
  // Project-lifecycle ops. Fire the corresponding HTTP endpoint; progress
  // streams via the existing SSE channels (StageStrip consumes them). These
  // are intentionally NOT captured in UndoSnapshot — a mid-session scaffold
  // or analyze kickoff isn't something chat "undo" should try to unwind.
  | { op: "scaffold"; audioPath: string }
  | { op: "analyze"; stem?: string }
  | { op: "seedBeats"; stem?: string }
  | { op: "clearEvents"; stem?: string }
  | { op: "switchTrack"; stem: string };

// Snapshot taken BEFORE a batch of mutations is applied, sufficient to revert
// that batch via useChat's undoLastTurn. We capture:
//   - addedIds:    ids that did not exist before (revert = remove)
//   - priorById:   pre-mutation elements for ids that were updated/removed
//                  (revert = upsert the original back into elements[])
// seekTo / setPlaying are NOT undone — they're navigation, not content.
export type UndoSnapshot = {
  addedIds: string[];
  priorById: Record<string, TimelineElement>;
};

export type MutationResult = {
  applied: number;
  skipped: number;
  errors: string[];
  undo: UndoSnapshot;
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
//
// Gap A: an addElement whose `type` is not present in ELEMENT_REGISTRY is
// rejected with a useful error so the chat UI can surface "unknown element
// type 'RainbowBeam' — pick from: text.typingText, ..." rather than silently
// crashing at render time.
//
// Gap B: result.undo captures everything needed to revert this batch.
export const applyMutations = (mutations: unknown): MutationResult => {
  const result: MutationResult = {
    applied: 0,
    skipped: 0,
    errors: [],
    undo: { addedIds: [], priorById: {} },
  };
  if (!Array.isArray(mutations)) {
    result.errors.push("mutations is not an array");
    return result;
  }

  const s = useEditorStore.getState();

  // Record a pre-mutation snapshot of an element id we're about to touch.
  // First-write-wins: if the same id is touched twice in one batch, we want
  // the ORIGINAL state, not the intermediate.
  const rememberPrior = (id: string) => {
    if (id in result.undo.priorById) return;
    const existing = useEditorStore.getState().elements.find((x) => x.id === id);
    if (existing) {
      // Deep-enough clone: TimelineElement has a props bag of unknowns.
      result.undo.priorById[id] = {
        ...existing,
        props: { ...existing.props },
      };
    }
  };

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
          // Gap A — reject unknown element types. This is the LAST line of
          // defense before the renderer tries to look up the module.
          if (!(el.type in ELEMENT_REGISTRY)) {
            result.skipped++;
            const known = Object.keys(ELEMENT_REGISTRY).join(", ");
            result.errors.push(
              `[${i}] addElement: unknown element type "${el.type}". Known types: ${known}`,
            );
            break;
          }
          // De-dupe by id — if an id collides, swap to update semantics.
          const existing = useEditorStore.getState().elements.find((x) => x.id === el.id);
          if (existing) {
            rememberPrior(el.id);
            s.updateElement(el.id, el);
          } else {
            s.addElement(el);
            result.undo.addedIds.push(el.id);
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
          rememberPrior(m.id);
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
          rememberPrior(m.id);
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
        case "scaffold": {
          const audioPath = typeof m.audioPath === "string" ? m.audioPath : "";
          if (!audioPath) {
            result.skipped++;
            result.errors.push(`[${i}] scaffold: audioPath (string, absolute) required`);
            break;
          }
          // Fire and forget — the new project's .analyze-status.json will
          // start showing phase progress via SSE within 1-2 seconds.
          void fetch("/api/projects/create-from-path", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioPath }),
          }).then(async (r) => {
            if (!r.ok) return; // error surfaces via /api/analyze/status if it fires
            try {
              const { stem } = (await r.json()) as { stem?: string };
              // Auto-switch so the user immediately sees the new project in
              // the editor and StageStrip tracks its analysis live.
              if (stem) {
                useEditorStore.getState().setTrack(
                  `projects/${stem}/audio.mp3`,
                  `projects/${stem}/analysis.json`,
                );
              }
            } catch { /* ignore */ }
          }).catch(() => { /* silent */ });
          result.applied++;
          break;
        }
        case "analyze": {
          const stem =
            typeof m.stem === "string" && m.stem
              ? m.stem
              : stemFromAudioSrc(useEditorStore.getState().audioSrc);
          if (!stem) {
            result.skipped++;
            result.errors.push(`[${i}] analyze: no stem resolved (pass stem or switch track first)`);
            break;
          }
          void fetch("/api/analyze/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stem }),
          }).catch(() => { /* silent; StageStrip surfaces errors via status SSE */ });
          result.applied++;
          break;
        }
        case "seedBeats": {
          const stem =
            typeof m.stem === "string" && m.stem
              ? m.stem
              : stemFromAudioSrc(useEditorStore.getState().audioSrc);
          if (!stem) {
            result.skipped++;
            result.errors.push(`[${i}] seedBeats: no stem resolved`);
            break;
          }
          void fetch("/api/analyze/seed-beats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stem }),
          }).catch(() => {});
          result.applied++;
          break;
        }
        case "clearEvents": {
          const stem =
            typeof m.stem === "string" && m.stem
              ? m.stem
              : stemFromAudioSrc(useEditorStore.getState().audioSrc);
          if (!stem) {
            result.skipped++;
            result.errors.push(`[${i}] clearEvents: no stem resolved`);
            break;
          }
          void fetch("/api/analyze/clear", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stem }),
          }).catch(() => {});
          result.applied++;
          break;
        }
        case "switchTrack": {
          const stem = typeof m.stem === "string" ? m.stem : "";
          if (!stem) {
            result.skipped++;
            result.errors.push(`[${i}] switchTrack: stem required`);
            break;
          }
          // Imperfect: we don't know the exact audio extension without
          // consulting /api/songs. Default to .mp3 — mv:scaffold normalizes
          // mp3/m4a inputs to .mp3 container names, so this is right for
          // everything except .wav projects.
          s.setTrack(`projects/${stem}/audio.mp3`, `projects/${stem}/analysis.json`);
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

// Reverts a batch of mutations using the snapshot captured by applyMutations.
// Order matters: remove the things we added first (in case an update later
// collides), then re-insert/restore the things we updated or removed.
export const revertMutations = (undo: UndoSnapshot): void => {
  const s = useEditorStore.getState();

  // Step 1: remove anything we added fresh.
  for (const id of undo.addedIds) {
    s.removeElement(id);
  }

  // Step 2: for each prior snapshot, either restore-in-place (still exists)
  // or re-add (was removed). addedIds were already handled above and won't
  // appear in priorById because rememberPrior is only called before update/
  // remove.
  for (const id of Object.keys(undo.priorById)) {
    const prior = undo.priorById[id];
    const exists = useEditorStore.getState().elements.some((x) => x.id === id);
    if (exists) {
      s.updateElement(id, prior);
    } else {
      s.addElement(prior);
    }
  }
};

export const hasUndo = (undo: UndoSnapshot): boolean =>
  undo.addedIds.length > 0 || Object.keys(undo.priorById).length > 0;
