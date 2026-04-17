# Plan: Natural-Language Chat Layer for the Editor

**Date:** 2026-04-17
**Author:** opus47-concierge (parallel to e34ebdb4's audio fixes)
**Scope:** Wire the Vite sidecar → editor chat UI → store mutations. Allow the user to type "add a glitch text saying DROP at 0:45 for 2s" and see it appear on the timeline.
**Status of prerequisite work:** Backend mostly built. Needs client + wiring.

---

## 0. What's already built (don't re-do)

- **`editor/vite-plugin-sidecar.ts`** (262 lines, committed via the other terminal)
  - `POST /api/render` — SSE stream, spawns `npx remotion render`, emits `log` / `progress` / `done` events
  - `POST /api/chat` — spawns `claude -p --output-format json` with a full system prompt
  - The system prompt (`CHAT_SYSTEM` constant) already documents:
    - All 16 element types and their main props
    - Mutation shapes: `addElement`, `updateElement`, `removeElement`, `seekTo`, `setPlaying`
    - Trackindex conventions (0–3 text, 4 shapes, 5–6 overlays, 7 mask, 8 video)
    - Rules (JSON only, random ids, seconds not frames)
  - Uses Max plan via local `claude` CLI — **no API key, no per-token billing**

## 1. What's NOT yet built

1. Sidecar plugin is **not registered** in `editor/vite.config.ts` (only `react()` is in `plugins`)
2. No client-side `ChatPane` component in the editor UI
3. No fetch wrapper that calls `/api/chat` and parses the JSON response
4. No mutation dispatcher that takes `mutations[]` and applies them to the zustand store
5. Chat response is **not streamed** — backend currently buffers stdout and returns on CLI close (~2-10s latency). This is acceptable for v1 but worth noting.
6. No conversation history — each request is one-shot. Multi-turn comes later.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Vite dev server :4002)                                │
│                                                                 │
│  ┌──────────────┐   user types   ┌─────────────────────────┐    │
│  │  ChatPane    │ ─────────────► │  useChat hook           │    │
│  │  (React UI)  │                │  POST /api/chat         │    │
│  └──────┬───────┘                │  { message, state }     │    │
│         │                         └──────────┬──────────────┘   │
│         │                                    │                  │
│         │                                    ▼                  │
│         │                         ┌─────────────────────────┐   │
│         │ zustand mutations       │  applyMutations()       │   │
│         │◄────────────────────────│  store.addElement(...)  │   │
│         │                         │  store.updateElement(..)│   │
│         ▼                         │  store.seekTo(...)      │   │
│  ┌──────────────┐                 └─────────────────────────┘   │
│  │  Timeline    │                                               │
│  │  Preview     │  ← rerender on store change (automatic)       │
│  │  Scrubber    │                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
                           │
                           │  HTTP
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Vite dev server (same process, plugin middleware)              │
│                                                                 │
│  /api/chat → spawn claude -p ... → JSON → mutations[]           │
│  /api/render → spawn npx remotion render ... → SSE              │
└─────────────────────────────────────────────────────────────────┘
                           │
                           │  shells out to
                           ▼
               claude CLI (Max plan, $0)
               npx remotion render (local CPU)
