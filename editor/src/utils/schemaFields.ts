// Heuristic detectors for special schema field shapes that deserve richer
// editor controls. Keeps detection logic pure + unit-testable; SchemaEditor
// composes these with the EASING_NAMES registry from @utils/easing to render
// typed dropdowns instead of free-text inputs.

const EASING_NAME_RE = /^ease[A-Z]|easing$|Easing$|^easing$/;

export const isEasingField = (name: string): boolean => {
  if (!name) return false;
  if (name.toLowerCase() === "easing") return true;
  return EASING_NAME_RE.test(name);
};
