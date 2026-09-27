import { rainSignalFromLocation, campusRainConsensus } from './weather';

export const CACHE_KEY = 'layer:wx-cache:v8'; // v7 may contain synthetic weather
export const STALE_MS = 15 * 60_000;
export const MAX_CACHE_MS = 24 * 60 * 60_000;
export const CAMPUS_POINTS = [[42.4534,-76.4735],[42.4603,-76.478],[42.448,-76.463],[42.446,-76.482],[42.461,-76.465]];
export const timeMs = value => typeof value === 'number' ? value * 1000 : Date.parse(value);
const finite = v => typeof v === 'number' && Number.isFinite(v);
export function usableWeather(data) {
  const c = data?.current;
  return !!c && finite(c.actual) && finite(c.apparent) && c.actual >= -80 && c.actual <= 140
    && c.apparent >= -100 && c.apparent <= 160 && Number.isFinite(timeMs(c.time))
    && Array.isArray(data.hourly?.time) && data.hourly.time.length > 0;
}
export function readWeatherCache(raw, now = Date.now()) {
  try {
    const cached = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!finite(cached?.at) || cached.at > now || now - cached.at > MAX_CACHE_MS || !usableWeather(cached.data)) return null;
    if (now - timeMs(cached.data.current.time) > MAX_CACHE_MS) return null;
    return cached;
  } catch { return null; }
}
export function weatherTrust(data, updatedAt, now = Date.now()) {
  if (!usableWeather(data) || !finite(updatedAt)) return 'unavailable';
  const age = Math.max(now - updatedAt, now - timeMs(data.current.time));
  return age > MAX_CACHE_MS ? 'unavailable' : age > STALE_MS ? 'stale' : 'recent';
}
export function precisePoints(coords) {
  const { latitude: lat, longitude: lon, accuracy } = coords ?? {};
  if (![lat, lon, accuracy].every(finite) || accuracy < 0 || accuracy > 500) return null;
  // Cornell/Ithaca only, approximately 8 km from central campus.
  const km = Math.hypot((lat - 42.4534) * 111, (lon + 76.4735) * 82);
  if (km > 8) return null;
  return [[lat,lon],[lat+.006,lon],[lat-.006,lon],[lat,lon+.008],[lat,lon-.008]];
}
export function locateOnce(geolocation = globalThis.navigator?.geolocation) {
  return new Promise(resolve => {
    if (!geolocation) return resolve(null);
    geolocation.getCurrentPosition(p => resolve(precisePoints(p.coords)), () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 8000 });
  });
}
export function forecastUrl(points, probe = false) {
  const params = new URLSearchParams({
    latitude: points.map(p => p[0]).join(','), longitude: points.map(p => p[1]).join(','),
    current: probe ? 'weather_code,precipitation,rain,showers' : 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,rain,showers,is_day',
    minutely_15: probe ? 'weather_code,precipitation,rain' : 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,rain,is_day',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: 'America/New_York', timeformat: 'unixtime',
    past_minutely_15: '2', forecast_minutely_15: probe ? '2' : '96', forecast_days: '2',
  });
  if (!probe) params.set('hourly', 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,precipitation_probability,is_day');
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}
export async function fetchWeather({ points = CAMPUS_POINTS, signal, fetcher = fetch, precise = false } = {}) {
  const read = async url => {
    const response = await fetcher(url, { signal, referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Weather unavailable');
    return response.json();
  };
  const [main, probe] = await Promise.allSettled([read(forecastUrl([points[0]])), read(forecastUrl(points, true))]);
  if (main.status !== 'fulfilled') throw main.reason;
  const data = main.value;
  const c = data.current;
  if (!finite(c?.temperature_2m) || !finite(c?.apparent_temperature)) throw new Error('Invalid weather');
  const primary = rainSignalFromLocation(data);
  // Probability describes the preceding hour, so use the interval containing now.
  const pi = data.hourly?.time?.findIndex(t => timeMs(t) >= timeMs(c.time)) ?? -1;
  const probability = Number(data.hourly?.precipitation_probability?.[pi] ?? 0);
  const locations = probe.status === 'fulfilled' ? (Array.isArray(probe.value) ? probe.value : [probe.value]) : [];
  const signals = locations.map(rainSignalFromLocation);
  signals[0] = primary;
  const consensus = campusRainConsensus(signals, probability);
  const payload = {
    current: { actual: c.temperature_2m, apparent: c.apparent_temperature,
      code: primary.severity ? primary.code : consensus.severity ? consensus.code : c.weather_code,
      wind: c.wind_speed_10m ?? 0, gust: c.wind_gusts_10m ?? c.wind_speed_10m ?? 0,
      precip: probability, precipRate: Math.max(primary.rate, consensus.rate),
      rainScope: consensus.scope, rainSupport: consensus.support, time: c.time, isDay: c.is_day },
    minutely: data.minutely_15 ?? null, hourly: data.hourly, locationLabel: precise ? 'Near you on campus' : 'Campus',
  };
  if (!usableWeather(payload)) throw new Error('Invalid weather');
  return payload; // Never return API metadata: it includes coordinates.
}

export const CORRECTION_MS = 15 * 60_000;
export function activeCorrection(correction, now = Date.now()) {
  return correction && ['rain','snow','dry'].includes(correction.kind)
    && correction.at <= now && now - correction.at < CORRECTION_MS ? correction : null;
}
export function correctCurrent(current, correction, now = Date.now()) {
  const active = activeCorrection(correction, now);
  if (!active || !current) return current;
  return { ...current, code: active.kind === 'rain' ? 61 : active.kind === 'snow' ? 71 : 3,
    precipRate: active.kind === 'rain' ? 0.2 : 0, precip: active.kind === 'dry' ? 0 : current.precip,
    rainScope: 'reported', reported: active.kind };
}
