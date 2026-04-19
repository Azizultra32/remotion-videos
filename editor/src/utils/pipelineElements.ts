import type { TimelineElement } from "../types";

// Deterministic id — same event time always produces the same id so that
// a re-run of analysis yielding the same timestamps is idempotent and
// existing user edits to that element's label are preserved.
const pipelineId = (stem: string, sec: number): string =>
  `pipeline-${stem}-${sec.toFixed(3)}`;

// Snap `sec` to the nearest value in `beats` (sorted ascending). Returns
// `sec` unchanged if beats is empty. No threshold — pipeline elements are
// musical anchors, so we always align to the tempo grid when available.
// If the grid is off (missing beats), behavior degrades gracefully: we
// return the raw value and the element is still placed, just not snapped.
const nearestBeat = (sec: number, beats: number[]): number => {
  if (beats.length === 0) return sec;
  let best = beats[0];
  let minDist = Math.abs(best - sec);
  for (let i = 1; i < beats.length; i++) {
    const d = Math.abs(beats[i] - sec);
    if (d < minDist) { best = beats[i]; minDist = d; }
    else if (beats[i] > sec) break; // sorted ascending — strictly further past sec
  }
  return best;
};

export const makePipelineElement = (
  stem: string,
  eventSec: number,
  beats: number[] = [],
): TimelineElement => {
  // Pipeline elements visually anchor BEFORE the event by 1 second so the
  // "bell curve" crests at the event moment. Then snap that start to the
  // nearest beat so elements sit on the tempo grid.
  const rawStart = Math.max(0, eventSec - 1);
  const startSec = nearestBeat(rawStart, beats);
  return {
    id: pipelineId(stem, eventSec),
    type: "text.bellCurve",
    trackIndex: 0,
    startSec,
    durationSec: 2,
    label: `EVENT ${eventSec.toFixed(1)}s`,
    props: {
      text: "",
      x: 50,
      y: 50,
      sigmaSec: 0.45,
      zoomFrom: 0.85,
      zoomTo: 1.0,
      textColor: "#ffffff",
      fontSize: 120,
      fontWeight: 800,
      fontFamily: "ui-serif, Georgia, serif",
      letterSpacing: "0.08em",
      bassGlowMax: 30,
    },
    origin: "pipeline",
    locked: true,
  };
};

/**
 * Reconcile pipeline-origin elements against an authoritative event list.
 * User-origin elements are preserved untouched. Pipeline elements are
 * matched by their deterministic id (derived from stem + timestamp) —
 * existing ones have their label and props merged over the newly-generated
 * defaults, preserving any user edits made while unlocked. If `beats` is
 * provided, fresh pipeline elements snap their startSec to the nearest beat.
 */
export const mergePipelineElements = (
  current: TimelineElement[],
  stem: string,
  events: number[],
  beats: number[] = [],
): TimelineElement[] => {
  const userElements = current.filter((e) => e.origin !== "pipeline");
  const existingById = new Map(
    current.filter((e) => e.origin === "pipeline").map((e) => [e.id, e]),
  );
  const desiredPipeline = events.map((t) => {
    const fresh = makePipelineElement(stem, t, beats);
    const existing = existingById.get(fresh.id);
    if (!existing) return fresh;
    // Preserve user edits to label + props + lock state on re-runs.
    return {
      ...fresh,
      label: existing.label || fresh.label,
      props: { ...fresh.props, ...existing.props },
      locked: existing.locked ?? fresh.locked,
    };
  });
  return [...userElements, ...desiredPipeline].sort(
    (a, b) => a.startSec - b.startSec,
  );
};
