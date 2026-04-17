// src/utils/propsBuilder.ts
import type { TimelineElement } from "../types";

/**
 * Map timeline elements onto a composition's props object.
 *
 * Strategy:
 *   - Elements carry a `type` and a `props` payload.
 *   - Certain well-known labels (AHURA, DUBFIRE, OMEGA) map to PublicCut fields
 *     for backward compatibility with existing timeline elements.
 *   - New elements with `props.mapTo` targeting a composition prop are merged in.
 */
export const buildProps = <T extends Record<string, unknown>>(
  elements: TimelineElement[],
  defaults: T,
): T => {
  const props: Record<string, unknown> = { ...defaults };

  for (const el of elements) {
    // Well-known label mappings (PublicCut backward compat)
    if (el.label === "AHURA") {
      props.ahuraPeak = el.startSec + el.durationSec / 2;
      props.ahuraSigma = el.durationSec / 4;
    }
    if (el.label === "DUBFIRE") {
      props.dubfireIn = el.startSec;
      if (typeof el.props.durationOverride === "number") {
        props.dubfireDur = el.props.durationOverride;
      }
    }
    if (el.label === "OMEGA") {
      props.omegaIn = el.startSec;
    }
    if (el.label === "T-MINUS-12:12") {
      props.tIn = el.startSec;
      props.minusIn = el.startSec + 0.3;
      props.twelveIn = el.startSec + 0.6;
    }

    // Generic mapping: if element declares { mapTo: "propName" } in props,
    // set the composition prop to the element's startSec.
    if (typeof el.props.mapTo === "string") {
      props[el.props.mapTo] = el.startSec;
    }
    if (typeof el.props.mapToDuration === "string") {
      props[el.props.mapToDuration] = el.durationSec;
    }
  }

  return props as T;
};