```

---

## 3. Tasks (in order)

### Task 1 — Wire the sidecar plugin into Vite (5 min)

**File:** `editor/vite.config.ts`

- [ ] **Step 1:** Import the plugin
  ```typescript
  import { sidecarPlugin } from "./vite-plugin-sidecar";
  ```

- [ ] **Step 2:** Add to `plugins` array
  ```typescript
  plugins: [react(), sidecarPlugin()]
  ```

- [ ] **Step 3:** Verify sidecar exports a function named `sidecarPlugin`. If it only exports a default or a differently-named export, adjust the import.

- [ ] **Step 4:** Restart `npm run dev`. Check browser devtools: `fetch("/api/chat", {method:"POST", body: JSON.stringify({message:"test", state:{}})})` should not 404.

### Task 2 — Client-side `useChat` hook (20 min)

**File:** `editor/src/hooks/useChat.ts` (new)

- [ ] **Step 1:** Write the hook:
  ```typescript
  import { useState } from "react";
  import { useEditorStore } from "../store";
  import { applyMutations } from "../utils/applyMutations";

  export type ChatMessage = {
    role: "user" | "assistant" | "error";
    text: string;
    mutations?: unknown[];
    timestamp: number;
  };

  export const useChat = () => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [sending, setSending] = useState(false);

    const send = async (message: string) => {
      if (!message.trim() || sending) return;
      setSending(true);
      setMessages((m) => [...m, { role: "user", text: message, timestamp: Date.now() }]);

      // Snapshot the store so Claude can see current project state.
      const state = useEditorStore.getState();
      const snapshot = {
        currentTimeSec: state.currentTimeSec,
        compositionDuration: state.compositionDuration,
        fps: state.fps,
        audioSrc: state.audioSrc,
        beatsSrc: state.beatsSrc,
        elements: state.elements,
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, state: snapshot }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const reply = typeof data.reply === "string" ? data.reply : "(no reply)";
        const mutations = Array.isArray(data.mutations) ? data.mutations : [];
        applyMutations(mutations);

        setMessages((m) => [
          ...m,
          { role: "assistant", text: reply, mutations, timestamp: Date.now() },
        ]);
      } catch (err: any) {
        setMessages((m) => [
          ...m,
          { role: "error", text: String(err?.message ?? err), timestamp: Date.now() },
        ]);
      } finally {
        setSending(false);
      }
    };

    return { messages, sending, send };
  };
  ```

### Task 3 — Mutation dispatcher (25 min)

**File:** `editor/src/utils/applyMutations.ts` (new)

- [ ] **Step 1:** Validate and apply one mutation at a time:
  ```typescript
  import { useEditorStore } from "../store";
  import type { TimelineElement } from "../types";

  type AddElement = { op: "addElement"; element: TimelineElement };
  type UpdateElement = { op: "updateElement"; id: string; patch: Partial<TimelineElement> };
  type RemoveElement = { op: "removeElement"; id: string };
  type SeekTo = { op: "seekTo"; sec: number };
  type SetPlaying = { op: "setPlaying"; playing: boolean };
  type Mutation = AddElement | UpdateElement | RemoveElement | SeekTo | SetPlaying;

  const isMutation = (m: unknown): m is Mutation => {
    if (!m || typeof m !== "object") return false;
    const op = (m as any).op;
    return ["addElement", "updateElement", "removeElement", "seekTo", "setPlaying"].includes(op);
  };

  export const applyMutations = (muts: unknown[]): void => {
    const s = useEditorStore.getState();
    for (const raw of muts) {
      if (!isMutation(raw)) {
        console.warn("[chat] skipping invalid mutation", raw);
        continue;
      }
      switch (raw.op) {
        case "addElement":
          s.addElement(raw.element);
          break;
        case "updateElement":
          s.updateElement(raw.id, raw.patch);
          break;
        case "removeElement":
          s.removeElement(raw.id);
          break;
        case "seekTo":
          s.setCurrentTime(raw.sec);
          break;
        case "setPlaying":
          s.setPlaying(raw.playing);
          break;
      }
    }
  };
  ```

- [ ] **Step 2:** Add defensive normalization — ids that collide get a suffix, props get shallow-merged for updateElement.

### Task 4 — `ChatPane` UI component (30 min)

**File:** `editor/src/components/ChatPane.tsx` (new)

- [ ] **Step 1:** Minimal UI — message list + input + send button.
- [ ] **Step 2:** Show role icons (user / assistant / error), timestamp, and a collapsible "mutations applied" affordance per assistant turn.
- [ ] **Step 3:** Enter submits, Shift-Enter inserts newline, Esc cancels (stops listening — doesn't kill in-flight request).
- [ ] **Step 4:** Show a "thinking…" indicator while `sending` is true.
- [ ] **Step 5:** Preserve last N messages in `sessionStorage` so a page reload keeps the chat (not localStorage — conversation is ephemeral).

### Task 5 — Mount `ChatPane` in `App.tsx` (5 min)

**File:** `editor/src/App.tsx`

**⚠️ Coordination note:** `App.tsx` is claimed by `e34ebdb4`. Either wait for them to release, or send a message via `scripts/agents.py message opus47-concierge e34ebdb4 '<text>'` asking for a 5-minute window.

- [ ] **Step 1:** Import `ChatPane`.
- [ ] **Step 2:** Add a fourth grid column (or a collapsible right-side drawer) for the chat pane. Recommend: toggleable panel so it doesn't always eat screen real estate.
- [ ] **Step 3:** Persist the open/closed state of the panel in `editor/src/store.ts`'s persist partialize.

### Task 6 — Guardrails + polish (20 min)

- [ ] **Step 1:** Cancel in-flight request when user types `/cancel` or hits Esc twice.
- [ ] **Step 2:** Rate-limit UI — if Max plan returns 429, show a "cooling off ~1 min" banner.
- [ ] **Step 3:** Confirm destructive mutations — `removeElement` needs a one-click undo. The store should support an "undo last chat turn" action that reverses the last batch of mutations.
- [ ] **Step 4:** Token economy — strip the `beatData.beats` array (14,706 items) from the state snapshot before sending. Claude needs `drops`, `breakdowns`, `downbeats`, not every beat. **This alone cuts each prompt by ~80%.**

---

## 4. What to test at each checkpoint

**After Task 1:** `curl -X POST http://localhost:4002/api/chat -H 'Content-Type: application/json' -d '{"message":"hello","state":{"elements":[]}}'` returns JSON with `{reply: "...", mutations: []}`.

