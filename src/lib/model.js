/**
 * Layer — calibration model (pure, UI-free, unit-tested).
 *
 * This is the heart of the product: how a person's outfit feedback is turned
 * into a personal adjustment on top of the forecast. It is deliberately kept
 * free of React, icons, and side effects so it can be reasoned about and tested
 * in isolation. See model.test.js for the behavioural contract.
 *
 * The model holds three "regime" offsets — cold, mild, warm — plus optional
 * sensitivities to wind / wet / sun. Feedback trains the regimes through a
 * Gaussian kernel (partial pooling), with a step size that decays as evidence
 * accumulates, so early feedback moves fast and later feedback refines.
 */

export const CENTERS = { cold: 33, mild: 60, warm: 82 }; // regime midpoints (°F)
export const KERNEL = 15;        // kernel width — how much regimes share evidence
export const STEP_MAX = 4.5;     // largest single correction (°F)
export const PRIOR_N = 3;        // pseudo-observations; higher = more cautious start
export const CLAMP = 15;         // regime offsets never exceed ±15°F
export const FACTOR_CLAMP = 7;   // wind/wet/sun sensitivities never exceed ±7°F

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const deepCopy = (v) => JSON.parse(JSON.stringify(v));

export const EMPTY_MODEL = {
  v: 5,
  seeded: false,
  regime: { cold: { off: 0, n: 0 }, mild: { off: 0, n: 0 }, warm: { off: 0, n: 0 } },
  factors: { wind: 0, wet: 0, sun: 0 },
  history: [],
};

/** Coerce arbitrary stored/parsed data into a valid model (migration-safe). */
export function normalizeModel(raw) {
  if (!raw || typeof raw !== "object") return deepCopy(EMPTY_MODEL);
  const next = deepCopy(EMPTY_MODEL);
  next.seeded = Boolean(raw.seeded);
  for (const k of Object.keys(next.regime)) {
    next.regime[k].off = Number(raw.regime?.[k]?.off) || 0;
    next.regime[k].n = Number(raw.regime?.[k]?.n) || 0;
  }
  for (const k of Object.keys(next.factors)) {
    next.factors[k] = Number(raw.factors?.[k]) || 0;
  }
  next.history = Array.isArray(raw.history) ? raw.history.slice(-80) : [];
  return next;
}

/** Gaussian weights over the three regimes for a given temperature (sum to 1). */
export function kernelWeights(t) {
  const raw = {};
  let sum = 0;
  for (const key in CENTERS) {
    const w = Math.exp(-Math.pow((t - CENTERS[key]) / KERNEL, 2));
    raw[key] = w;
    sum += w;
  }
  for (const key in raw) raw[key] /= sum || 1;
  return raw;
}

/** The blended personal offset at temperature t. */
export function pooledOffset(model, t) {
  const weights = kernelWeights(t);
  return Object.keys(weights).reduce((sum, key) => sum + weights[key] * model.regime[key].off, 0);
}

export const totalObservations = (m) =>
  m.regime.cold.n + m.regime.mild.n + m.regime.warm.n;

export const confidence = (m) =>
  Math.round((totalObservations(m) / (totalObservations(m) + 4)) * 100);

/**
 * Apply one piece of feedback and return a NEW model (never mutates the input).
 *
 * @param model                 current model
 * @param apparentTemp          the "feels like" temperature the rating was for
 * @param direction             -1 too cold · 0 just right · +1 too warm
 * @param blameKey              null | "cold" | "wind" | "wet" | "sun"
 * @param followed              "yes" | "mostly" | "no"
 *
 * Contract:
 *  · "just right" (0) and "did not follow" ("no") never retrain — they return
 *    an unchanged copy (they are still logged by the caller as history).
 *  · Correcting "too cold" pushes the relevant regimes' offsets DOWN (a lower
 *    effective temperature → warmer recommendation next time); "too warm" up.
 *  · Naming a non-cold cause routes 70% of the correction into that sensitivity
 *    instead of the temperature regimes.
 *  · Step size = PRIOR_N / (PRIOR_N + observations), so it shrinks with evidence.
 *  · "mostly followed" applies at 0.45 reliability.
 */
export function updateModel(model, { apparentTemp, direction, blameKey, followed }) {
  const next = deepCopy(model);
  if (direction === 0 || followed === "no") return next;

  const weights = kernelWeights(apparentTemp);
  const alpha = PRIOR_N / (PRIOR_N + totalObservations(model));
  const reliability = followed === "mostly" ? 0.45 : 1;
  const delta = direction * STEP_MAX * alpha * reliability;
  const toFactor = blameKey && blameKey !== "cold" ? 0.7 : 0;
  const toTemp = 1 - toFactor;

  for (const key in weights) {
    next.regime[key].off = clamp(next.regime[key].off + delta * weights[key] * toTemp, -CLAMP, CLAMP);
    next.regime[key].n += weights[key] * reliability;
  }

  if (toFactor > 0) {
    const sign = blameKey === "sun" ? 1 : -1; // sun reads warmer; wind/wet read colder
    next.factors[blameKey] = clamp(
      (next.factors[blameKey] ?? 0) + sign * direction * STEP_MAX * alpha * toFactor * reliability,
      -FACTOR_CLAMP,
      FACTOR_CLAMP,
    );
  }

  return next;
}
