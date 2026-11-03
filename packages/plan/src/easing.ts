// Cubic-bezier easing, the bezier-easing algorithm (as in Remotion's Easing.bezier), so the resolver can compute
// camera moves without depending on a renderer.

const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 0.0000001;
const SUBDIVISION_MAX_ITERATIONS = 10;
const SPLINE_TABLE_SIZE = 11;
const SAMPLE_STEP = 1.0 / (SPLINE_TABLE_SIZE - 1.0);

const A = (a1: number, a2: number) => 1.0 - 3.0 * a2 + 3.0 * a1;
const B = (a1: number, a2: number) => 3.0 * a2 - 6.0 * a1;
const C = (a1: number) => 3.0 * a1;
const calcBezier = (t: number, a1: number, a2: number) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
const getSlope = (t: number, a1: number, a2: number) => 3.0 * A(a1, a2) * t * t + 2.0 * B(a1, a2) * t + C(a1);

const binarySubdivide = (x: number, a: number, b: number, x1: number, x2: number) => {
  let currentX: number;
  let currentT: number;
  let i = 0;
  do {
    currentT = a + (b - a) / 2.0;
    currentX = calcBezier(currentT, x1, x2) - x;
    if (currentX > 0.0) b = currentT;
    else a = currentT;
  } while (Math.abs(currentX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS);
  return currentT;
};

const newtonRaphsonIterate = (x: number, guess: number, x1: number, x2: number) => {
  let t = guess;
  for (let i = 0; i < NEWTON_ITERATIONS; ++i) {
    const slope = getSlope(t, x1, x2);
    if (slope === 0.0) return t;
    t -= (calcBezier(t, x1, x2) - x) / slope;
  }
  return t;
};

export const bezier = (x1: number, y1: number, x2: number, y2: number): ((t: number) => number) => {
  if (x1 === y1 && x2 === y2) return (t) => t;
  const samples = new Float32Array(SPLINE_TABLE_SIZE);
  for (let i = 0; i < SPLINE_TABLE_SIZE; ++i) samples[i] = calcBezier(i * SAMPLE_STEP, x1, x2);

  const getTForX = (x: number) => {
    let intervalStart = 0.0;
    let current = 1;
    const last = SPLINE_TABLE_SIZE - 1;
    for (; current !== last && samples[current] <= x; ++current) intervalStart += SAMPLE_STEP;
    --current;
    const dist = (x - samples[current]) / (samples[current + 1] - samples[current]);
    const guess = intervalStart + dist * SAMPLE_STEP;
    const slope = getSlope(guess, x1, x2);
    if (slope >= NEWTON_MIN_SLOPE) return newtonRaphsonIterate(x, guess, x1, x2);
    if (slope === 0.0) return guess;
    return binarySubdivide(x, intervalStart, intervalStart + SAMPLE_STEP, x1, x2);
  };

  return (t: number) => {
    if (t === 0 || t === 1) return t;
    return calcBezier(getTForX(t), y1, y2);
  };
};

/** The reveal curve from @mc/motion (text and soft entrances), used for camera intros. */
export const reveal = bezier(0.22, 1, 0.36, 1);

/** 0 → 1 progress from `start` over `duration` frames, clamped. */
export const tween = (frame: number, start: number, duration: number, easing: (t: number) => number) => {
  const x = Math.min(1, Math.max(0, (frame - start) / duration));
  return easing(x);
};

export const mix = (t: number, a: number, b: number) => a + (b - a) * t;
