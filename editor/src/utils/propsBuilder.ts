// src/utils/propsBuilder.ts
import type { TimelineElement } from "../types";

export const buildProps = (
  elements: TimelineElement[],
  defaults: any,
): any => {
  const props = { ...defaults };
  for (const el of elements) {
    // Map elements to props based on label
    if (el.label === "AHURA") {
      props.ahuraPeak = el.startSec + el.durationSec / 2;
      props.ahuraSigma = el.durationSec / 4;
    }
    if (el.label === "DUBFIRE") props.dubfireIn = el.startSec;
    if (el.label === "OMEGA") props.omegaIn = el.startSec;
    // Add more element-to-prop mappings as needed
  }
  return props;
};
