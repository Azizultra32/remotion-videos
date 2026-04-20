// editor/src/hooks/useAutoSeedBeats.ts
//
// Auto-fires POST /api/analyze/seed-beats when a project is loaded with
// no beats in analysis.json, so snap-to-beat starts working without a
// click. Debounced 2.5s after load so useBeatData + useTimelineSync get
// a chance to populate beats first (avoids seeding when beats ARE already
// on disk, just haven't hydrated into the store yet).
//
// Guards to prevent runaways:
//   - Per-stem latch (attemptedStem) — one auto-seed per stem per session.
//     If it fails, user can click the Seed beats button explicitly.
//   - Status probe — skip if mv:analyze is already running for this stem
//     (its Setup step seeds beats on its own; double-seeding races).
//
// Track-agnostic by construction: reads whatever stem is in the store,
// only fires when that stem has no beats.

import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import { stemFromAudioSrc } from "../utils/url";

export const useAutoSeedBeats = () => {
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const beatsLen = useEditorStore((s) => s.beatData?.beats?.length ?? 0);
  const attemptedStem = useRef<string | null>(null);

  useEffect(() => {
    const stem = stemFromAudioSrc(audioSrc);
    if (!stem) return;
    if (beatsLen > 0) return;
    if (attemptedStem.current === stem) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      // Re-check — the store may have hydrated during the debounce.
      const fresh = useEditorStore.getState();
      const freshStem = stemFromAudioSrc(fresh.audioSrc);
      if (freshStem !== stem) return; // user switched tracks mid-debounce
      if ((fresh.beatData?.beats?.length ?? 0) > 0) return; // beats arrived
      // Status probe — don't double up on mv:analyze's own Setup seeding.
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(stem)}/.analyze-status.json`);
        if (r.ok) {
          const st = (await r.json()) as { startedAt?: number; endedAt?: number | null } | null;
          if (st?.startedAt && !st.endedAt) return; // run in flight
        }
      } catch {
        // no status file / parse error — proceed; seed-beats is harmless
      }
      if (cancelled) return;
      attemptedStem.current = stem;
      try {
        await fetch("/api/analyze/seed-beats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stem }),
        });
        // Success → SSE /api/analyze/events will push the new beats when
        // detect-beats.py finishes (~45s). useTimelineSync threads them
        // into the store; the NO BEAT GRID chip auto-hides.
      } catch {
        // Silent — user can click Seed beats in StageStrip if they want
        // to retry. We don't reset attemptedStem so we don't spam.
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [audioSrc, beatsLen]);
};