**After Task 3:** In devtools console: `import("/@fs/.../applyMutations").then(m => m.applyMutations([{op:"seekTo", sec: 30}]))` — scrubber should jump to 0:30.

**After Task 4 + 5:** Type "add a glitch text saying TEST at 5 seconds for 2 seconds" → element appears on timeline at 0:05, lasts 2s.

**After Task 6:** Spam 10 rapid requests → UI doesn't crash, doesn't lose focus, eventually rate-limits gracefully.

---

## 5. What this plan does NOT cover (explicitly)

- **Multi-turn conversation.** v1 is one-shot per request. Follow-up context is not preserved server-side. User can re-state. Later: pass conversation history back to the sidecar.
- **Streaming responses.** Backend buffers `claude` output then returns. Latency ~2-10s. If this feels slow, upgrade to SSE-streamed tokens in v2.
- **Semantic mutation validation.** Claude could emit `trackIndex: 99` and we'd blindly set it. Task 3 does schema validation on op names only. Deep validation (zod-parse each element through its module schema) is a v2 polish.
- **Tool-call style (native Anthropic tool_use blocks).** We're using the JSON-response convention because `claude -p` in the CLI doesn't expose tool_use. If we ever move to SDK + API key, switch to native tool use.
- **Conversation undo beyond "undo last turn".** Full history scrubbing = separate feature.

---

## 6. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `claude` CLI not on PATH in the Vite server process | Medium | Sidecar already hardcodes `cwd: REPO_ROOT` and uses `spawn("claude", ...)` with default PATH. Verify on startup; show a friendly error if `which claude` fails. |
| Max plan rate limits (429 from `claude` CLI) | High during dev testing | Task 6 Step 2 — banner + cooldown |
| Claude emits invalid JSON | Medium | `applyMutations` skips invalid ops with `console.warn`; chat shows raw reply in the error role |
| Claude hallucinates element types not in registry | Medium | `applyMutations` should reject unknown `element.type` by looking it up in `ELEMENT_REGISTRY` before adding |
| Beat data bloats every prompt | Certain | Task 6 Step 4 — strip `beats[]` before sending; keep drops/breakdowns/downbeats only |
| `e34ebdb4` editing App.tsx when we try to add ChatPane | Likely | Coordinate via `scripts/agents.py message` before Task 5 |

---

## 7. Out of scope for this plan (but worth a follow-up)

- **Render button in the editor UI.** `/api/render` exists in the sidecar already. Needs a RenderPane similar to ChatPane. Separate ~30-min task.
- **Project.json export/import polish.** Already started by `e34ebdb4` (`projectJson.ts`, `ProjectActions.tsx`). Not related to chat.
- **"Generate from template"** workflow — where Claude writes a whole project.json from a high-level prompt. That's a bigger feature: requires giving Claude a template library + render-time constraint awareness.

---

## 8. Estimated effort

| Task | Time |
|---|---|
| 1. Wire sidecar | 5 min |
| 2. `useChat` hook | 20 min |
| 3. `applyMutations` | 25 min |
| 4. `ChatPane` UI | 30 min |
| 5. Mount in App.tsx | 5 min |
| 6. Guardrails | 20 min |
| **Total** | **~1h 45min** |

Plus ~15 min QA / iteration. Call it 2 hours end-to-end.

---

## 9. Open questions for user

1. **Chat pane location** — toggleable right drawer, separate tab, or floating window?
2. **Keyboard shortcut** — should `Cmd+K` or `/` open the chat?
3. **Undo semantics** — should every chat turn be undoable as a single batch, or elementwise?
4. **Beat data stripping aggressiveness** — send only drops/breakdowns (smallest), or include a sampled subset of beats (e.g. every 10th) so Claude can still locate a specific beat by index?

---

## 10. Recommended execution order

Do this plan **AFTER** the other terminal finishes the audio/SchemaEditor fixes:

1. `e34ebdb4` finishes: swap track, bump persist version, fix SchemaEditor
2. `opus47-concierge` picks up: this plan, Tasks 1-6 in order
3. Ship as one commit: "feat(editor): natural-language chat → store mutations via Max-plan sidecar"

Alternative: I could start on Tasks 1-3 (pure new files, no conflicts with e34ebdb4's claims) in parallel, and join at Task 5 when they release `App.tsx`.
