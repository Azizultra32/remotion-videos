// Named Penner easing functions for element schemas (AutoField dropdown).
// Shape lifted from Motion Canvas packages/core/src/tweening/timingFunctions.ts (MIT).
// All functions: (t: number ∈ [0, 1]) => number, with f(0) = 0 and f(1) = 1.

export type EasingFn = (t: number) => number;

const { pow, sqrt, sin, cos, PI } = Math;

const C1 = 1.70158;
const C2 = C1 * 1.525;
const C3 = C1 + 1;
const C4 = (2 * PI) / 3;
const C5 = (2 * PI) / 4.5;
const N1 = 7.5625;
const D1 = 2.75;

const bounceOut: EasingFn = (t) => {
  if (t < 1 / D1) return N1 * t * t;
  if (t < 2 / D1) return N1 * (t -= 1.5 / D1) * t + 0.75;
  if (t < 2.5 / D1) return N1 * (t -= 2.25 / D1) * t + 0.9375;
  return N1 * (t -= 2.625 / D1) * t + 0.984375;
};

export const EASINGS: Record<string, EasingFn> = {
  linear: (t) => t,

  easeInSine: (t) => 1 - cos((t * PI) / 2),
  easeOutSine: (t) => sin((t * PI) / 2),
  easeInOutSine: (t) => -(cos(PI * t) - 1) / 2,

  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2),

  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2),

  easeInQuart: (t) => t * t * t * t,
  easeOutQuart: (t) => 1 - pow(1 - t, 4),
  easeInOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - pow(-2 * t + 2, 4) / 2),

  easeInQuint: (t) => t * t * t * t * t,
  easeOutQuint: (t) => 1 - pow(1 - t, 5),
  easeInOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - pow(-2 * t + 2, 5) / 2),

  easeInExpo: (t) => (t === 0 ? 0 : pow(2, 10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - pow(2, -10 * t)),
  easeInOutExpo: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return t < 0.5 ? pow(2, 20 * t - 10) / 2 : (2 - pow(2, -20 * t + 10)) / 2;
  },

  easeInCirc: (t) => 1 - sqrt(1 - pow(t, 2)),
  easeOutCirc: (t) => sqrt(1 - pow(t - 1, 2)),
  easeInOutCirc: (t) =>
    t < 0.5 ? (1 - sqrt(1 - pow(2 * t, 2))) / 2 : (sqrt(1 - pow(-2 * t + 2, 2)) + 1) / 2,

  easeInBack: (t) => C3 * t * t * t - C1 * t * t,
  easeOutBack: (t) => 1 + C3 * pow(t - 1, 3) + C1 * pow(t - 1, 2),
  easeInOutBack: (t) =>
    t < 0.5
      ? (pow(2 * t, 2) * ((C2 + 1) * 2 * t - C2)) / 2
      : (pow(2 * t - 2, 2) * ((C2 + 1) * (t * 2 - 2) + C2) + 2) / 2,

  easeInElastic: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return -pow(2, 10 * t - 10) * sin((t * 10 - 10.75) * C4);
  },
  easeOutElastic: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return pow(2, -10 * t) * sin((t * 10 - 0.75) * C4) + 1;
  },
  easeInOutElastic: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return t < 0.5
      ? -(pow(2, 20 * t - 10) * sin((20 * t - 11.125) * C5)) / 2
      : (pow(2, -20 * t + 10) * sin((20 * t - 11.125) * C5)) / 2 + 1;
  },

  easeInBounce: (t) => 1 - bounceOut(1 - t),
  easeOutBounce: bounceOut,
  easeInOutBounce: (t) =>
    t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2,
};

export const EASING_NAMES = Object.keys(EASINGS) as readonly string[];

export const resolveEasing = (name: string | undefined): EasingFn =>
  (name && EASINGS[name]) || EASINGS.linear;
