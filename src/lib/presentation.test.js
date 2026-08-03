import { describe, expect, it } from "vitest";
import { temperatureShiftLabel, visibleTemperatureShift } from "./presentation";

describe("visible temperature comparison", () => {
  it("shows no shift when both displayed temperatures round to the same value", () => {
    expect(visibleTemperatureShift(69, 69)).toBe(0);
    expect(temperatureShiftLabel(0)).toBe("");
  });

  it("matches the arithmetic shown in the hero", () => {
    expect(visibleTemperatureShift(69, 66)).toBe(-3);
    expect(temperatureShiftLabel(-3)).toBe("3° cooler for you");
    expect(visibleTemperatureShift(72, 75)).toBe(3);
    expect(temperatureShiftLabel(3)).toBe("3° warmer for you");
  });
});
