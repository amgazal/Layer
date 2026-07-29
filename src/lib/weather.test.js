import { describe, expect, it } from "vitest";
import {
  campusRainConsensus,
  classifyWeather,
  rainIntensityFromRate,
  rainSignalFromLocation,
} from "./weather";

describe("rain classification", () => {
  it("lets measured rain override an overcast WMO code", () => {
    const condition = classifyWeather(3, 1, 0.4);
    expect(condition.category).toBe("rain");
    expect(condition.label).toBe("Light rain");
    expect(condition.wetLevel).toBe(1);
  });

  it("lets measured rain override fog without hiding the precipitation", () => {
    const condition = classifyWeather(45, 1, 3);
    expect(condition.category).toBe("rain");
    expect(condition.label).toBe("Rain");
  });

  it("keeps a truly dry overcast reading as overcast", () => {
    expect(classifyWeather(3, 1, 0).label).toBe("Overcast");
  });

  it("keeps snow ahead of the liquid-rate fallback", () => {
    const condition = classifyWeather(75, 1, 4);
    expect(condition.category).toBe("snow");
    expect(condition.label).toBe("Heavy snow");
  });

  it("treats a small but meaningful positive rate as light rain", () => {
    expect(rainIntensityFromRate(0.06)).toBe(1);
    expect(rainIntensityFromRate(0.01)).toBe(0);
  });
});

describe("campus rain detection", () => {
  it("uses the latest completed 15-minute signal", () => {
    const base = 1_800_000_000;
    const signal = rainSignalFromLocation({
      current: {
        time: base,
        interval: 900,
        weather_code: 3,
        precipitation: 0,
        rain: 0,
        showers: 0,
      },
      minutely_15: {
        time: [base - 900, base],
        weather_code: [3, 3],
        precipitation: [0, 0.2],
        rain: [0, 0.2],
        showers: [0, 0],
      },
    });
    expect(signal.severity).toBe(1);
    expect(signal.rate).toBeCloseTo(0.8);
  });

  it("accepts two nearby wet campus points when the centre point misses a shower", () => {
    const consensus = campusRainConsensus([
      { severity: 0, rate: 0, code: 3 },
      { severity: 1, rate: 0.4, code: 61 },
      { severity: 2, rate: 3.0, code: 63 },
      { severity: 0, rate: 0, code: 3 },
    ], 20);
    expect(consensus.scope).toBe("campus");
    expect(consensus.severity).toBeGreaterThan(0);
  });

  it("does not let one weak nearby signal create a false rain report", () => {
    const consensus = campusRainConsensus([
      { severity: 0, rate: 0, code: 3 },
      { severity: 1, rate: 0.06, code: 61 },
      { severity: 0, rate: 0, code: 3 },
    ], 10);
    expect(consensus.severity).toBe(0);
  });

  it("uses one strong nearby signal conservatively when rain chance supports it", () => {
    const consensus = campusRainConsensus([
      { severity: 0, rate: 0, code: 3 },
      { severity: 2, rate: 4, code: 63 },
    ], 45);
    expect(consensus.scope).toBe("nearby");
    expect(consensus.severity).toBe(1);
  });
});
