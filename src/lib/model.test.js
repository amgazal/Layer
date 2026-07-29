import { describe, it, expect } from "vitest";
import {
  CENTERS, KERNEL, STEP_MAX, PRIOR_N, CLAMP, FACTOR_CLAMP,
  clamp, deepCopy, EMPTY_MODEL, normalizeModel,
  kernelWeights, pooledOffset, totalObservations, confidence, updateModel,
} from "./model";

const fresh = () => deepCopy(EMPTY_MODEL);
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

describe("clamp", () => {
  it("bounds a value to the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("kernelWeights", () => {
  it("forms a partition of unity (weights sum to 1)", () => {
    for (const t of [-10, 0, 33, 47, 60, 82, 110]) {
      expect(sum(kernelWeights(t))).toBeCloseTo(1, 10);
    }
  });

  it("weights the nearest regime most heavily", () => {
    expect(kernelWeights(CENTERS.cold).cold).toBeGreaterThan(kernelWeights(CENTERS.cold).mild);
    expect(kernelWeights(CENTERS.warm).warm).toBeGreaterThan(kernelWeights(CENTERS.warm).mild);
    const mid = kernelWeights(CENTERS.mild);
    expect(mid.mild).toBeGreaterThan(mid.cold);
    expect(mid.mild).toBeGreaterThan(mid.warm);
  });

  it("puts almost all weight on cold for a frigid day", () => {
    const w = kernelWeights(15);
    expect(w.cold).toBeGreaterThan(0.75);
    expect(w.warm).toBeLessThan(0.02);
  });

  it("shifts weight monotonically from cold to warm as temperature rises", () => {
    const temps = [15, 33, 47, 60, 72, 82, 95];
    const cold = temps.map((t) => kernelWeights(t).cold);
    const warm = temps.map((t) => kernelWeights(t).warm);
    for (let i = 1; i < temps.length; i++) {
      expect(cold[i]).toBeLessThan(cold[i - 1]);   // cold weight falls as it warms
      expect(warm[i]).toBeGreaterThan(warm[i - 1]); // warm weight rises as it warms
    }
  });
});

describe("pooledOffset", () => {
  it("is zero for a fresh model at any temperature", () => {
    const m = fresh();
    for (const t of [20, 45, 60, 90]) expect(pooledOffset(m, t)).toBeCloseTo(0, 10);
  });

  it("returns the regime offset when fully inside one regime", () => {
    const m = fresh();
    m.regime.cold.off = -6;
    // Far into the cold regime, the blended offset is essentially the cold offset.
    expect(pooledOffset(m, 15)).toBeLessThan(-5);
    expect(pooledOffset(m, 15)).toBeGreaterThan(-6.01);
  });

  it("blends smoothly between regimes (no cliff at boundaries)", () => {
    const m = fresh();
    m.regime.cold.off = -8;
    m.regime.mild.off = 0;
    const a = pooledOffset(m, 46);
    const b = pooledOffset(m, 47);
    const c = pooledOffset(m, 48);
    expect(Math.abs(a - b)).toBeLessThan(0.6); // continuous, small step
    expect(b).toBeGreaterThan(a); // moving toward mild raises the (negative) offset
    expect(c).toBeGreaterThan(b);
  });
});

describe("totalObservations & confidence", () => {
  it("counts across all regimes", () => {
    const m = fresh();
    m.regime.cold.n = 1; m.regime.mild.n = 2; m.regime.warm.n = 0.5;
    expect(totalObservations(m)).toBeCloseTo(3.5, 10);
  });

  it("confidence rises with evidence and starts at zero", () => {
    expect(confidence(fresh())).toBe(0);
    const m = fresh();
    m.regime.mild.n = 4;
    expect(confidence(m)).toBe(50); // 4 / (4+4)
    m.regime.mild.n = 12;
    expect(confidence(m)).toBe(75); // 12 / (12+4)
  });
});

describe("normalizeModel", () => {
  it("returns a clean empty model for junk input", () => {
    expect(normalizeModel(null)).toEqual(EMPTY_MODEL);
    expect(normalizeModel("nope")).toEqual(EMPTY_MODEL);
    expect(normalizeModel(42)).toEqual(EMPTY_MODEL);
  });

  it("coerces missing/NaN fields to safe numbers", () => {
    const m = normalizeModel({ seeded: true, regime: { cold: { off: "x" } }, factors: { wind: null } });
    expect(m.seeded).toBe(true);
    expect(m.regime.cold.off).toBe(0);
    expect(m.regime.mild.n).toBe(0);
    expect(m.factors.wind).toBe(0);
    expect(Array.isArray(m.history)).toBe(true);
  });

  it("preserves valid values and trims history to 80", () => {
    const history = Array.from({ length: 200 }, (_, i) => ({ at: i }));
    const m = normalizeModel({ seeded: true, regime: { warm: { off: 3, n: 2 } }, factors: { sun: 1.5 }, history });
    expect(m.regime.warm.off).toBe(3);
    expect(m.regime.warm.n).toBe(2);
    expect(m.factors.sun).toBe(1.5);
    expect(m.history).toHaveLength(80);
    expect(m.history[79].at).toBe(199); // keeps the most recent
  });

  it("does not mutate the input", () => {
    const raw = { seeded: true, regime: { cold: { off: 5, n: 1 } } };
    const copy = deepCopy(raw);
    normalizeModel(raw);
    expect(raw).toEqual(copy);
  });
});

describe("updateModel — the learning step", () => {
  it("never mutates the input model", () => {
    const m = fresh();
    const snapshot = deepCopy(m);
    updateModel(m, { apparentTemp: 33, direction: -1, blameKey: null, followed: "yes" });
    expect(m).toEqual(snapshot);
  });

  it("does not retrain on 'just right'", () => {
    const m = fresh();
    const out = updateModel(m, { apparentTemp: 33, direction: 0, blameKey: null, followed: "yes" });
    expect(out.regime).toEqual(m.regime);
    expect(out.factors).toEqual(m.factors);
  });

  it("does not retrain when the user did not follow the recommendation", () => {
    const m = fresh();
    const out = updateModel(m, { apparentTemp: 33, direction: -1, blameKey: null, followed: "no" });
    expect(out.regime).toEqual(m.regime);
  });

  it("'too cold' pushes the offset DOWN (→ warmer next time)", () => {
    const m = fresh();
    const out = updateModel(m, { apparentTemp: CENTERS.cold, direction: -1, blameKey: null, followed: "yes" });
    expect(out.regime.cold.off).toBeLessThan(0);
    // Effective temperature at that temp drops, which drives a warmer outfit.
    expect(pooledOffset(out, CENTERS.cold)).toBeLessThan(0);
  });

  it("'too warm' pushes the offset UP (→ lighter next time)", () => {
    const m = fresh();
    const out = updateModel(m, { apparentTemp: CENTERS.warm, direction: 1, blameKey: null, followed: "yes" });
    expect(out.regime.warm.off).toBeGreaterThan(0);
  });

  it("trains the local regime hard and neighbours softly (partial pooling)", () => {
    const m = fresh();
    const out = updateModel(m, { apparentTemp: CENTERS.cold, direction: -1, blameKey: null, followed: "yes" });
    expect(Math.abs(out.regime.cold.off)).toBeGreaterThan(Math.abs(out.regime.mild.off));
    expect(Math.abs(out.regime.warm.off)).toBeLessThan(Math.abs(out.regime.mild.off));
  });

  it("non-linear tolerance: cold feedback barely moves the warm regime", () => {
    const m = fresh();
    const out = updateModel(m, { apparentTemp: 30, direction: -1, blameKey: null, followed: "yes" });
    expect(Math.abs(out.regime.warm.off)).toBeLessThan(0.05);
    expect(Math.abs(out.regime.cold.off)).toBeGreaterThan(1);
  });

  it("step size decays as observations accumulate", () => {
    let m = fresh();
    const firstStep = Math.abs(
      updateModel(m, { apparentTemp: CENTERS.cold, direction: -1, blameKey: null, followed: "yes" }).regime.cold.off,
    );
    // Simulate accumulated evidence.
    m.regime.cold.n = 10; m.regime.mild.n = 10; m.regime.warm.n = 10;
    const before = m.regime.cold.off;
    const laterStep = Math.abs(
      updateModel(m, { apparentTemp: CENTERS.cold, direction: -1, blameKey: null, followed: "yes" }).regime.cold.off - before,
    );
    expect(laterStep).toBeLessThan(firstStep);
  });

  it("'mostly followed' moves less than a full 'yes'", () => {
    const m = fresh();
    const full = updateModel(m, { apparentTemp: CENTERS.cold, direction: -1, blameKey: null, followed: "yes" });
    const partial = updateModel(m, { apparentTemp: CENTERS.cold, direction: -1, blameKey: null, followed: "mostly" });
    expect(Math.abs(partial.regime.cold.off)).toBeLessThan(Math.abs(full.regime.cold.off));
    // 0.45 reliability affects both the step and the observation count.
    expect(partial.regime.cold.n).toBeCloseTo(full.regime.cold.n * 0.45, 6);
  });

  it("blaming wind routes correction into the wind sensitivity, not just temperature", () => {
    const m = fresh();
    const plainCold = updateModel(m, { apparentTemp: 40, direction: -1, blameKey: null, followed: "yes" });
    const windCold = updateModel(m, { apparentTemp: 40, direction: -1, blameKey: "wind", followed: "yes" });
    // Wind sensitivity increases (colder → higher wind factor).
    expect(windCold.factors.wind).toBeGreaterThan(0);
    // And the temperature regime moves less than when nothing was blamed (70% diverted).
    expect(Math.abs(windCold.regime.cold.off)).toBeLessThan(Math.abs(plainCold.regime.cold.off));
  });

  it("blaming 'cold' behaves like no blame (all correction to temperature)", () => {
    const m = fresh();
    const blamed = updateModel(m, { apparentTemp: 40, direction: -1, blameKey: "cold", followed: "yes" });
    const plain = updateModel(m, { apparentTemp: 40, direction: -1, blameKey: null, followed: "yes" });
    expect(blamed.regime.cold.off).toBeCloseTo(plain.regime.cold.off, 10);
    expect(blamed.factors).toEqual(fresh().factors); // no factor touched
  });

  it("blaming sun raises the sun factor (sun reads warmer)", () => {
    const m = fresh();
    const out = updateModel(m, { apparentTemp: 85, direction: 1, blameKey: "sun", followed: "yes" });
    expect(out.factors.sun).toBeGreaterThan(0);
  });

  it("regime offsets are clamped to ±CLAMP under repeated feedback", () => {
    let m = fresh();
    for (let i = 0; i < 400; i++) {
      m = updateModel(m, { apparentTemp: CENTERS.cold, direction: -1, blameKey: null, followed: "yes" });
    }
    expect(m.regime.cold.off).toBeGreaterThanOrEqual(-CLAMP);
    expect(m.regime.cold.off).toBeCloseTo(-CLAMP, 1);
  });

  it("factor sensitivities are clamped to ±FACTOR_CLAMP", () => {
    let m = fresh();
    for (let i = 0; i < 400; i++) {
      m = updateModel(m, { apparentTemp: 40, direction: -1, blameKey: "wind", followed: "yes" });
    }
    expect(m.factors.wind).toBeLessThanOrEqual(FACTOR_CLAMP);
    expect(m.factors.wind).toBeCloseTo(FACTOR_CLAMP, 1);
  });

  it("converges: repeated 'too cold' then settling reduces the correction over time", () => {
    let m = fresh();
    const steps = [];
    for (let i = 0; i < 6; i++) {
      const before = pooledOffset(m, CENTERS.cold);
      m = updateModel(m, { apparentTemp: CENTERS.cold, direction: -1, blameKey: null, followed: "yes" });
      steps.push(Math.abs(pooledOffset(m, CENTERS.cold) - before));
    }
    // Each successive correction is no larger than the previous one.
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThanOrEqual(steps[i - 1] + 1e-9);
    }
  });
});
