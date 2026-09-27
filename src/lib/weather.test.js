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

describe('current condition matrix and interval boundaries',()=>{
  it.each([[0,0,'Clear'],[3,0,'Overcast'],[0,.2,'Light rain'],[3,.2,'Light rain'],[51,0,'Drizzle'],[61,0,'Light rain'],[65,0,'Heavy rain'],[71,0,'Light snow'],[66,0,'Freezing rain'],[95,0,'Thunderstorm']])('code %i rate %f → %s',(code,rate,label)=>{
    expect(classifyWeather(code,1,rate).label).toBe(label);
  });
  it.each([0,1,899])('ignores future rain at boundary +%i seconds',offset=>{
    const t=1800000000;
    const signal=rainSignalFromLocation({current:{time:t+offset,weather_code:0,precipitation:0},minutely_15:{time:[t,t+900],precipitation:[0,.5],weather_code:[0,61]}});
    expect(signal.severity).toBe(0);
  });
  it('aligns absolute timestamps across the fall DST repeated hour',()=>{
    const t=Date.parse('2026-11-01T01:15:00-05:00')/1000;
    expect(rainSignalFromLocation({current:{time:t,weather_code:0},minutely_15:{time:[t-3600,t,t+900],precipitation:[0,.2,1]}}).rate).toBe(.8);
  });
});
it('ignores an old completed interval and caps single nearby intensity',()=>{
  const t=1800000000;
  expect(rainSignalFromLocation({current:{time:t,weather_code:0},minutely_15:{time:[t-1800],precipitation:[2]}}).severity).toBe(0);
  const nearby=campusRainConsensus([{severity:0,rate:0,code:0},{severity:3,rate:20,code:65}],10);
  expect(nearby.rate).toBeLessThan(2.5);
});
