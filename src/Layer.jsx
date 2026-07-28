import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudFog, CloudSun,
  Wind, Zap, Snowflake, Droplets, Check, Flame, MapPin, RefreshCw,
  Umbrella, ChevronDown, Footprints, Timer, Car, TrendingUp, X, ArrowRight,
  Bike, Clock3, AlertTriangle, UserRound, CircleHelp, Moon, CloudMoon
} from "lucide-react";
import {
  ensureAuth, pullModel, pushModel, pushProfile, logEvent,
  flushOutbox, setCloudPref, subscribeCloud, retryCloud,
  subscribeAuth, upgradeWithEmail,
} from "./lib/sync";

const CAMPUS = {
  name: "Ithaca, NY",
  title: "Cornell University",
  subtitle: "Ithaca campus",
  lat: 42.4534,
  lon: -76.4735,
};

const MODEL_KEY = "layer:model:v5";
const CACHE_KEY = "layer:wx-cache:v6";
const CACHE_TTL = 5 * 60 * 1000;
const WEATHER_REFRESH_MS = 5 * 60 * 1000;
const ACTIVE_RAIN_REFRESH_MS = 2 * 60 * 1000;
const ENABLE_ACCOUNT_UPGRADE = false; // turn on only after sign-in + merge UI is complete
// Open-Meteo is_day drives both automatic night dimming and sun-threat accuracy.

const ASSET_BASE = import.meta.env.BASE_URL;
const BACKGROUNDS = {
  clear: `${ASSET_BASE}backgrounds/clear.webp`,
  cloudy: `${ASSET_BASE}backgrounds/cloudy.webp`,
  rain: `${ASSET_BASE}backgrounds/rain.webp`,
  snow: `${ASSET_BASE}backgrounds/snow.webp`,
};

