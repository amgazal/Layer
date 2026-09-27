import { classifyWeather, getLatestIndexAtOrBefore, liquidPrecipitationTotal } from './weather';
import { clamp, pooledOffset } from './model';
import { timeMs } from './weather-client';

const STEP = 15 * 60_000;
export const ACTIVITY_ADJUSTMENTS = { waiting: -5, walking: 2, dashing: 6 };
const valid = value => typeof value === 'number' && Number.isFinite(value);
function sampleSeries(series, ms, step, hourly) {
  const times = series?.time;
  if (!times?.length) return null;
  const index = getLatestIndexAtOrBefore(times, ms);
  if (index < 0 || ms > timeMs(times.at(-1))) return null;
  const next = Math.min(index + 1, times.length - 1);
  const elapsed = ms - timeMs(times[index]);
  if (elapsed > step) return null;
  const fraction = next === index ? 0 : elapsed / (timeMs(times[next]) - timeMs(times[index]));
  const read = (key, fallback) => {
    const a = series[key]?.[index], b = series[key]?.[next];
    return valid(a) ? valid(b) ? a + (b-a)*fraction : a : fallback;
  };
  const apparent = read('apparent_temperature');
  const actual = read('temperature_2m');
  if (!valid(apparent) || !valid(actual)) return null;
  // Totals belong to the interval ENDING at the timestamp. Future exposure uses
  // the enclosing interval; only current conditions use completed intervals.
  const intervalIndex = elapsed > 0 ? next : index;
  const probabilityIndex = hourly?.time?.findIndex(t => timeMs(t) >= ms) ?? -1;
  return { time: ms / 1000, actual, apparent, wind: read('wind_speed_10m', 0),
    gust: read('wind_gusts_10m', read('wind_speed_10m', 0)),
    code: series.weather_code?.[index] ?? 3, isDay: series.is_day?.[index] ?? 0,
    precipRate: liquidPrecipitationTotal(series, intervalIndex) * (3_600_000 / step),
    precip: hourly?.precipitation_probability?.[probabilityIndex] ?? 0 };
}
export function buildOuting(wx, startMs, duration, leavingNow = true) {
  if (!wx || !Number.isFinite(startMs) || ![20,60,120,240].includes(duration)) return null;
  const endMs = startMs + duration * 60_000;
  const times = [startMs];
  for (let t = Math.floor(startMs / STEP)*STEP + STEP; t < endMs; t += STEP) times.push(t);
  times.push(endMs);
  const points = times.map((t, i) => i === 0 && leavingNow ? { ...wx.current, time: t/1000 }
    : sampleSeries(wx.minutely, t, STEP, wx.hourly) ?? sampleSeries(wx.hourly, t, 3_600_000, wx.hourly));
  if (points.some(p => !p)) return null; // Never pretend a truncated forecast covers the trip.
  const values = key => points.map(p => p[key]);
  return { points, duration, depart: points[0], apparent: values('apparent'), actual: values('actual'),
    codes: values('code'), daylight: values('isDay'), wind: values('wind'), gust: values('gust'),
    precipRates: values('precipRate'), precip: values('precip'),
    minApparent: Math.round(Math.min(...values('apparent'))), maxApparent: Math.round(Math.max(...values('apparent'))),
    endApparent: Math.round(points.at(-1).apparent), maxPrecip: Math.max(...values('precip')),
    peakRainRate: Math.max(...values('precipRate')), peakWind: Math.max(...values('wind')),
    peakGust: Math.max(...values('gust')), nightBegins: !!points[0].isDay && points.some(p => !p.isDay),
    changeAt: points.find(p => Math.abs(p.apparent-points[0].apparent) >= 6 || p.precipRate >= .05 || p.wind >= points[0].wind+10)?.time,
  };
}
export function personalTemperature(point, model, activity, cycling) {
  const base = point.apparent;
  const cond = classifyWeather(point.code, point.isDay, point.precipRate);
  let effective = base + pooledOffset(model, base) + (ACTIVITY_ADJUSTMENTS[activity] ?? 0);
  effective -= clamp((point.wind - 6) / 14, 0, 1.4) * model.factors.wind;
  if (cond.wet || cond.snow) effective -= model.factors.wet;
  if (point.isDay && cond.clear && base > 66) effective += model.factors.sun;
  if (cycling) effective += base < 55 ? -4 : base < 72 ? -2 : -1;
  return effective;
}
export function outingTemperature(plan, model, activity, cycling) {
  const temperatures = plan.points.map(p => personalTemperature(p, model, activity, cycling));
  // Time-weighted lower quartile: meaningful colder exposure matters, but one
  // extreme sample does not dictate a four-hour outfit. Trapezoidal endpoint
  // weights keep a five-minute remainder from counting as a full interval.
  const weighted = temperatures.map((value, i) => ({ value, weight:
    ((i ? plan.points[i].time-plan.points[i-1].time : 0) +
     (i+1 < plan.points.length ? plan.points[i+1].time-plan.points[i].time : 0))/2 }));
  const total = weighted.reduce((s,p) => s+p.weight,0);
  let accumulated = 0;
  const protective = weighted.slice().sort((a,b) => a.value-b.value).find(p => (accumulated += p.weight) >= total*.25).value;
  const departureWeight = plan.duration <= 20 ? .8 : plan.duration <= 60 ? .5 : .25;
  const representative = departureWeight*temperatures[0] + (1-departureWeight)*protective;
  const cooling = temperatures[0] - protective >= 6;
  const warming = temperatures.at(-1) - temperatures[0] >= 6;
  return { effective: Math.round(representative), departure: Math.round(temperatures[0]),
    protective: Math.round(protective), cooling, warming,
    // For material later cooling, wear the departure outfit and pack insulation.
    wearEffective: cooling && plan.duration >= 60 ? Math.round(temperatures[0]) : Math.round(representative),
    explanation: cooling ? `Feels like ${Math.round(plan.depart.apparent)}° at departure and as low as ${plan.minApparent}° while you’re out. Bring a layer to add later.`
      : warming ? `Feels like ${Math.round(plan.depart.apparent)}° at departure and ${plan.endApparent}° before you return. Start with a layer you can remove.` : null };
}
