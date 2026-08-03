/**
 * Difference between the two numbers that are actually shown in the hero:
 * air temperature on the left and Layer's dress-for temperature on the right.
 * Keeping this separate from the internal apparent-temperature adjustment
 * prevents badges that contradict the visible arithmetic.
 */
export function visibleTemperatureShift(actualTemperature, effectiveTemperature) {
  const actual = Number(actualTemperature);
  const effective = Number(effectiveTemperature);
  if (!Number.isFinite(actual) || !Number.isFinite(effective)) return 0;
  return Math.round(effective) - Math.round(actual);
}

export function temperatureShiftLabel(shift) {
  const rounded = Math.round(Number(shift) || 0);
  if (rounded === 0) return "";
  return `${Math.abs(rounded)}° ${rounded < 0 ? "cooler" : "warmer"} for you`;
}
