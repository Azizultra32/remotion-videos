// src/hooks/useBeatData.ts
//
// Loads beats/events JSON from public/ and normalizes it into BeatData so
// every consumer can safely .map / .length / .filter without guarding.
//
// Two analysis pipelines are live in this repo:
//   legacy: { beats, drops, breakdowns, bpm_global, downbeats, energy, ... }
//   new:    { events, phase1_events_sec, phase2_events_sec, energy_bands, ... }
//
// The new pipeline explicitly strips the legacy fields ("Legacy event, beat,
// drop, and breakdown metadata intentionally removed" — see
// public/love-in-traffic-beats.json). Consumers assume the canonical shape,
// so we fill in empty defaults for anything the JSON doesn't provide and
// pass the new fields through unchanged.
import { useEffect } from "react";
import { useEditorStore } from "../store";
import type { BeatData } from "../types";

const normalize = (raw: unknown): BeatData => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback = 0): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    // Newer files call this `duration_sec`; older ones call it `duration`.
    duration: num(r.duration ?? r.duration_sec),
    bpm_global: num(r.bpm_global),
    beats: arr<number>(r.beats),
    downbeats: arr<number>(r.downbeats),
    drops: arr<number>(r.drops),
    breakdowns: arr<{ start: number; end: number }>(r.breakdowns),
    energy: arr<{ t: number; db: number }>(r.energy),
    events: Array.isArray(r.events) ? (r.events as unknown[]) : undefined,
    phase1_events_sec: Array.isArray(r.phase1_events_sec)
      ? (r.phase1_events_sec as number[])
      : undefined,
    phase2_events_sec: Array.isArray(r.phase2_events_sec)
      ? (r.phase2_events_sec as number[])
      : undefined,
  };
};

export const useBeatData = (url: string) => {
  const setBeatData = useEditorStore((s) => s.setBeatData);
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setBeatData(normalize(d));
      })
      .catch(() => {
        if (!cancelled) setBeatData(normalize({}));
      });
    return () => {
      cancelled = true;
    };
  }, [url, setBeatData]);
};
