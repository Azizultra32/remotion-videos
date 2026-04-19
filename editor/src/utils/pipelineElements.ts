import type { TimelineElement } from "../types";

// Deterministic id — same event time always produces the same id so that
// a re-run of analysis yielding the same timestamps is idempotent and
// existing user edits to that element's label are preserved.
const pipelineId = (stem: string, sec: number): string =>
  `pipeline-${stem}-${sec.toFixed(3)}`;

export const makePipelineElement = (stem: string, eventSec: number): TimelineElement => ({
  id: pipelineId(stem, eventSec),
  type: "text.bellCurve",
  trackIndex: 0,
  startSec: Math.max(0, eventSec - 1),
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
});

/**
 * Reconcile pipeline-origin elements against an authoritative event list.
 * User-origin elements are preserved untouched. Pipeline elements are
 * matched by their deterministic id (derived from stem + timestamp) —
 * existing ones have their label and props merged over the newly-generated
 * defaults, preserving any user edits made while unlocked.
 */
export const mergePipelineElements = (
  current: TimelineElement[],
  stem: string,
  events: number[],
): TimelineElement[] => {
  const userElements = current.filter((e) => e.origin !== "pipeline");
  const existingById = new Map(
    current.filter((e) => e.origin === "pipeline").map((e) => [e.id, e]),
  );
  const desiredPipeline = events.map((t) => {
    const fresh = makePipelineElement(stem, t);
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
