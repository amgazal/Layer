/**
 * Pure weather classification helpers.
 *
 * Keeping this logic outside the React component makes the most important
 * trust decision in Layer — “is it raining?” — directly unit-testable.
 */

const RAIN_CODES = new Set([
  51, 53, 55, 56, 57,
  61, 63, 65, 66, 67,
  80, 81, 82,
  95, 96, 99,
]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

// Rainfall rate (mm/hour) → 0 none · 1 light · 2 moderate · 3 heavy.
// Any meaningful positive rate is treated as light precipitation so a model
// code that still says “overcast” cannot hide rain that is already falling.
export function rainIntensityFromRate(rateMmPerHour) {
  const rate = Math.max(0, Number(rateMmPerHour) || 0);
  if (rate >= 7.5) return 3;
  if (rate >= 2.5) return 2;
  if (rate >= 0.05) return 1;
  return 0;
}

export function rateFrom15MinuteTotal(totalMm) {
  return Math.max(0, Number(totalMm) || 0) * 4;
}

export function rateFromIntervalTotal(totalMm, intervalSeconds = 900) {
  const seconds = Math.max(60, Number(intervalSeconds) || 900);
  return Math.max(0, Number(totalMm) || 0) * (3600 / seconds);
}

export function liquidPrecipitationTotal(source, index = null) {
  const read = (key) => {
    const value = index == null ? source?.[key] : source?.[key]?.[index];
    return Math.max(0, Number(value) || 0);
  };

  // Open-Meteo exposes precipitation as an aggregate and rain/showers as
  // components. Taking the strongest liquid signal catches showers that can
  // briefly lag behind the headline weather code.
  return Math.max(read("precipitation"), read("rain") + read("showers"));
}

export function wmoRainSeverity(code) {
  const value = Number(code);
  if ([57, 65, 67, 82, 95, 96, 99].includes(value)) return 3;
  if ([53, 55, 63, 81].includes(value)) return 2;
  if ([51, 56, 61, 66, 80].includes(value)) return 1;
  return 0;
}

export function getLatestIndexAtOrBefore(times, targetMs) {
  if (!times?.length) return -1;
  let best = -1;
  for (let i = 0; i < times.length; i += 1) {
    const raw = times[i];
    const ms = typeof raw === "number" ? raw * 1000 : new Date(raw).getTime();
    if (ms <= targetMs) best = i;
    else break;
  }
  return best;
}

/**
 * Return a rain signal from one Open-Meteo location response.
 */
export function rainSignalFromLocation(data) {
  if (!data?.current) return { severity: 0, rate: 0, code: 3 };

  const currentMs = typeof data.current.time === "number"
    ? data.current.time * 1000
    : new Date(data.current.time ?? Date.now()).getTime();
  const minuteIndex = data.minutely_15?.time?.length
    ? getLatestIndexAtOrBefore(data.minutely_15.time, currentMs)
    : -1;

  const currentRate = rateFromIntervalTotal(
    liquidPrecipitationTotal(data.current),
    data.current.interval ?? 900,
  );
  const recentRate = minuteIndex >= 0
    ? rateFrom15MinuteTotal(liquidPrecipitationTotal(data.minutely_15, minuteIndex))
    : 0;

  const rawCode = Number(data.current.weather_code ?? 3);
  const recentCode = minuteIndex >= 0
    ? Number(data.minutely_15.weather_code?.[minuteIndex] ?? rawCode)
    : rawCode;
  const code = wmoRainSeverity(recentCode) > wmoRainSeverity(rawCode)
    ? recentCode
    : rawCode;
  const rate = Math.max(currentRate, recentRate);

  return {
    severity: Math.max(wmoRainSeverity(code), rainIntensityFromRate(rate)),
    rate,
    code,
  };
}

/**
 * Conservative campus consensus for localised showers.
 *
 * The primary campus point always wins when it detects rain. If it is dry, two
 * nearby points are enough to confirm a campus-wide signal. One nearby point
 * can only trigger a light “passing shower” signal when either its intensity is
 * meaningful or the hourly rain chance supports it.
 */
export function campusRainConsensus(signals, precipitationProbability = 0) {
  const safe = Array.isArray(signals)
    ? signals.filter((signal) => signal && Number.isFinite(Number(signal.severity)))
    : [];
  if (!safe.length) return { severity: 0, rate: 0, code: 3, scope: "none", support: 0 };

  const primary = safe[0];
  if (Number(primary.severity) > 0) {
    return { ...primary, scope: "primary", support: 1 };
  }

  const wet = safe.slice(1).filter((signal) => Number(signal.severity) > 0);
  if (!wet.length) return { ...primary, severity: 0, rate: 0, scope: "none", support: 0 };

  const maxRate = Math.max(0, ...wet.map((signal) => Number(signal.rate) || 0));
  const strongest = wet.reduce((best, signal) =>
    Number(signal.severity) > Number(best.severity) ? signal : best, wet[0]);

  if (wet.length >= 2) {
    const meanSeverity = wet.reduce((sum, signal) => sum + Number(signal.severity), 0) / wet.length;
    const severity = Math.max(1, Math.min(3, Math.round(meanSeverity)));
    return {
      severity,
      rate: Math.max(maxRate, severity === 3 ? 7.5 : severity === 2 ? 2.5 : 0.05),
      code: strongest.code,
      scope: "campus",
      support: wet.length,
    };
  }

  if (Number(strongest.severity) >= 2 || Number(precipitationProbability) >= 35) {
    return {
      severity: 1,
      rate: Math.max(maxRate, 0.05),
      code: RAIN_CODES.has(Number(strongest.code)) ? strongest.code : 61,
      scope: "nearby",
      support: 1,
    };
  }

  return { ...primary, severity: 0, rate: 0, scope: "none", support: 0 };
}

/**
 * Pure condition classifier. Rain evidence is evaluated before dry/cloudy
 * labels, fixing the case where code 3 (“overcast”) masked a positive rain rate.
 */
export function classifyWeather(code, isDay = 1, rainRateMmPerHour = 0) {
  const value = Number(code);
  const daytime = Number(isDay) !== 0;
  const rainRate = Math.max(0, Number(rainRateMmPerHour) || 0);
  const measured = rainIntensityFromRate(rainRate);

  if (SNOW_CODES.has(value)) {
    const heavy = value === 75 || value === 86;
    const moderate = value === 73;
    return {
      label: heavy ? "Heavy snow" : moderate ? "Snow" : "Light snow",
      iconKey: "snow",
      wet: false,
      snow: true,
      clear: false,
      category: "snow",
      wetLevel: heavy ? 3 : moderate ? 2 : 1,
      rainRate: 0,
      thunder: false,
      freezing: false,
    };
  }

  const thunder = value >= 95 && value <= 99;
  const drizzle = value >= 51 && value <= 57;
  const codedRain = RAIN_CODES.has(value);
  if (measured > 0 || codedRain) {
    const intensity = Math.max(wmoRainSeverity(value), measured, 1);
    const freezing = [56, 57, 66, 67].includes(value);
    const hail = value === 96 || value === 99;

    let label;
    if (hail) label = "Thunderstorm with hail";
    else if (thunder) label = "Thunderstorm";
    else if (freezing) label = intensity >= 3 ? "Heavy freezing rain" : "Freezing rain";
    else if (intensity >= 3) label = "Heavy rain";
    else if (intensity === 2) label = drizzle ? "Dense drizzle" : "Rain";
    else label = drizzle ? "Drizzle" : "Light rain";

    return {
      label,
      iconKey: thunder ? "thunder" : intensity >= 2 ? "rain" : "drizzle",
      wet: true,
      snow: false,
      clear: false,
      category: "rain",
      wetLevel: intensity,
      rainRate,
      thunder,
      freezing,
    };
  }

  if (value === 0) {
    return {
      label: daytime ? "Clear" : "Clear night",
      iconKey: daytime ? "sun" : "moon",
      wet: false, snow: false, clear: true, category: "clear",
      wetLevel: 0, rainRate: 0, thunder: false, freezing: false,
    };
  }
  if (value === 1 || value === 2) {
    return {
      label: "Partly cloudy",
      iconKey: daytime ? "partly-day" : "partly-night",
      wet: false, snow: false, clear: true, category: "clear",
      wetLevel: 0, rainRate: 0, thunder: false, freezing: false,
    };
  }
  if (value === 3) {
    return {
      label: "Overcast", iconKey: "cloud", wet: false, snow: false,
      clear: false, category: "cloudy", wetLevel: 0, rainRate: 0,
      thunder: false, freezing: false,
    };
  }
  if (value === 45 || value === 48) {
    return {
      label: "Fog", iconKey: "fog", wet: false, snow: false,
      clear: false, category: "cloudy", wetLevel: 0, rainRate: 0,
      thunder: false, freezing: false,
    };
  }

  return {
    label: "Cloudy", iconKey: "cloud", wet: false, snow: false,
    clear: false, category: "cloudy", wetLevel: 0, rainRate: 0,
    thunder: false, freezing: false,
  };
}