const CENTERS = { cold: 33, mild: 60, warm: 82 };
const KERNEL = 15;
const STEP_MAX = 4.5;
const PRIOR_N = 3;
const CLAMP = 15;
const FACTOR_CLAMP = 7;
const LEVELS = ["None", "Low", "Mod", "High"];
const START_OFFSETS = [0, 1, 3, 6];
const DURATIONS = [
  { minutes: 20, label: "20 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "Up to 4 hrs" },
  { minutes: 360, label: "5+ hrs" },
];
const durationLabel = (minutes) =>
  DURATIONS.find((d) => d.minutes === minutes)?.label || `${minutes} min`;

const CLIMATES = [
  { key: "tropical", label: "Somewhere hot", note: "Tropical or desert", seed: { cold: -7, mild: -4, warm: 1 } },
  { key: "temperate", label: "Four seasons", note: "Mild winters", seed: { cold: -1, mild: 0, warm: 0 } },
  { key: "cold", label: "Somewhere cold", note: "Real winters", seed: { cold: 4, mild: 2, warm: -2 } },
];
const TOLERANCE = [
  { key: "colder", label: "The cold one", adj: -3 },
  { key: "same", label: "About the same", adj: 0 },
  { key: "warmer", label: "The warm one", adj: 3 },
];

const ACTIVITIES = {
  waiting: { label: "Standing", Icon: Timer, adj: -5, hint: "Stop, platform, queue" },
  walking: { label: "Walking", Icon: Footprints, adj: 2, hint: "10+ min on foot" },
  dashing: { label: "Quick dash", Icon: Car, adj: 6, hint: "Door to car to door" },
};

const EMPTY_MODEL = {
  v: 5,
  seeded: false,
  regime: { cold: { off: 0, n: 0 }, mild: { off: 0, n: 0 }, warm: { off: 0, n: 0 } },
  factors: { wind: 0, wet: 0, sun: 0 },
  history: [],
};

const BANDS = [
  { key: "hot", min: 84, accent: "#E88834", sky: ["#6EA6FF", "#F3B66E"], verdict: "Hot out there", sub: "Keep it light.", layers: [
      { label: "Breathable lightweight top", note: "Choose a loose, airy fabric." },
      { label: "Lightweight bottoms" },
      { label: "Sun protection", note: "Sunglasses, a cap, or shade." },
    ] },
  { key: "warm", min: 74, accent: "#E0A32E", sky: ["#7BB5FF", "#F6C56E"], verdict: "Warm and easy", sub: "One layer works.", layers: [
      { label: "T-shirt or breathable top" },
      { label: "Lightweight bottoms" },
      { label: "Thin layer for indoors", note: "Optional." },
    ] },
  { key: "mild", min: 65, accent: "#7AB560", sky: ["#7BA4CC", "#A8D09E"], verdict: "Comfortable", sub: "No bundling needed.", layers: [
      { label: "T-shirt or long sleeve" },
      { label: "Light sweater or overshirt", note: "Optional." },
    ] },
  { key: "cool", min: 56, accent: "#4AA78D", sky: ["#738FAF", "#89C9B1"], verdict: "A little cool", sub: "Bring a light layer.", layers: [
      { label: "Long sleeve or light sweater" },
      { label: "A light jacket", note: "Easy to carry later." },
    ] },
  { key: "chilly", min: 47, accent: "#35A79B", sky: ["#6E869B", "#7FC6C0"], verdict: "Crisp — layer up", sub: "Looks mild, feels cooler.", layers: [
      { label: "Long sleeve or sweater" },
      { label: "A real jacket", note: "A hoodie alone may not hold." },
    ] },
  { key: "cold", min: 38, accent: "#4F9FD2", sky: ["#7188A1", "#9ABFDB"], verdict: "Properly cold", sub: "Use insulation.", layers: [
      { label: "Long-sleeve shirt" },
      { label: "Sweater or fleece" },
      { label: "A warm coat" },
      { label: "Hat and gloves if you will be outside awhile" },
    ] },
  { key: "veryCold", min: 29, accent: "#5A8EE5", sky: ["#7A89B0", "#B1C7F2"], verdict: "Bundle up", sub: "Close the gaps.", layers: [
      { label: "Thermal or long-sleeve base" },
      { label: "Sweater or fleece" },
      { label: "Insulated winter coat" },
      { label: "Beanie and gloves" },
    ] },
  { key: "frigid", min: -200, accent: "#5E7EDB", sky: ["#818EAF", "#C1D0F0"], verdict: "Serious cold", sub: "Full winter gear.", layers: [
      { label: "Thermal base layer" },
      { label: "Warm sweater or fleece" },
      { label: "Heavy insulated parka" },
      { label: "Hat, gloves, and scarf" },
      { label: "Thick socks and boots" },
    ] },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deepCopy = (v) => JSON.parse(JSON.stringify(v));
const bandFor = (t) => BANDS.find((b) => t >= b.min) || BANDS[BANDS.length - 1];

async function storageGet(key) {
  try {
    if (window.storage?.get) return await window.storage.get(key);
    const value = window.localStorage?.getItem(key);
    return value == null ? null : { value };
  } catch {
    return null;
  }
}

async function storageSet(key, value) {
  try {
    if (window.storage?.set) await window.storage.set(key, value);
    else window.localStorage?.setItem(key, value);
  } catch {}
}

function normalizeModel(raw) {
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

function kernelWeights(t) {
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

function pooledOffset(model, t) {
  const weights = kernelWeights(t);
  return Object.keys(weights).reduce((sum, key) => sum + weights[key] * model.regime[key].off, 0);
}

const totalObservations = (m) => m.regime.cold.n + m.regime.mild.n + m.regime.warm.n;
const confidence = (m) => Math.round((totalObservations(m) / (totalObservations(m) + 4)) * 100);

// Actual rainfall rate (mm in the last hour) → 0 none · 1 light · 2 moderate · 3 heavy.
// Standard meteorological rain-rate bands, so the label matches what you'd feel.
function rainIntensityFromRate(rateMmPerHour) {
  const rate = Math.max(0, Number(rateMmPerHour) || 0);
  if (rate >= 7.5) return 3;
  if (rate >= 2.5) return 2;
  if (rate >= 0.2) return 1;
  return 0;
}

function rateFrom15MinuteTotal(totalMm) {
  return Math.max(0, Number(totalMm) || 0) * 4;
}

function wmoRainSeverity(code) {
  const value = Number(code);
  if ([57, 65, 67, 82, 95, 96, 99].includes(value)) return 3;
  if ([53, 55, 63, 81].includes(value)) return 2;
  if ([51, 56, 61, 66, 80].includes(value)) return 1;
  return 0;
}

function decodeWeather(code, isDay = 1, rainRateMmPerHour = 0) {
  const value = Number(code);
  const daytime = Number(isDay) !== 0;
  const make = (label, Icon, extra = {}) => ({
    label, Icon, wet: false, snow: false, clear: false,
    category: "cloudy", wetLevel: 0, rainRate: 0, thunder: false, ...extra,
  });

  if (value === 0) return daytime
    ? make("Clear", Sun, { clear: true, category: "clear" })
    : make("Clear night", Moon, { clear: true, category: "clear" });
  if (value === 1 || value === 2) return daytime
    ? make("Partly cloudy", CloudSun, { clear: true, category: "clear" })
    : make("Partly cloudy", CloudMoon, { clear: true, category: "clear" });
  if (value === 3) return make("Overcast", Cloud, { category: "cloudy" });
  if (value === 45 || value === 48) return make("Fog", CloudFog, { category: "cloudy" });

  if ((value >= 71 && value <= 77) || (value >= 85 && value <= 86)) {
    const heavy = value === 75 || value === 86;
    const moderate = value === 73;
    return make(
      heavy ? "Heavy snow" : moderate ? "Snow" : "Light snow",
      CloudSnow,
      { snow: true, category: "snow", wetLevel: heavy ? 3 : moderate ? 2 : 1 },
    );
  }

  const thunder = value >= 95 && value <= 99;
  const drizzle = value >= 51 && value <= 57;
  const measured = rainIntensityFromRate(rainRateMmPerHour);
  // A short-range model can lag a rapidly forming shower. Measured/modelled
  // 15-minute precipitation therefore counts as rain even when the WMO code
  // still says overcast.
  const liquid = measured > 0 || drizzle || (value >= 61 && value <= 67) || (value >= 80 && value <= 82) || thunder;
  if (liquid) {
    const intensity = Math.max(wmoRainSeverity(value), measured);
    const freezing = value === 56 || value === 57 || value === 66 || value === 67;
    const hail = value === 96 || value === 99;

    let label;
    if (hail) label = "Thunderstorm with hail";
    else if (thunder) label = "Thunderstorm";
    else if (freezing) label = intensity >= 3 ? "Heavy freezing rain" : "Freezing rain";
    else if (intensity >= 3) label = "Heavy rain";
    else if (intensity === 2) label = drizzle ? "Dense drizzle" : "Rain";
    else label = drizzle ? "Drizzle" : "Light rain";

    return make(label, thunder ? Zap : intensity >= 2 ? CloudRain : CloudDrizzle, {
      wet: true,
      category: "rain",
      wetLevel: Math.max(1, intensity),
      rainRate: Math.max(0, Number(rainRateMmPerHour) || 0),
      thunder,
      freezing,
    });
  }

  return make("Cloudy", Cloud, { category: "cloudy" });
}

function threatsFor({ effective, wind, gust, cond, precip, peakRainRate, isDay }) {
  const cold = effective < 25 ? 3 : effective < 38 ? 2 : effective < 50 ? 1 : 0;
  const windExposure = Math.max(Number(wind) || 0, (Number(gust) || 0) * 0.75);
  const windLevel = windExposure >= 24 ? 3 : windExposure >= 15 ? 2 : windExposure >= 8 ? 1 : 0;
  // Two signals: what's measured falling right now (cond.wetLevel, from actual
  // mm) and the forecast chance (precip %). Take the stronger, so active heavy
  // rain shows High even when the hourly probability lags behind reality.
  const wetFromCond = cond.wetLevel || (cond.snow ? 2 : cond.wet ? 2 : 0);
  const wetFromRate = rainIntensityFromRate(peakRainRate);
  const wetFromProb = precip >= 70 ? 3 : precip >= 40 ? 2 : precip >= 20 ? 1 : 0;
  const wet = Math.max(wetFromCond, wetFromRate, wetFromProb);
  const threats = [
    { key: "cold", label: "Cold", Icon: Snowflake, level: cold, blame: "The cold itself got me" },
    { key: "wind", label: "Wind", Icon: Wind, level: windLevel, blame: "The wind cut through" },
    { key: "wet", label: "Wet", Icon: Droplets, level: wet, blame: "I got wet" },
  ];

  // At night there is no direct-sun exposure to display or calibrate.
  if (isDay) {
    const sun = cond.clear && effective >= 82 ? 3 : cond.clear && effective >= 72 ? 2 : cond.clear ? 1 : 0;
    threats.push({ key: "sun", label: "Sun", Icon: Sun, level: sun, blame: "The sun was punishing" });
  }
  return threats;
}

function extrasFor(threats, cond, peakRainRate = 0) {
  const out = [];
  const lv = (k) => threats.find((t) => t.key === k)?.level ?? 0;
  if (cond.snow) out.push({ Icon: Snowflake, text: "Waterproof boots — the ground will soak through." });
  else if (cond.wetLevel >= 3 || rainIntensityFromRate(peakRainRate) >= 3) out.push({ Icon: Umbrella, text: "Heavy rain — use a waterproof shell; an umbrella alone may not be enough." });
  else if (lv("wet") >= 2) out.push({ Icon: Umbrella, text: "Take a shell or umbrella." });
  if (lv("wind") >= 2) out.push({ Icon: Wind, text: "Make the outer layer wind resistant." });
  if (lv("sun") >= 2) out.push({ Icon: Sun, text: "Sunglasses and sunscreen if you’ll be out a while." });
  return out;
}

function asDate(value) {
  return typeof value === "number" ? new Date(value * 1000) : new Date(value);
}

function getClosestIndex(times, targetMs) {
  if (!times?.length) return 0;
  let best = 0;
  let minDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(asDate(times[i]).getTime() - targetMs);
    if (diff < minDiff) {
      minDiff = diff;
      best = i;
    }
  }
  return best;
}

function probabilityAt(hourly, targetMs) {
  if (!hourly?.time?.length || !Array.isArray(hourly.precipitation_probability)) return 0;
  return Number(hourly.precipitation_probability[getClosestIndex(hourly.time, targetMs)] ?? 0);
}

function conditionWindow(hourly, startIndex, durationMinutes) {
  const hours = Math.max(1, Math.ceil(durationMinutes / 60));
  const end = Math.min(hourly.time.length - 1, startIndex + hours);
  const slice = (key, fallback = []) => Array.isArray(hourly[key]) ? hourly[key].slice(startIndex, end + 1) : fallback;
  const apparent = slice("apparent_temperature");
  const actual = slice("temperature_2m");
  const wind = slice("wind_speed_10m", actual.map(() => 0));
  const gust = slice("wind_gusts_10m", wind);
  const precip = slice("precipitation_probability", actual.map(() => 0));
  const precipRates = slice("precipitation", actual.map(() => 0)).map((value) => Math.max(0, Number(value) || 0));
  const codes = slice("weather_code", actual.map(() => 3));
  const daylight = slice("is_day", hourly.time.slice(startIndex, end + 1).map((value) => {
    const hour = asDate(value).getHours();
    return hour >= 7 && hour < 20 ? 1 : 0;
  }));
  return {
    startIndex,
    endIndex: end,
    apparent,
    actual,
    wind,
    gust,
    precip,
    precipRates,
    codes,
    daylight,
    depart: {
      actual: Math.round(actual[0]),
      apparent: Math.round(apparent[0]),
      wind: Math.round(wind[0] ?? 0),
      gust: Math.round(gust[0] ?? wind[0] ?? 0),
      precip: Math.round(precip[0] ?? 0),
      precipRate: Number(precipRates[0] ?? 0),
      code: codes[0],
      time: hourly.time[startIndex],
      isDay: Number(daylight[0] ?? 1),
    },
    minApparent: Math.round(Math.min(...apparent)),
    maxApparent: Math.round(Math.max(...apparent)),
    endApparent: Math.round(apparent[apparent.length - 1]),
    maxPrecip: Math.round(Math.max(...precip)),
    endPrecip: Math.round(precip[precip.length - 1] ?? 0),
    peakRainRate: Math.max(0, ...precipRates),
  };
}

function conditionWindow15(minutely, hourly, startMs, durationMinutes) {
  if (!minutely?.time?.length) return null;
  const startIndex = getClosestIndex(minutely.time, startMs);
  const endMs = startMs + durationMinutes * 60 * 1000;
  let endIndex = startIndex;
  while (endIndex + 1 < minutely.time.length && asDate(minutely.time[endIndex + 1]).getTime() <= endMs + 7.5 * 60 * 1000) {
    endIndex += 1;
  }
  if (endIndex === startIndex && endIndex + 1 < minutely.time.length) endIndex += 1;

  const slice = (key, fallback = []) => Array.isArray(minutely[key]) ? minutely[key].slice(startIndex, endIndex + 1) : fallback;
  const actual = slice("temperature_2m");
  const apparent = slice("apparent_temperature", actual);
  const wind = slice("wind_speed_10m", actual.map(() => 0));
  const gust = slice("wind_gusts_10m", wind);
  const precipitation15 = slice("precipitation", actual.map(() => 0));
  const precipRates = precipitation15.map(rateFrom15MinuteTotal);
  const codes = slice("weather_code", actual.map(() => 3));
  const daylight = slice("is_day", actual.map((_, index) => {
    const hour = asDate(minutely.time[startIndex + index]).getHours();
    return hour >= 7 && hour < 20 ? 1 : 0;
  }));
  const precip = minutely.time.slice(startIndex, endIndex + 1).map((time) => probabilityAt(hourly, asDate(time).getTime()));

  return {
    startIndex,
    endIndex,
    apparent,
    actual,
    wind,
    gust,
    precip,
    precipRates,
    codes,
    daylight,
    depart: {
      actual: Math.round(actual[0]),
      apparent: Math.round(apparent[0]),
      wind: Math.round(wind[0] ?? 0),
      gust: Math.round(gust[0] ?? wind[0] ?? 0),
      precip: Math.round(precip[0] ?? 0),
      precipRate: Number(precipRates[0] ?? 0),
      code: codes[0],
      time: minutely.time[startIndex],
      isDay: Number(daylight[0] ?? 1),
    },
    minApparent: Math.round(Math.min(...apparent)),
    maxApparent: Math.round(Math.max(...apparent)),
    endApparent: Math.round(apparent[apparent.length - 1]),
    maxPrecip: Math.round(Math.max(...precip)),
    endPrecip: Math.round(precip[precip.length - 1] ?? 0),
    peakRainRate: Math.max(0, ...precipRates),
  };
}

function formatTime(dateLike) {
  return asDate(dateLike).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

function humanDate(dateLike) {
  return asDate(dateLike).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" });
}

function garmentCategory(label) {
  const value = String(label || "").toLowerCase();
  if (/boot|shoe|sock/.test(value)) return "SHOES";
  if (/coat|jacket|parka|shell/.test(value)) return "OUTER";
  if (/sweater|fleece|hoodie|layer|thermal|overshirt/.test(value)) return "LAYER";
  if (/bottom|short|pant|skirt/.test(value)) return "LOWER";
  if (/hat|glove|scarf|cap|sunglass|protection/.test(value)) return "EXTRA";
  return "TOP";
}

function weatherSceneKey(rawCode) {
  const code = Number(rawCode);
  if (code === 0 || code === 1 || code === 2) return "clear";
  if (code === 3 || code === 45 || code === 48) return "cloudy";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) return "rain";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "snow";
  return "cloudy";
}

function scenicByCode(code) {
  const key = weatherSceneKey(code);
  return { key, src: BACKGROUNDS[key] };
}


function LoadingScreen() {
  return (
    <div
      className="lyr weather-cloudy loading-screen"
      style={{ "--accent": "#E0A32E" }}
    >
      <style>{css}</style>
      <div
        className="scene-image"
        style={{ backgroundImage: `url(${BACKGROUNDS.cloudy})` }}
        aria-hidden="true"
      />
      <div className="backdrop" />
      <div className="loading-content" role="status" aria-live="polite">
        <span className="loading-brand">Layer</span>
        <RefreshCw className="loading-spinner" size={24} strokeWidth={2.2} />
        <span>Reading the weather on campus…</span>
      </div>
    </div>
  );
}

function Onboarding({ onDone }) {
  const [climate, setClimate] = useState(null);
  const [tol, setTol] = useState(null);
  return (
    <div className="lyr ob-wrap">
      <style>{css}</style>
      <div className="ob-card glass">
        <div className="ob-mark">Layer</div>
        <h1 className="ob-h">Cold is personal.</h1>
        <p className="ob-p">
          Two quick questions so your first recommendation lands closer to how weather actually feels to you.
        </p>
        <div className="ob-q">
          <span className="ob-l">Where did you spend most of your life?</span>
          <div className="ob-opts">
            {CLIMATES.map((c) => (
              <button key={c.key} className={`ob-opt ${climate === c.key ? "on" : ""}`} onClick={() => setClimate(c.key)}>
                <span className="ob-opt-l">{c.label}</span>
                <span className="ob-opt-n">{c.note}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="ob-q">
          <span className="ob-l">In a room where everyone’s comfortable, you’re…</span>
          <div className="ob-opts ob-opts-row">
            {TOLERANCE.map((t) => (
              <button key={t.key} className={`ob-opt ${tol === t.key ? "on" : ""}`} onClick={() => setTol(t.key)}>
                <span className="ob-opt-l">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="ob-privacy">
          Layer saves your setup answers and outfit feedback to improve your
          recommendations. It uses an anonymous identifier — no name, email, or
          precise location is collected.
        </div>
        <div className="ob-actions">
          <button className="ob-go" disabled={!climate || !tol} onClick={() => onDone(climate, tol, true)}>
            Continue with cloud backup <ArrowRight size={16} strokeWidth={2.6} />
          </button>
          <button className="ob-secondary" disabled={!climate || !tol} onClick={() => onDone(climate, tol, false)}>
            Use only on this device
          </button>
        </div>
        <p className="ob-note">“Only on this device” keeps the full app and turns cloud backup off.</p>
      </div>
    </div>
  );
}

/**
 * The "keep your calibration" prompt. Non-blocking, dismissible, and only ever
 * shown once cloud backup is actually working, the user is still anonymous, and
 * they've trained the model enough that saving it is obviously worth it.
 */
function AccountUpgrade({ ratingCount }) {
  const [authStatus, setAuthStatus] = useState("none");
  const [cloud, setCloud] = useState("local");
  const [dismissed, setDismissed] = useState(() => {
    try { return window.localStorage?.getItem("layer:upgrade-dismissed") === "1"; } catch { return false; }
  });
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent | error
  const [err, setErr] = useState("");

  useEffect(() => subscribeAuth((a) => setAuthStatus(a.status)), []);
  useEffect(() => subscribeCloud(setCloud), []);

  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage?.setItem("layer:upgrade-dismissed", "1"); } catch {}
  };

  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) { setErr("Enter a valid email address."); setState("error"); return; }
    setState("sending"); setErr("");
    const { ok, error } = await upgradeWithEmail(email.trim());
    if (ok) setState("sent");
    else { setErr(error || "Something went wrong."); setState("error"); }
  };

  const eligible = cloud === "active" && authStatus === "anonymous" && ratingCount >= 4 && !dismissed;
  if (state === "sent") {
    return (
      <div className="card upgrade-card">
        <div className="upgrade-sent">
          <Check size={18} strokeWidth={2.6} />
          <span>Check your email to confirm the identity. Cross-device sign-in will be enabled in a later account update.</span>
        </div>
      </div>
    );
  }
  if (!eligible) return null;

  return (
    <div className="card upgrade-card">
      <button className="upgrade-x" onClick={dismiss} aria-label="Dismiss">
        <X size={15} strokeWidth={2.4} />
      </button>
      <div className="upgrade-h">Keep your calibration</div>
      <p className="upgrade-p">
        You’ve trained Layer {ratingCount} times. Attach an email to make this anonymous
        profile permanent. Cross-device sign-in is being completed separately.
      </p>
      <div className="upgrade-row">
        <input
          className="upgrade-input"
          type="email" inputMode="email" placeholder="you@example.com"
          value={email} onChange={(e) => { setEmail(e.target.value); if (state === "error") setState("idle"); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <button className="upgrade-go" onClick={submit} disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Save"}
        </button>
      </div>
      {state === "error" && <div className="upgrade-err">{err}</div>}
    </div>
  );
}

export default function Layer() {
  const mounted = useRef(true);
  const [model, setModel] = useState(deepCopy(EMPTY_MODEL));
  const [ready, setReady] = useState(false);
  const [wx, setWx] = useState(null);
  const [wxState, setWxState] = useState("loading");
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState(null);
  const [activity, setActivity] = useState("walking");
  const [planOpen, setPlanOpen] = useState(false);
  const [startOffset, setStartOffset] = useState(0);
  const [duration, setDuration] = useState(60);
  const [cycling, setCycling] = useState(false);
  const [askBlame, setAskBlame] = useState(null);
  const [toast, setToast] = useState(null);
  const [followed, setFollowed] = useState("yes");
  const [showModel, setShowModel] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [cloudState, setCloudState] = useState("connecting");
  const [cloudActionBusy, setCloudActionBusy] = useState(false);

  useEffect(() => () => { mounted.current = false; }, []);

  // Reflect background sync status in the UI (device-only | local | connecting
  // | active | unavailable) so calibration storage is never a mystery.
  useEffect(() => subscribeCloud((s) => { if (mounted.current) setCloudState(s); }), []);

  useEffect(() => {
    const updateClock = () => setNow(new Date());
    updateClock();
    const id = window.setInterval(updateClock, 30000);
    return () => window.clearInterval(id);
  }, []);

  const persist = useCallback(async (next) => {
    await storageSet(MODEL_KEY, JSON.stringify(next));
  }, []);

  const commit = useCallback((next) => {
    setModel(next);
    persist(next);                              // local-first: write immediately
    pushModel(next, totalObservations(next));   // background cloud mirror (no-op if disabled)
  }, [persist]);

  useEffect(() => {
    (async () => {
      // 1) Local is the source of truth for first paint — never blocks on network.
      const saved = await storageGet(MODEL_KEY);
      let localModel = null;
      if (saved?.value) {
        try { localModel = normalizeModel(JSON.parse(saved.value)); setModel(localModel); }
        catch {}
      }
      if (mounted.current) setReady(true);

      // 2) In the background, mint the anonymous session and reconcile with cloud.
      ensureAuth();
      flushOutbox();  // resend any feedback events queued while offline last time
      try {
        const cloud = await pullModel();
        if (!mounted.current) return;
        if (cloud?.model) {
          const cloudModel = normalizeModel(cloud.model);
          const localObs = localModel ? totalObservations(localModel) : -1;
          const cloudObs = totalObservations(cloudModel);
          // Adopt cloud only if we have nothing local yet, or cloud has learned
          // more (e.g. this is a new device after signing in). Otherwise push
          // our richer local copy up so the cloud catches up.
          if (!localModel || !localModel.seeded || cloudObs > localObs) {
            setModel(cloudModel);
            await storageSet(MODEL_KEY, JSON.stringify(cloudModel));
          } else {
            pushModel(localModel, localObs);
          }
        } else if (localModel?.seeded) {
          pushModel(localModel, totalObservations(localModel));
        }
      } catch { /* offline: local model stands */ }
    })();
  }, []);

  useEffect(() => {
    Object.values(BACKGROUNDS).forEach((src) => {
      const image = new Image();
      image.src = src;
    });
  }, []);

  const seed = useCallback((climateKey, tolKey, allowCloud = true) => {
    // Record the consent choice BEFORE any model change triggers a sync.
    setCloudPref(allowCloud);
    setCloudState(allowCloud ? "connecting" : "device-only");
    const climate = CLIMATES.find((x) => x.key === climateKey);
    const tol = TOLERANCE.find((x) => x.key === tolKey);
    const next = deepCopy(EMPTY_MODEL);
    next.seeded = true;
    for (const k of ["cold", "mild", "warm"]) {
      next.regime[k].off = clamp(climate.seed[k] + tol.adj, -CLAMP, CLAMP);
      next.regime[k].n = 0.6;
    }
    commit(next);
    pushProfile({ climate: climateKey, tolerance: tolKey });
  }, [commit]);

  const handleCloudAction = useCallback(async () => {
    if (cloudActionBusy) return;

    if (cloudState === "active") {
      setCloudPref(false);
      setCloudState("device-only");
      return;
    }

    if (cloudState === "connecting") return;

    if (cloudState === "local") return; // deployment has no Supabase config

    setCloudActionBusy(true);
    setCloudPref(true);
    setCloudState("connecting");
    try {
      const connected = await retryCloud();
      if (!connected) return;

      const cloud = await pullModel();
      if (cloud?.model) {
        const cloudModel = normalizeModel(cloud.model);
        const localObs = totalObservations(model);
        const cloudObs = totalObservations(cloudModel);
        if (!model.seeded || cloudObs > localObs) {
          setModel(cloudModel);
          await storageSet(MODEL_KEY, JSON.stringify(cloudModel));
        } else {
          pushModel(model, localObs);
        }
      } else if (model.seeded) {
        pushModel(model, totalObservations(model));
      }
      flushOutbox();
    } finally {
      setCloudActionBusy(false);
    }
  }, [cloudActionBusy, cloudState, model]);

  const loadWeather = useCallback(async (force = false) => {
    let cached = null;
    if (!force) {
      const stored = await storageGet(CACHE_KEY);
      if (stored?.value) {
        try {
          const parsed = JSON.parse(stored.value);
          if (Date.now() - parsed.at < CACHE_TTL) {
            cached = parsed;
            if (mounted.current) {
              setWx(parsed.data);
              setWeatherUpdatedAt(parsed.at);
              setWxState("cached");
            }
          }
        } catch {}
      }
    }

    if (!cached && mounted.current) setWxState("loading");

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${CAMPUS.lat}&longitude=${CAMPUS.lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,rain,showers,precipitation_probability,is_day` +
      `&minutely_15=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,rain,showers,is_day` +
      `&hourly=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,precipitation_probability,is_day` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York&timeformat=unixtime&forecast_minutely_15=96&forecast_days=2`;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`weather request failed (${res.status})`);
      const data = await res.json();

      const currentMs = typeof data.current?.time === "number" ? data.current.time * 1000 : Date.now();
      const minuteIndex = data.minutely_15?.time?.length ? getClosestIndex(data.minutely_15.time, currentMs) : -1;
      const minutelyPrecip = minuteIndex >= 0 ? Number(data.minutely_15.precipitation?.[minuteIndex] ?? 0) : null;
      const rainRate = minutelyPrecip == null
        ? rateFrom15MinuteTotal(data.current?.precipitation ?? 0)
        : rateFrom15MinuteTotal(minutelyPrecip);
      const currentCode = minuteIndex >= 0
        ? Number(data.minutely_15.weather_code?.[minuteIndex] ?? data.current.weather_code)
        : Number(data.current.weather_code);
      const currentIsDay = minuteIndex >= 0
        ? Number(data.minutely_15.is_day?.[minuteIndex] ?? data.current.is_day ?? 1)
        : Number(data.current.is_day ?? 1);
      const currentWind = minuteIndex >= 0
        ? Number(data.minutely_15.wind_speed_10m?.[minuteIndex] ?? data.current.wind_speed_10m ?? 0)
        : Number(data.current.wind_speed_10m ?? 0);
      const currentGust = minuteIndex >= 0
        ? Number(data.minutely_15.wind_gusts_10m?.[minuteIndex] ?? data.current.wind_gusts_10m ?? currentWind)
        : Number(data.current.wind_gusts_10m ?? currentWind);

      const payload = {
        current: {
          actual: Math.round(data.current.temperature_2m),
          apparent: Math.round(data.current.apparent_temperature),
          code: currentCode,
          wind: Math.round(currentWind),
          gust: Math.round(currentGust),
          precip: Math.round(data.current.precipitation_probability ?? 0),
          precipRate: rainRate,
          time: data.current.time,
          isDay: currentIsDay,
        },
        minutely: data.minutely_15 ?? null,
        hourly: data.hourly,
      };
      const fetchedAt = Date.now();
      if (!mounted.current) return;
      setWx(payload);
      setWeatherUpdatedAt(fetchedAt);
      setWxState("live");
      await storageSet(CACHE_KEY, JSON.stringify({ at: fetchedAt, data: payload }));
    } catch (error) {
      if (!mounted.current) return;
      if (cached) {
        setWxState("cached");
        return;
      }

      const fallbackNow = new Date();
      const hourlyTimes = Array.from({ length: 12 }, (_, i) => new Date(fallbackNow.getTime() + i * 60 * 60 * 1000).toISOString());
      setWx({
        current: { actual: 71, apparent: 72, code: 2, wind: 9, gust: 12, precip: 10, precipRate: 0, time: fallbackNow.toISOString(), isDay: fallbackNow.getHours() >= 7 && fallbackNow.getHours() < 20 ? 1 : 0 },
        minutely: null,
        hourly: {
          time: hourlyTimes,
          temperature_2m: [71, 72, 73, 74, 75, 74, 73, 72, 70, 68, 67, 66],
          apparent_temperature: [72, 73, 74, 75, 76, 75, 74, 73, 71, 69, 68, 67],
          wind_speed_10m: [9, 10, 11, 10, 9, 8, 8, 8, 9, 10, 9, 8],
          wind_gusts_10m: [12, 14, 15, 14, 13, 12, 12, 12, 14, 15, 14, 12],
          precipitation_probability: [10, 8, 6, 5, 5, 5, 10, 12, 15, 16, 14, 12],
          precipitation: hourlyTimes.map(() => 0),
          weather_code: [2, 2, 2, 1, 1, 2, 2, 3, 3, 3, 2, 2],
          is_day: hourlyTimes.map((value) => { const hour = asDate(value).getHours(); return hour >= 7 && hour < 20 ? 1 : 0; }),
        },
      });
      setWeatherUpdatedAt(Date.now());
      setWxState("offline");
      console.warn("[weather] using sample data:", error?.message || error);
    }
  }, []);

  useEffect(() => { loadWeather(); }, [loadWeather]);


  useEffect(() => {
    const current = wx?.current;
    const currentCond = current
      ? decodeWeather(current.code, current.isDay, current.precipRate)
      : null;
    const intervalMs = currentCond?.wet ? ACTIVE_RAIN_REFRESH_MS : WEATHER_REFRESH_MS;
    const id = window.setInterval(() => loadWeather(true), intervalMs);
    return () => window.clearInterval(id);
  }, [loadWeather, wx?.current?.code, wx?.current?.precipRate, wx?.current?.isDay]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      const age = weatherUpdatedAt ? Date.now() - weatherUpdatedAt : Infinity;
      if (age > 90 * 1000) loadWeather(true);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [loadWeather, weatherUpdatedAt]);

  const outingStart = useMemo(
    () => new Date(now.getTime() + startOffset * 60 * 60 * 1000),
    [now, startOffset]
  );

  const outingEnd = useMemo(
    () => new Date(outingStart.getTime() + duration * 60 * 1000),
    [outingStart, duration]
  );

  const plan = useMemo(() => {
    if (!wx?.hourly?.time?.length) return null;
    const startMs = outingStart.getTime();
    const minutePlan = conditionWindow15(wx.minutely, wx.hourly, startMs, duration);
    const hourlyIndex = getClosestIndex(wx.hourly.time, startMs);
    const windowPlan = minutePlan ?? conditionWindow(wx.hourly, hourlyIndex, duration);

    if (startOffset === 0 && wx.current) {
      const apparentValues = [wx.current.apparent, ...windowPlan.apparent].filter(Number.isFinite);
      const rainRates = [wx.current.precipRate, ...(windowPlan.precipRates ?? [])].filter(Number.isFinite);
      return {
        ...windowPlan,
        depart: {
          ...windowPlan.depart,
          actual: wx.current.actual,
          apparent: wx.current.apparent,
          wind: wx.current.wind,
          gust: wx.current.gust ?? windowPlan.depart.gust ?? wx.current.wind,
          precip: wx.current.precip,
          precipRate: Number(wx.current.precipRate ?? windowPlan.depart.precipRate ?? 0),
          code: wx.current.code,
          time: now.toISOString(),
          isDay: Number(wx.current.isDay ?? windowPlan.depart.isDay ?? 1),
        },
        minApparent: Math.round(Math.min(...apparentValues)),
        maxApparent: Math.round(Math.max(...apparentValues)),
        peakRainRate: Math.max(0, ...rainRates),
      };
    }

    return windowPlan;
  }, [wx, outingStart, duration, startOffset, now]);

  const result = useMemo(() => {
    if (!plan) return null;
    const isDay = Number(plan.depart.isDay ?? 1) !== 0;
    const cond = decodeWeather(plan.depart.code, isDay ? 1 : 0, plan.depart.precipRate);
    const base = plan.depart.apparent;
    let eff = base + pooledOffset(model, base);
    const windIntensity = clamp((plan.depart.wind - 6) / 14, 0, 1.4);
    eff -= windIntensity * model.factors.wind;
    if (cond.wet || cond.snow) eff -= model.factors.wet;
    if (isDay && cond.clear && base > 66) eff += model.factors.sun;
    eff += ACTIVITIES[activity].adj;
    if (cycling) eff += base < 55 ? -4 : base < 72 ? -2 : -1;

    const effective = Math.round(eff);
    const baseBand = bandFor(effective);
    const band = {
      ...baseBand,
      layers: isDay
        ? baseBand.layers
        : baseBand.layers.filter((layer) => !/sun protection|sunglasses|shade/i.test(layer.label)),
    };
    const threats = threatsFor({
      effective,
      wind: plan.depart.wind + (cycling ? 6 : 0),
      gust: plan.depart.gust + (cycling ? 6 : 0),
      cond,
      precip: plan.maxPrecip,
      peakRainRate: plan.peakRainRate,
      isDay,
    });
    const personalShift = Math.round(eff - base);
    const tempDelta = Math.round(plan.endApparent - plan.depart.apparent);
    const laterConditions = plan.codes.slice(1).map((code, index) => decodeWeather(code, plan.daylight?.[index + 1] ?? 1, plan.precipRates?.[index + 1] ?? 0));
    const snowSoon = !cond.snow && laterConditions.some((condition) => condition.snow);
    const heavyRainSoon = !cond.wet && !snowSoon && (
      laterConditions.some((condition) => condition.wetLevel >= 3) ||
      rainIntensityFromRate(plan.peakRainRate) >= 3
    );
    const rainSoon = !cond.wet && !snowSoon && !heavyRainSoon && (
      laterConditions.some((condition) => condition.wet) || plan.maxPrecip >= 45
    );

    const whyLines = [];
    if (personalShift !== 0) {
      whyLines.push(`The official feels-like reading is ${base}°, and your profile adjusts it to ${effective}°.`);
    } else {
      whyLines.push(`The official feels-like reading is ${base}° for this outing.`);
    }

    if (activity === "waiting") {
      whyLines.push("Standing still produces less body heat, so the recommendation runs warmer.");
    } else if (activity === "walking") {
      whyLines.push("Walking adds some body heat, so the recommendation avoids unnecessary layers.");
    } else {
      whyLines.push("This is a short dash, so the recommendation prioritizes quick comfort over extra layers.");
    }

    if (cycling) {
      whyLines.push("Cycling increases wind exposure, so the outer layer matters more.");
    } else if (plan.depart.wind >= 12) {
      whyLines.push(`Wind is around ${plan.depart.wind} mph, which can make exposed areas feel cooler.`);
    } else if (cond.wet || plan.depart.precip >= 30) {
      whyLines.push("Wet conditions increase heat loss, so a water-resistant layer is more useful.");
    } else if (isDay && cond.clear && base >= 72) {
      whyLines.push("Direct sun can add warmth, especially during a longer walk.");
    } else if (duration >= 60) {
      whyLines.push(`The recommendation covers your time outside (${durationLabel(duration).toLowerCase()}).`);
    }

    return {
      effective,
      band,
      cond,
      threats,
      extras: extrasFor(threats, cond, plan.peakRainRate),
      personalShift,
      rangeText: `${plan.minApparent}°–${plan.maxApparent}°`,
      tempDelta,
      significantTempChange: Math.abs(tempDelta) >= 6,
      rainSoon,
      heavyRainSoon,
      snowSoon,
      peakPrecip: plan.maxPrecip,
      peakRainRate: plan.peakRainRate,
      whyLines: whyLines.slice(0, 3),
      cycling,
      isDay,
    };
  }, [plan, model, activity, cycling, duration]);

  const metric = useMemo(() => {
    const usable = model.history.filter((h) => h.followed !== "no");
    if (usable.length < 3) return null;
    const rate = (arr) => arr.length ? Math.round((arr.filter((x) => x.outcome === "right").length / arr.length) * 100) : null;
    return {
      now: rate(usable.slice(-10)),
      then: rate(usable.slice(0, Math.min(5, Math.max(1, usable.length - 5)))),
      n: usable.length,
      spark: usable.slice(-12),
    };
  }, [model.history]);

  const applyFeedback = useCallback((direction, blameKey) => {
    if (!plan || !result) return;
    const next = deepCopy(model);
    next.history = [...next.history, {
      at: Date.now(),
      apparent: plan.depart.apparent,
      effective: result.effective,
      activity,
      followed,
      outcome: direction === 0 ? "right" : direction < 0 ? "cold" : "warm",
      blame: blameKey || null,
    }].slice(-80);

    if (direction !== 0 && followed !== "no") {
      const weights = kernelWeights(plan.depart.apparent);
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
        const sign = blameKey === "sun" ? 1 : -1;
        next.factors[blameKey] = clamp((next.factors[blameKey] ?? 0) + sign * direction * STEP_MAX * alpha * toFactor * reliability, -FACTOR_CLAMP, FACTOR_CLAMP);
      }
    }

    commit(next);

    // Append to the cloud research log — richer than the trimmed local history,
    // and recorded for every outcome including "didn't follow".
    logEvent({
      apparent: plan.depart.apparent,
      effective: result.effective,
      actual: plan.depart.actual,
      wind: plan.depart.wind,
      precip: plan.depart.precip,
      condition: result.cond.label,
      weather_code: plan.depart.code,
      is_day: (plan.depart.isDay ?? wx?.current?.isDay ?? 1) !== 0,
      activity,
      start_offset: startOffset,
      duration,
      cycling,
      band: result.band.key,
      followed,
      outcome: direction === 0 ? "right" : direction < 0 ? "cold" : "warm",
      blame: blameKey || null,
    });

    setAskBlame(null);
    setToast(
      followed === "no"
        ? "Logged, but I did not retrain the model because you did not follow the recommendation."
        : direction === 0
          ? "Locked in — I’ll keep reading days like this similarly."
          : blameKey && blameKey !== "cold"
            ? `Noted — I’ll weight ${blameKey === "wet" ? "rain" : blameKey} more for you.`
            : direction < 0
              ? "Got it — I’ll call the next one warmer."
              : "Got it — I’ll lighten the next call."
    );
  }, [plan, result, model, activity, followed, commit, startOffset, duration, cycling, wx]);

  const onFeedback = (kind) => {
    if (kind === "right") applyFeedback(0, null);
    else setAskBlame(kind);
  };

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(id);
  }, [toast]);

  if (!ready) return <LoadingScreen />;
  if (!model.seeded) return <Onboarding onDone={seed} />;
  if (!plan || !result) return <LoadingScreen />;

  const cond = result.cond;
  const ConditionIcon = cond.Icon;
  const liveWeatherCode = wx?.current?.code ?? plan.depart.code ?? 3;
  const liveIsDay = Number(wx?.current?.isDay ?? plan.depart.isDay ?? 1) !== 0;
  const liveCond = decodeWeather(
    liveWeatherCode,
    liveIsDay ? 1 : 0,
    Number(wx?.current?.precipRate ?? 0),
  );
  const scene = scenicByCode(liveWeatherCode);
  const todayText = humanDate(now);
  const timeText = formatTime(now);
  const accent = result.band.accent;
  const ratingCount = model.history.length;
  const learningProgress = Math.min(95, Math.round((ratingCount / (ratingCount + 4)) * 100));
  const learningLabel = ratingCount === 0 ? "Starting profile" : `${learningProgress}% learned`;
  const planningSummary = `${startOffset === 0 ? "Leaving now" : `Leaving ${formatTime(outingStart)}`} • ${DURATIONS.find((d) => d.minutes === duration)?.label || `${duration} min`} outside${cycling ? " • Cycling" : ""}`;
  const weatherAgeMinutes = weatherUpdatedAt == null ? null : Math.max(0, Math.floor((now.getTime() - weatherUpdatedAt) / 60000));
  const weatherAgeText = weatherAgeMinutes == null ? "" : weatherAgeMinutes < 1 ? "Updated now" : `Updated ${weatherAgeMinutes} min ago`;

  return (
    <div
      className={`lyr weather-${scene.key} rain-severity-${liveCond.wetLevel}${liveCond.thunder ? " thunder-active" : ""}${liveIsDay ? "" : " night-mode"}`}
      data-weather-scene={scene.key}
      style={{ "--accent": accent }}
    >
      <style>{css}</style>
      <div
        key={scene.key}
        className="scene-image"
        style={{ backgroundImage: `url(${scene.src})` }}
        aria-hidden="true"
      />
      <div className="backdrop" />
      {liveCond.category === "rain" && (
        <div
          className={`rain-overlay ${liveCond.wetLevel >= 3 ? "rain-heavy" : liveCond.wetLevel === 2 ? "rain-mod" : "rain-light"}`}
          aria-hidden="true"
        />
      )}
      <div className="app-shell">
        <header className="topbar">
          <div className="campus-id">
            <div className="campus-line"><MapPin size={14} strokeWidth={2.4} /><span>{CAMPUS.title}</span><small>{CAMPUS.subtitle}</small></div>
          </div>
          <div className="top-actions">
            {wxState === "offline" && <span className="pill">sample data</span>}
            <button className="round-btn" onClick={() => loadWeather(true)} aria-label="Refresh weather" title={weatherAgeText || "Refresh weather"}><RefreshCw size={18} strokeWidth={2.2} /></button>
            <button className="round-btn" aria-label="Profile"><UserRound size={18} strokeWidth={2.2} /></button>
          </div>
        </header>

        <main className="content-grid">
          <section className="hero">
            <div className="hero-meta">
              <div className="hero-place">{CAMPUS.name}</div>
              <div className="hero-date">{todayText} <span className="dot" /> {timeText} <span className="dot" /> <span className="cond-inline">{ConditionIcon ? <ConditionIcon size={15} strokeWidth={2.2} /> : null}{cond.label}</span></div>
            </div>
            <h1 className="verdict">{result.band.verdict}</h1>
            <p className="sub">{result.band.sub}</p>
            <div className="reads">
              <div className="read">
                <span className="read-k">Forecast</span>
                <span className="read-v">{plan.depart.apparent}°</span>
              </div>
              <ArrowRight size={18} strokeWidth={2.4} className="read-arrow" />
              <div className="read read-you">
                <span className="read-k">For you</span>
                <span className="read-v">{result.effective}°</span>
              </div>
              {result.personalShift !== 0 && <span className="shift">{result.personalShift > 0 ? "+" : ""}{result.personalShift}° personal</span>}
            </div>
            <div className="hero-foot"><span>{planningSummary}</span>{weatherAgeText && <span className="weather-age">{weatherAgeText}</span>}</div>
          </section>

          <aside className="planner glass card compact-planner planner-card">
            <div className="planner-head">
              <h2>Heading out?</h2>
              <button className="link-btn" aria-expanded={planOpen} aria-controls="outing-planner-controls" onClick={() => setPlanOpen((v) => !v)}>
                {planOpen ? "Hide" : "Plan a later time"} <ChevronDown size={15} className={planOpen ? "open" : ""} />
              </button>
            </div>
            <div className="plan-block">
              <span className="mini-l">{startOffset === 0 ? "How long will you be out?" : `Leaving ${formatTime(outingStart)} — for how long?`}</span>
              <div className="chips">
                {DURATIONS.map((d) => (
                  <button key={d.minutes} className={`chip ${duration === d.minutes ? "on" : ""}`} onClick={() => setDuration(d.minutes)}>{d.label}</button>
                ))}
              </div>
            </div>
            {planOpen && (
              <div id="outing-planner-controls" className="planner-body">
                <div className="plan-block">
                  <span className="mini-l">Leaving later?</span>
                  <div className="chips">
                    {START_OFFSETS.map((offset) => (
                      <button key={offset} className={`chip ${startOffset === offset ? "on" : ""}`} onClick={() => setStartOffset(offset)}>
                        {offset === 0 ? "Now" : formatTime(new Date(now.getTime() + offset * 60 * 60 * 1000))}
                      </button>
                    ))}
                  </div>
                </div>
                <label className={`toggle-row ${cycling ? "active" : ""}`}>
                  <div className="toggle-copy"><Bike size={18} strokeWidth={2.2} /><span><strong>Cycling or scootering</strong><small>Temporary trip modifier</small></span></div>
                  <input type="checkbox" checked={cycling} onChange={(e) => setCycling(e.target.checked)} />
                  <span className="toggle-ui" />
                </label>
              </div>
            )}
            <div className="planner-summary">
              <span><Clock3 size={14} strokeWidth={2.2} /> {`${formatTime(outingStart)}–${formatTime(outingEnd)}`}</span>
              <span>Feels {result?.rangeText || "--"}</span>
            </div>
          </aside>

          <section className="card glass wear-card main-card">
            <div className="card-h card-title-row"><span>Wear this</span></div>
            <ul className="wear-list">
              {result?.band.layers.map((l, i) => (
                <li key={i} className="wear-row">
                  <span className="wear-symbol" aria-hidden="true">{garmentCategory(l.label)}</span>
                  <span className="wear-num">{i + 1}</span>
                  <span className="wear-txt">
                    <span className="wear-name">{l.label}</span>
                    {l.note && <span className="wear-note">{l.note}</span>}
                  </span>
                  <ChevronDown size={18} className="wear-arrow" />
                </li>
              ))}
            </ul>

            <button
              className="why-toggle"
              type="button"
              aria-expanded={showWhy}
              aria-controls="why-outfit-panel"
              onClick={() => setShowWhy((value) => !value)}
            >
              <span><CircleHelp size={16} strokeWidth={2.2} /> Why this outfit?</span>
              <ChevronDown size={16} className={showWhy ? "open" : ""} />
            </button>

            {showWhy && (
              <div id="why-outfit-panel" className="why-panel">
                <ul>
                  {result.whyLines.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            )}

            {result?.extras?.length > 0 && (
              <div className="tipbar">
                {result.extras.map((e, i) => {
                  const E = e.Icon;
                  return <div key={i} className="tip"><E size={15} strokeWidth={2.2} /><span>{e.text}</span></div>;
                })}
              </div>
            )}
            {(result.significantTempChange || result.heavyRainSoon || result.rainSoon || result.snowSoon || result.cycling) && (
              <div className="warnbar" role="status" aria-live="polite">
                {result.significantTempChange && (
                  <span>
                    <AlertTriangle size={14} strokeWidth={2.4} />
                    It may feel {Math.abs(result.tempDelta)}° {result.tempDelta < 0 ? "colder" : "warmer"} by {formatTime(outingEnd)}.
                  </span>
                )}
                {result.snowSoon && <span><Snowflake size={14} strokeWidth={2.4} /> Snow may begin before you return.</span>}
                {result.heavyRainSoon && <span><Umbrella size={14} strokeWidth={2.4} /> Heavy rain may develop before you return.</span>}
                {result.rainSoon && <span><Umbrella size={14} strokeWidth={2.4} /> Rain risk rises to about {result.peakPrecip}% before you return.</span>}
                {result.cycling && <span><Bike size={14} strokeWidth={2.4} /> Cycling adds stronger wind exposure.</span>}
              </div>
            )}
          </section>

          <section className="card glass main-card activity-card">
            <div className="card-head inline-head">
              <h2 className="card-h">What’s the plan?</h2>
              <button className="plan-link" aria-expanded={planOpen} aria-controls="outing-planner-controls" onClick={() => setPlanOpen((v) => !v)}>
                Plan a later time <ChevronDown size={14} className={planOpen ? "open" : ""} />
              </button>
            </div>
            <div className="acts">
              {Object.entries(ACTIVITIES).map(([key, a]) => {
                const A = a.Icon;
                return (
                  <button key={key} className={`act ${activity === key ? "on" : ""}`} onClick={() => setActivity(key)}>
                    <A size={18} strokeWidth={2.2} />
                    <span className="act-l">{a.label}</span>
                    <span className="act-h">{a.hint}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card glass main-card threat-card">
            <div className="card-head">
              <h2 className="card-h">Comfort threats</h2>
              <div className="scale">{LEVELS.map((l) => <span key={l}>{l}</span>)}</div>
            </div>
            <div className="threats">
              {result?.threats.map((t) => {
                const T = t.Icon;
                return (
                  <div key={t.key} className={`threat lv-${t.level}`}>
                    <span className="th-l"><T size={16} strokeWidth={2.2} /> {t.label}</span>
                    <span className="meter">{[1,2,3,4].map((i) => <span key={i} className={`seg ${i <= t.level ? "fill" : ""}`} />)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card glass main-card feedback-card">
            <h2 className="card-h">How did it feel out there?</h2>
            <div className="follow-line">
              <span className="follow-q">Did you follow the recommendation?</span>
              <div className="follow-chips">
                {[["yes","Yes"],["mostly","Mostly"],["no","No"]].map(([key, label]) => (
                  <button key={key} className={`mini-chip ${followed === key ? "on" : ""}`} onClick={() => setFollowed(key)}>{label}</button>
                ))}
              </div>
            </div>
            {!askBlame ? (
              <div className="fb-row">
                <button className="fb" onClick={() => onFeedback("cold")}><Snowflake size={18} strokeWidth={2.2} /> Too cold</button>
                <button className="fb fb-ok" onClick={() => onFeedback("right")}><Check size={18} strokeWidth={2.4} /> Just right</button>
                <button className="fb" onClick={() => onFeedback("warm")}><Flame size={18} strokeWidth={2.2} /> Too warm</button>
              </div>
            ) : (
              <div className="blame">
                <div className="blame-h"><span>What got you?</span><button className="icon-btn" onClick={() => setAskBlame(null)}><X size={15} strokeWidth={2.4} /></button></div>
                <div className="blame-list">
                  {result?.threats.filter((t) => (result.isDay || t.key !== "sun") && (askBlame === "cold" ? t.key !== "sun" : true)).map((t) => {
                    const T = t.Icon;
                    return (
                      <button key={t.key} className="blame-b" onClick={() => applyFeedback(askBlame === "cold" ? -1 : 1, t.key)}>
                        <T size={15} strokeWidth={2.2} /> {t.blame}
                      </button>
                    );
                  })}
                  <button className="blame-b blame-skip" onClick={() => applyFeedback(askBlame === "cold" ? -1 : 1, null)}>Not sure — just off overall</button>
                </div>
              </div>
            )}
            {toast && <div className="toast">{toast}</div>}
          </section>

          <section className="card glass main-card calibration-card">
            <div className="card-head calibration-head">
              <div>
                <h2 className="card-h">Personalization</h2>
                <p className="calibration-copy">Layer learns how weather feels to you from the feedback you choose to share.</p>
              </div>
              <span className="conf">{learningLabel}</span>
            </div>

            <div className="personalization-summary">
              <span>{ratingCount === 0 ? "Based on your setup answers" : `${ratingCount} rating${ratingCount === 1 ? "" : "s"}`}</span>
              <span className={`sync-status sync-${cloudState}`}>
                Saved on this device
                {cloudState === "active" && " · Cloud backup active"}
                {cloudState === "connecting" && " · Connecting…"}
                {cloudState === "unavailable" && " · Cloud backup unavailable"}
                {cloudState === "device-only" && " only"}
                {cloudState === "local" && " only · Cloud not configured"}
              </span>
            </div>

            {cloudState !== "local" && (
              <div className="cloud-controls">
                <button
                  type="button"
                  className="cloud-control-btn"
                  disabled={cloudActionBusy || cloudState === "connecting"}
                  onClick={handleCloudAction}
                >
                  {cloudActionBusy || cloudState === "connecting"
                    ? "Connecting…"
                    : cloudState === "active"
                      ? "Use device only"
                      : cloudState === "unavailable"
                        ? "Retry cloud backup"
                        : "Enable cloud backup"}
                </button>
                <span>
                  {cloudState === "active"
                    ? "Turning this off stops future uploads; local personalization keeps working."
                    : "Cloud backup is optional and uses an anonymous identifier."}
                </span>
              </div>
            )}

            {metric ? (
              <div className="metric">
                <div className="metric-main">
                  <span className="metric-v">{metric.now}%</span>
                  <span className="metric-k">of your recent recommendations were rated “just right”</span>
                </div>
                {metric.then !== null && metric.now !== null && metric.now !== metric.then && (
                  <div className={`delta ${metric.now > metric.then ? "up" : ""}`}><TrendingUp size={13} strokeWidth={2.4} /> {metric.now > metric.then ? "+" : ""}{metric.now - metric.then} points since you started</div>
                )}
                <div className="spark">{metric.spark.map((h, i) => <span key={i} className={`sp ${h.outcome}`} />)}</div>
              </div>
            ) : (
              <p className="empty">Rate a few outings and Layer will begin showing your accuracy trend.</p>
            )}

            <button className="link-btn learn" aria-expanded={showModel} aria-controls="learning-details-panel" onClick={() => setShowModel((v) => !v)}>
              {showModel ? "Hide learning details" : "View learning details"}
              <ChevronDown size={14} className={showModel ? "open" : ""} />
            </button>

            {showModel && (
              <div id="learning-details-panel" className="learning-details">
                <div className="regimes">
                  {[ ["cold","Cold days"], ["mild","Mild days"], ["warm","Warm days"] ].map(([k,label]) => {
                    const off = model.regime[k].off;
                    const pct = ((clamp(off, -CLAMP, CLAMP) + CLAMP) / (CLAMP * 2)) * 100;
                    return (
                      <div key={k} className="reg">
                        <span className="reg-l">{label}</span>
                        <span className="reg-track"><span className="reg-mid" /><span className="reg-dot" style={{ left: `${pct}%` }} /></span>
                        <span className="reg-v">{off > 0 ? "+" : ""}{off.toFixed(1)}°</span>
                      </div>
                    );
                  })}
                </div>
                <div className="explain">Layer learns separate adjustments for cold, mild, and warm days. It can also learn whether wind, wetness, or sun affects you more than average. Feedback only changes the model when you say you followed the recommendation.</div>
              </div>
            )}
          </section>

          {ENABLE_ACCOUNT_UPGRADE && <AccountUpgrade ratingCount={ratingCount} />}
        </main>
      </div>
    </div>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Instrument+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');

.lyr {
  --ink: #112033;
  --muted: rgba(242, 246, 255, 0.84);
  --muted-dark: #6c7a90;
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
  background: #142236;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  color: white;
}
.scene-image {
  position: fixed;
  inset: 0;
  z-index: 0;
  background-position: center 58%;
  background-size: cover;
  background-repeat: no-repeat;
  animation: sceneIn .7s ease both;
  transform: scale(1.012);
  will-change: opacity, transform;
}
@keyframes sceneIn {
  from { opacity: 0; transform: scale(1.028); }
  to { opacity: 1; transform: scale(1.012); }
}
.weather-clear .scene-image { background-position: center 61%; filter: saturate(.98) contrast(1.02); }
.weather-cloudy .scene-image { background-position: center 59%; filter: saturate(.82) contrast(1.04); }
.weather-rain .scene-image { background-position: center 61%; filter: saturate(.84) contrast(1.06) brightness(.92); }
.rain-severity-2.weather-rain .scene-image { filter: saturate(.72) contrast(1.09) brightness(.82); }
.rain-severity-3.weather-rain .scene-image { filter: saturate(.62) contrast(1.12) brightness(.7); }
.weather-snow .scene-image { background-position: center 57%; filter: saturate(.78) brightness(1.04) contrast(1.02); }
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
/* Animated rain — a real sense of precipitation, scaled to intensity. Sits
   above the darkening backdrop but below all content, and never intercepts taps. */
.rain-overlay {
  position: fixed;
  inset: -20% 0 0 0;
  z-index: 0;
  pointer-events: none;
  background-repeat: repeat;
  background-image:
    linear-gradient(102deg, transparent 0 46%, rgba(210,225,240,.55) 46% 48%, transparent 48% 100%),
    linear-gradient(102deg, transparent 0 72%, rgba(210,225,240,.40) 72% 73.5%, transparent 73.5% 100%);
  background-size: 22px 22px, 34px 30px;
  animation: rainfall .5s linear infinite;
  opacity: .5;
}
.rain-light { opacity: .28; animation-duration: .7s; }
.rain-mod   { opacity: .5;  animation-duration: .52s; }
.rain-heavy { opacity: .72; animation-duration: .34s; background-size: 18px 20px, 26px 24px; }
.rain-severity-3 .backdrop { background: linear-gradient(180deg, rgba(2,9,19,.42) 0%, rgba(2,9,19,.52) 32%, rgba(2,9,19,.68) 70%, rgba(1,7,16,.82) 100%); }
@keyframes rainfall {
  to { background-position: -12px 22px, 8px 30px; }
}
@media (prefers-reduced-motion: reduce) {
  .rain-overlay { animation: none; opacity: .18; }
}
.weather-clear .backdrop {
  background: linear-gradient(180deg, rgba(7,22,40,.25) 0%, rgba(7,22,40,.36) 30%, rgba(7,22,40,.58) 68%, rgba(7,22,40,.72) 100%);
}
.weather-cloudy .backdrop {
  background: linear-gradient(180deg, rgba(8,18,30,.34) 0%, rgba(8,18,30,.45) 32%, rgba(8,18,30,.62) 70%, rgba(8,18,30,.76) 100%);
}
.weather-rain .backdrop {
  background: linear-gradient(180deg, rgba(4,13,25,.34) 0%, rgba(4,13,25,.43) 30%, rgba(4,13,25,.59) 68%, rgba(4,13,25,.75) 100%);
}
.weather-snow .backdrop {
  background: linear-gradient(180deg, rgba(27,42,61,.22) 0%, rgba(22,38,57,.34) 32%, rgba(13,29,47,.56) 70%, rgba(8,22,39,.72) 100%);
}
.night-mode.weather-clear .scene-image {
  filter: saturate(.72) contrast(1.08) brightness(.48);
}
.night-mode.weather-cloudy .scene-image {
  filter: saturate(.68) contrast(1.08) brightness(.46);
}
.night-mode.weather-rain .scene-image {
  filter: saturate(.72) contrast(1.1) brightness(.44);
}
.night-mode.weather-snow .scene-image {
  filter: saturate(.64) contrast(1.05) brightness(.55);
}
.night-mode .backdrop {
  background: linear-gradient(180deg, rgba(3,10,23,.44) 0%, rgba(3,10,23,.58) 34%, rgba(3,10,23,.72) 72%, rgba(2,8,18,.84) 100%);
}
.night-mode .hero,
.night-mode .topbar {
  text-shadow: 0 2px 18px rgba(0,0,0,.36);
}
.app-shell {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 28px 0 42px;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
}
.campus-line {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 15px;
}
.campus-line small {
  font-size: 14px;
  color: rgba(255,255,255,.74);
  font-weight: 500;
}
.top-actions { display: flex; align-items: center; gap: 10px; }
.round-btn, .icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 42px; height: 42px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.16); color: white; backdrop-filter: blur(12px); cursor: pointer;
}
.round-btn:hover, .icon-btn:hover { background: rgba(255,255,255,.22); }
.pill { font-family:'DM Mono',monospace; text-transform:uppercase; font-size:10px; letter-spacing:.12em; padding: 8px 12px; border-radius: 999px; background: rgba(255,247,227,.15); color: #FFF2D0; border: 1px solid rgba(255,244,215,.24); }
.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(320px, .75fr);
  gap: 18px;
  align-items: start;
}
.hero { padding: 34px 8px 8px 6px; }
.hero-place { font-size: 20px; font-weight: 700; margin-bottom: 10px; }
.hero-date { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; color: rgba(255,255,255,.92); font-size: 15px; }
.dot { width: 4px; height: 4px; border-radius: 999px; background: rgba(255,255,255,.68); }
.cond-inline { display: inline-flex; align-items: center; gap: 6px; }
.verdict {
  font-family: 'Outfit', sans-serif; font-size: clamp(54px, 8vw, 84px); line-height: .96;
  font-weight: 800; margin: 18px 0 10px; letter-spacing: -0.045em;
}
.sub { margin: 0 0 30px; font-size: clamp(24px, 2.4vw, 34px); color: rgba(255,255,255,.92); }
.reads { display: flex; align-items: end; gap: 18px; flex-wrap: wrap; }
.read { display: flex; flex-direction: column; gap: 4px; }
.read-k { font-family:'DM Mono', monospace; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: rgba(255,255,255,.78); }
.read-v { font-family:'Outfit', sans-serif; font-size: clamp(56px, 5vw, 78px); line-height: .92; font-weight: 700; }
.read-arrow { color: rgba(255,255,255,.72); margin-bottom: 14px; }
.read-you .read-v { color: #F6C35C; }
.shift {
  margin-left: 10px; margin-bottom: 14px; font-family:'DM Mono',monospace; font-size: 12px; color: #FFE5A2;
  padding: 12px 16px; border-radius: 16px; background: rgba(240, 176, 54, .28); border: 1px solid rgba(255, 213, 124, .22);
}
.hero-foot { margin-top: 18px; font-size: 15px; color: rgba(255,255,255,.88); display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; }
.weather-age { font-size: 12px; color: rgba(255,255,255,.7); font-family:'DM Mono',monospace; }
.glass {
  background: rgba(255,255,255,.86); color: var(--ink); border: 1px solid rgba(255,255,255,.34);
  box-shadow: 0 24px 60px rgba(8,18,32,.16); backdrop-filter: blur(20px);
}
.card {
  border-radius: 30px; padding: 24px 26px; overflow: hidden;
}
.compact-planner { position: sticky; top: 18px; }
.planner-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
.planner-head h2 { margin: 0; font-family:'Outfit', sans-serif; font-size: 26px; }
.link-btn, .plan-link {
  border: none; background: transparent; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  color: var(--muted-dark); font-weight: 600; font-size: 14px; padding: 0;
}
.link-btn .open, .plan-link .open { transform: rotate(180deg); }
.planner-body { margin-top: 18px; display: grid; gap: 16px; }
.plan-block { display: grid; gap: 10px; }
.mini-l, .conf { font-family:'DM Mono', monospace; letter-spacing:.12em; text-transform: uppercase; font-size: 11px; color: var(--muted-dark); }
.chips, .follow-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip, .mini-chip {
  border: none; border-radius: 12px; padding: 10px 14px; cursor: pointer;
  background: #EEF1F7; color: #5D6D86; font-weight: 700;
}
.chip.on, .mini-chip.on {
  background: rgba(238, 179, 73, .16); color: var(--accent); box-shadow: inset 0 0 0 1px rgba(234, 177, 73, .65);
}
.toggle-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 14px 16px; border-radius: 18px; background: #F7F9FC; border: 1px solid #E8EDF5;
}
.toggle-copy { display:flex; gap: 12px; align-items: center; }
.toggle-copy span { display:flex; flex-direction: column; }
.toggle-copy small { color: var(--muted-dark); font-size: 12px; }
.toggle-row input { display: none; }
.toggle-ui {
  width: 44px; height: 26px; border-radius: 999px; background: #D7DCE5; position: relative; transition: .2s ease;
}
.toggle-ui::after {
  content: ""; width: 20px; height: 20px; border-radius: 999px; background: white; position: absolute; top: 3px; left: 3px; transition: .2s ease;
  box-shadow: 0 2px 5px rgba(0,0,0,.16);
}
.toggle-row.active .toggle-ui { background: rgba(234, 177, 73, .85); }
.toggle-row.active .toggle-ui::after { left: 21px; }
.planner-summary {
  margin-top: 18px; padding-top: 16px; border-top: 1px solid rgba(17, 32, 51, .08); color: #54657f;
  display: flex; justify-content: space-between; gap: 10px; font-weight: 600; flex-wrap: wrap;
}
.planner-summary span { display:inline-flex; align-items:center; gap:8px; }
.main-card { grid-column: 1 / span 1; }
.card-h { margin: 0; font-family:'Outfit', sans-serif; font-size: 18px; }
.card-head { display:flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 18px; }
.inline-head { align-items: start; }
.plan-link { background: #F1F4FA; border-radius: 999px; padding: 10px 14px; }
.wear-card { padding-top: 18px; }
.card-title-row { font-size: 16px; margin-bottom: 8px; }
.wear-list { list-style: none; margin: 0; padding: 0; }
.wear-row {
  display:flex; align-items:center; gap: 18px; padding: 16px 0; border-top: 1px solid rgba(17,32,51,.08);
}
.wear-row:first-child { border-top: none; }
.wear-symbol {
  width: 52px; height: 42px; border-radius: 999px; display:inline-flex; align-items:center; justify-content:center;
  flex-shrink: 0; background: #FAF2DF; color: #8A641F; font-family:'DM Mono', monospace;
  font-size: 9px; font-weight: 600; letter-spacing: .08em;
}
.wear-num { font-size: 18px; color: var(--accent); width: 20px; text-align: right; }
.wear-txt { display:flex; flex-direction: column; gap: 4px; flex: 1; }
.wear-name { font-size: 22px; font-weight: 600; }
.wear-note { font-size: 15px; color: var(--muted-dark); }
.wear-arrow { color: #8A97AA; transform: rotate(-90deg); }
.why-toggle {
  width: 100%;
  min-height: 46px;
  margin-top: 4px;
  padding: 13px 2px 4px;
  border: 0;
  border-top: 1px solid rgba(17,32,51,.08);
  background: transparent;
  color: #52637B;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 700;
  text-align: left;
}
.why-toggle > span { display: inline-flex; align-items: center; gap: 9px; }
.why-toggle svg { color: var(--accent); }
.why-toggle .open { transform: rotate(180deg); }
.why-panel {
  margin-top: 10px;
  padding: 14px 16px;
  border-radius: 16px;
  background: #F4F7FB;
  color: #56667E;
  line-height: 1.48;
}
.why-panel ul { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
.why-panel li::marker { color: var(--accent); }
.tipbar {
  margin: 10px -26px -24px; padding: 16px 22px; display:grid; gap: 10px;
  background: linear-gradient(180deg, rgba(248,243,232,1) 0%, rgba(249,245,236,.96) 100%); border-top: 1px solid rgba(227, 206, 158, .45);
}
.tip { display:flex; gap: 10px; align-items:flex-start; color:#42526a; font-size: 15px; }
.tip svg { color: var(--accent); flex-shrink: 0; }
.warnbar { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 12px; color: #5f6f85; font-size: 14px; }
.warnbar span { display: inline-flex; align-items: center; gap: 8px; background:#F7F8FB; padding: 10px 12px; border-radius: 12px; }
.warnbar svg { color: var(--accent); flex-shrink: 0; }
.acts { display:flex; gap: 14px; }
.act {
  flex: 1; text-align: left; display:flex; flex-direction: column; gap: 6px; padding: 20px; border-radius: 24px; border: none;
  cursor: pointer; background: #F2F4F9; color: #39485F;
}
.act svg { color: #69788F; }
.act.on { background: rgba(248, 242, 225, .95); box-shadow: inset 0 0 0 2px rgba(234,177,73,.8); }
.act.on svg, .act.on .act-l { color: #B77A16; }
.act-l { font-size: 18px; font-weight: 700; }
.act-h { color: var(--muted-dark); font-size: 13px; }
.scale { display:flex; gap: 18px; font-family:'DM Mono', monospace; color: var(--muted-dark); font-size: 11px; text-transform: uppercase; }
.threats { display:grid; gap: 16px; }
.threat {
  display:grid;
  grid-template-columns: minmax(110px, 130px) minmax(0, 1fr);
  align-items:center;
  gap: 18px;
  width: 100%;
}
.th-l { min-width: 0; font-size: 18px; font-weight: 500; display:flex; gap: 10px; align-items:center; }
.th-l svg { color: #5D6C84; flex-shrink: 0; }
.meter {
  display:grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  width: 100%;
  min-width: 0;
}
.seg { width: 100%; height: 9px; border-radius: 9px; background: rgba(17,32,51,.08); }
.lv-0 .seg.fill { background: rgba(17,32,51,.16); }
.lv-1 .seg.fill { background: #93C86A; }
.lv-2 .seg.fill { background: #E9B34C; }
.lv-3 .seg.fill { background: #E0703C; }
.follow-line { display:flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.follow-q { color:#5A6A82; font-size: 15px; }
.fb-row { display:flex; gap: 10px; }
.fb {
  flex:1; border:none; border-radius: 18px; padding: 16px 10px; cursor:pointer; background:#F2F4F9;
  display:flex; flex-direction: column; align-items: center; gap: 8px; font-weight: 700; color:#334158;
}
.fb-ok { background: rgba(238,179,73,.14); }
.blame { margin-top: 8px; }
.blame-h { display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; font-weight: 700; }
.blame-list { display:grid; gap: 8px; }
.blame-b {
  border:none; border-radius: 14px; background:#F5F7FB; padding: 12px 14px; text-align: left; cursor:pointer;
  display:flex; align-items:center; gap: 10px; color:#324157; font-weight: 600;
}
.blame-skip { color:#607088; }
.toast { margin-top: 14px; padding: 12px 14px; border-radius: 14px; background: rgba(238,179,73,.12); color:#875C12; }
.metric { padding-bottom: 18px; margin-bottom: 18px; border-bottom: 1px solid rgba(17,32,51,.08); }
.metric-main { display:flex; align-items:center; gap: 16px; }
.metric-v { font-family:'Outfit', sans-serif; font-size: 54px; line-height: 1; font-weight: 800; color: var(--accent); }
.metric-k { color:#586781; max-width: 270px; }
.delta { display:inline-flex; align-items:center; gap: 6px; margin-top: 10px; color:#66758A; font-size: 14px; font-weight: 700; }
.delta.up { color: #3D9560; }
.spark { display:flex; gap: 4px; margin-top: 14px; }
.sp { width: 18px; height: 18px; border-radius: 4px; background: rgba(17,32,51,.09); }
.sp.right { background: #6FB558; } .sp.cold { background: #7FB6DD; } .sp.warm { background: #E9B93F; }
.empty { margin: 0 0 18px; color:#62728A; }
.calibration-head { align-items: flex-start; }
.calibration-copy { margin: 8px 0 0; color:#62728A; line-height:1.45; max-width:560px; }
.personalization-summary {
  display:flex; flex-wrap:wrap; gap:10px; margin: 0 0 18px;
}
.personalization-summary span {
  padding:8px 11px; border-radius:999px; background:#F3F6FA; color:#607088; font-size:13px; font-weight:600;
}
.learning-details { margin-top:14px; padding:16px; border-radius:18px; background:#F4F7FB; }
.learning-details .explain { margin-top:16px; background:white; }
.regimes { display:grid; gap: 12px; }
.reg { display:flex; gap: 12px; align-items:center; }
.reg-l { width: 84px; color:#69788F; font-size: 14px; }
.reg-track { position:relative; flex:1; height: 4px; border-radius: 999px; background: rgba(17,32,51,.08); }
.reg-mid { position:absolute; left:50%; top:-4px; width:1px; height:12px; background: rgba(17,32,51,.18); }
.reg-dot { position:absolute; top:50%; width: 12px; height: 12px; border-radius: 999px; transform: translate(-50%, -50%); background: var(--accent); }
.reg-v { width: 50px; text-align:right; font-family:'DM Mono', monospace; font-size: 12px; }
.learn { margin-top: 14px; }
.explain { margin-top: 12px; padding: 14px; border-radius: 16px; background:#F4F7FB; color:#5D6C83; line-height: 1.5; }
.ob-wrap {
  min-height: 100vh; display:flex; align-items:center; justify-content:center; padding: 24px;
  background: linear-gradient(180deg, #6A93C8 0%, #A9C3E4 100%);
}
.ob-card { width:min(680px, 100%); border-radius: 28px; padding: 28px; }
.ob-mark { font-family:'Outfit', sans-serif; color: var(--accent); font-size: 18px; font-weight: 800; margin-bottom: 24px; }
.ob-h { font-family:'Outfit', sans-serif; font-size: clamp(40px, 6vw, 56px); line-height: .98; margin: 0 0 10px; }
.ob-p { color:#5C6A82; font-size: 17px; line-height: 1.5; margin: 0 0 24px; }
.ob-q { margin-bottom: 18px; }
.ob-l { display:block; margin-bottom: 10px; font-weight: 700; }
.ob-opts { display:grid; gap: 8px; }
.ob-opts-row { grid-template-columns: repeat(3, 1fr); }
.ob-opt { border:none; background:#F2F5FA; border-radius: 18px; padding: 14px; text-align:left; cursor:pointer; color: var(--ink); }
.ob-opt.on { box-shadow: inset 0 0 0 2px rgba(234,177,73,.8); background:#FBF5E8; }
.ob-opt-l { display:block; font-weight:700; }
.ob-opt-n { color:#6A7990; font-size: 13px; }
.ob-privacy { margin: 22px 0 16px; padding: 14px 16px; border-radius: 16px; background:#F1F5FA; color:#54627A; font-size: 13.5px; line-height: 1.5; border: 1px solid #E4EBF3; }
.ob-actions { display:flex; flex-wrap:wrap; gap: 10px; }
.ob-go { border:none; cursor:pointer; background: var(--ink); color:white; border-radius: 18px; padding: 16px 18px; font-weight:700; display:inline-flex; align-items:center; gap: 8px; }
.ob-go:disabled { opacity: .4; cursor: not-allowed; }
.ob-secondary { border:1px solid #D3DDEA; background:white; color:#43506A; cursor:pointer; border-radius: 18px; padding: 16px 18px; font-weight:600; }
.ob-secondary:disabled { opacity: .4; cursor: not-allowed; }
.ob-secondary:hover:not(:disabled) { background:#F5F8FC; }
.ob-note { margin: 12px 0 0; color:#7A879C; font-size: 12.5px; }
.sync-status { display:inline-flex; align-items:center; }
.sync-active { color:#2F855A !important; background:#E7F4EC !important; }
.sync-unavailable { color:#9A6A2E !important; background:#F6EEE0 !important; }
.sync-device-only { color:#5A6785 !important; }
.cloud-controls { margin: 12px 0 4px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.cloud-control-btn { border:1px solid #D3DDEA; background:white; color:#43506A; cursor:pointer; border-radius:12px; padding:9px 12px; font-weight:700; font-size:12.5px; }
.cloud-control-btn:hover:not(:disabled) { background:#F5F8FC; }
.cloud-control-btn:disabled { opacity:.55; cursor:default; }
.cloud-controls span { color:#718097; font-size:12.5px; line-height:1.4; }
.upgrade-card { position:relative; border:1px solid #E4EBF3; }
.upgrade-x { position:absolute; top:14px; right:14px; border:none; background:none; cursor:pointer; color:#9AA6B8; padding:4px; border-radius:8px; }
.upgrade-x:hover { color:#43506A; background:#F1F5FA; }
.upgrade-h { font-family:'Outfit', sans-serif; font-weight:700; font-size:16px; margin-bottom:6px; }
.upgrade-p { color:#5C6A82; font-size:13.5px; line-height:1.5; margin:0 0 14px; max-width:46ch; }
.upgrade-row { display:flex; gap:8px; }
.upgrade-input { flex:1; min-width:0; border:1px solid #D3DDEA; border-radius:12px; padding:11px 13px; font-size:14px; font-family:'Instrument Sans', sans-serif; color:var(--ink); background:white; }
.upgrade-input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.upgrade-go { border:none; cursor:pointer; background:var(--ink); color:white; border-radius:12px; padding:11px 18px; font-weight:700; font-size:14px; }
.upgrade-go:disabled { opacity:.5; cursor:default; }
.upgrade-err { margin-top:9px; color:#B4462F; font-size:12.5px; }
.upgrade-sent { display:flex; align-items:center; gap:10px; color:#2F855A; font-size:13.5px; line-height:1.45; }
.upgrade-sent svg { flex-shrink:0; }

.loading-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.loading-content {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-radius: 18px;
  background: rgba(12, 27, 44, .48);
  border: 1px solid rgba(255, 255, 255, .18);
  box-shadow: 0 18px 50px rgba(0, 0, 0, .2);
  backdrop-filter: blur(14px);
  color: rgba(255, 255, 255, .92);
  font-weight: 600;
}
.loading-brand {
  font-family: 'Outfit', sans-serif;
  color: #F6C35C;
  font-weight: 800;
}
.loading-spinner {
  animation: loadingSpin .9s linear infinite;
}
@keyframes loadingSpin {
  to { transform: rotate(360deg); }
}

button, [role="button"], input, label {
  -webkit-tap-highlight-color: transparent;
}
button:focus-visible,
input:focus-visible,
label:has(input:focus-visible) {
  outline: 3px solid rgba(255, 197, 84, .95);
  outline-offset: 3px;
}
.round-btn,
.link-btn,
.plan-link,
.chip,
.mini-chip,
.act,
.fb,
.blame-b,
.why-toggle {
  touch-action: manipulation;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
  .scene-image { transform: none; }
}

@media (prefers-contrast: more) {
  .weather-clear .backdrop,
  .weather-cloudy .backdrop,
  .weather-rain .backdrop,
  .weather-snow .backdrop {
    background: linear-gradient(180deg, rgba(3,10,20,.48) 0%, rgba(3,10,20,.62) 45%, rgba(3,10,20,.82) 100%);
  }
  .glass { background: rgba(255,255,255,.96); }
}

@media (max-width: 980px) {
  .content-grid { grid-template-columns: 1fr; }
  .hero { order: 1; padding-right: 0; }
  .wear-card { order: 2; }
  .activity-card { order: 3; }
  .compact-planner { position: static; order: 4; }
  .threat-card { order: 5; }
  .feedback-card { order: 6; }
  .calibration-card { order: 7; }
  .main-card { grid-column: auto; }
}
@media (max-width: 740px) {
  .weather-clear .scene-image { background-position: 54% 58%; }
  .weather-cloudy .scene-image { background-position: 51% 56%; }
  .weather-rain .scene-image { background-position: 50% 59%; }
  .weather-snow .scene-image { background-position: 54% 56%; }
  .app-shell { width: min(100vw - 18px, 100%); padding-top: 14px; }
  .content-grid { gap: 14px; }
  .topbar { margin-bottom: 0; }
  .hero { padding: 18px 10px 14px; }
  .hero-place { font-size: 18px; margin-bottom: 7px; }
  .hero-date { font-size: 13px; gap: 7px; }
  .campus-line small { display:none; }
  .verdict { font-size: 48px; margin-top: 14px; margin-bottom: 8px; }
  .sub { font-size: 20px; margin-bottom: 18px; }
  .reads { gap: 10px; }
  .read-k { font-size: 11px; }
  .read-v { font-size: 48px; }
  .read-arrow { margin-bottom: 11px; }
  .shift { margin-left: 0; margin-bottom: 8px; padding: 9px 12px; }
  .hero-foot { margin-top: 12px; font-size: 13px; }
  .card { border-radius: 24px; padding: 18px; }
  .why-panel { padding: 13px 14px; font-size: 14px; }
  .warnbar { display: grid; gap: 8px; }
  .warnbar span { width: 100%; }
  .tipbar { margin-left: -18px; margin-right: -18px; margin-bottom: -18px; }
  .wear-name, .th-l { font-size: 18px; }
  .wear-symbol { width: 48px; height: 40px; font-size: 8px; }
  .acts, .fb-row { flex-direction: column; }
  .scale { gap: 10px; font-size: 10px; }
  .threat {
    grid-template-columns: 1fr;
    align-items: stretch;
    gap: 10px;
  }
  .th-l { min-width: 0; }
  .meter { width: 100%; min-height: 9px; }
  .follow-line, .planner-head, .card-head { align-items: flex-start; }
  .ob-opts-row { grid-template-columns: 1fr; }
}
`;
