import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudFog, CloudSun,
  Wind, Zap, Snowflake, Droplets, Check, Flame, MapPin, RefreshCw,
  Umbrella, ChevronDown, Footprints, Timer, Car, TrendingUp, X, ArrowRight,
  Bike, Clock3, AlertTriangle, UserRound, CircleHelp, Moon, CloudMoon,
  HardDrive, RotateCcw, Mail, LogOut, ShieldCheck
} from "lucide-react";
import {
  CLAMP, clamp, deepCopy, EMPTY_MODEL, normalizeModel,
  pooledOffset, totalObservations, updateModel,
} from "./lib/model";
import {
  campusRainConsensus, classifyWeather, getLatestIndexAtOrBefore,
  rainIntensityFromRate, rainSignalFromLocation,
  rateFrom15MinuteTotal, wmoRainSeverity,
} from "./lib/weather";
import {
  ensureAuth, pullModel, pushModel, pushProfile, logEvent,
  flushOutbox, setCloudPref, subscribeCloud, retryCloud,
  subscribeAuth, hasPendingReset, resetPersonalizationCloud,
  availableProviders, startProviderAuth, sendEmailLink, signOutCloud,
} from "./lib/sync";

const CAMPUS = {
  name: "Ithaca, NY",
  title: "Cornell University",
  subtitle: "Ithaca campus",
  lat: 42.4534,
  lon: -76.4735,
};

// A lightweight set of nearby campus points catches highly localised showers
// that can fall between forecast grid cells. The central point still controls
// temperature and wind; nearby points are used only as a conservative rain
// fallback.
const CAMPUS_RAIN_POINTS = [
  [42.4534, -76.4735], // central campus
  [42.4603, -76.4780], // north campus
  [42.4480, -76.4630], // east campus
  [42.4460, -76.4820], // south-west campus
  [42.4610, -76.4650], // north-east campus
];

const MODEL_KEY = "layer:model:v5";
const CACHE_KEY = "layer:wx-cache:v7";
const CACHE_TTL = 5 * 60 * 1000;
const WEATHER_REFRESH_MS = 5 * 60 * 1000;
const ACTIVE_RAIN_REFRESH_MS = 2 * 60 * 1000;
// Open-Meteo is_day drives both automatic night dimming and sun-threat accuracy.

const ASSET_BASE = import.meta.env.BASE_URL;
const BACKGROUNDS = {
  clear: `${ASSET_BASE}backgrounds/clear.webp`,
  clearNight: `${ASSET_BASE}backgrounds/clear-night.webp`,
  cloudy: `${ASSET_BASE}backgrounds/cloudy.webp`,
  rain: `${ASSET_BASE}backgrounds/rain.webp`,
  snow: `${ASSET_BASE}backgrounds/snow.webp`,
};

// A clear night gets its own star-field photograph rather than a dimmed daytime
// sky, so night actually looks like night instead of a darkened afternoon.
function sceneSource(category, isDay) {
  if (category === "clear" && !isDay) return BACKGROUNDS.clearNight;
  return BACKGROUNDS[category];
}
const RAIN_VIDEO = `${ASSET_BASE}backgrounds/rain-loop.mp4`;

const LEVELS = ["None", "Low", "Medium", "High"];
const HOUR_MS = 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
// Absolute departure options, snapped to the clock (:00 / :30) so their labels
// stay put between ticks and only advance when the half-hour rolls over. A
// chosen time is stored as an absolute timestamp, never a live offset — so once
// you pick "1:30", it stays 1:30 as the minutes pass.
function laterDepartureOptions(nowMs) {
  const base = Math.floor(nowMs / HALF_HOUR_MS) * HALF_HOUR_MS;
  return [1, 2, 4, 6]
    .map((h) => base + h * HOUR_MS)
    .filter((t) => t > nowMs);
}
const DURATIONS = [
  { minutes: 20, label: "20 min" },
  { minutes: 60, label: "1 hr" },
  { minutes: 120, label: "2 hrs" },
  { minutes: 240, label: "4+ hrs" },
];
const durationLabel = (minutes) =>
  DURATIONS.find((d) => d.minutes === minutes)?.label || `${minutes} min`;

const CLIMATES = [
  { key: "tropical", label: "Mostly hot", note: "Tropical, desert, or warm year-round", seed: { cold: -7, mild: -4, warm: 1 } },
  { key: "temperate", label: "Four seasons", note: "Warm summers and cold winters", seed: { cold: -1, mild: 0, warm: 0 } },
  { key: "cold", label: "Mostly cold", note: "Long, cold winters", seed: { cold: 4, mild: 2, warm: -2 } },
];
const TOLERANCE = [
  { key: "colder", label: "Usually colder", adj: -3 },
  { key: "same", label: "About the same", adj: 0 },
  { key: "warmer", label: "Usually warmer", adj: 3 },
];

const ACTIVITIES = {
  waiting: { label: "Standing", Icon: Timer, adj: -5, hint: "Stop, platform, queue" },
  walking: { label: "Walking", Icon: Footprints, adj: 2, hint: "10+ min on foot" },
  dashing: { label: "Quick trip", Icon: Car, adj: 6, hint: "Door to car to door" },
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

function decodeWeather(code, isDay = 1, rainRateMmPerHour = 0) {
  const state = classifyWeather(code, isDay, rainRateMmPerHour);
  const icons = {
    sun: Sun,
    moon: Moon,
    "partly-day": CloudSun,
    "partly-night": CloudMoon,
    cloud: Cloud,
    fog: CloudFog,
    drizzle: CloudDrizzle,
    rain: CloudRain,
    thunder: Zap,
    snow: CloudSnow,
  };
  return { ...state, Icon: icons[state.iconKey] ?? Cloud };
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
    { key: "cold", label: "Cold", Icon: Snowflake, level: cold, blame: "Cold" },
    { key: "wind", label: "Wind", Icon: Wind, level: windLevel, blame: "Wind" },
    { key: "wet", label: "Wet weather", Icon: Droplets, level: wet, blame: "Rain or dampness" },
  ];

  // At night there is no direct-sun exposure to display or calibrate.
  if (isDay) {
    const sun = cond.clear && effective >= 82 ? 3 : cond.clear && effective >= 72 ? 2 : cond.clear ? 1 : 0;
    threats.push({ key: "sun", label: "Sun", Icon: Sun, level: sun, blame: "Direct sun" });
  }
  return threats;
}

function extrasFor(threats, cond) {
  const out = [];
  const lv = (k) => threats.find((t) => t.key === k)?.level ?? 0;
  if (cond.snow) {
    out.push({ Icon: Snowflake, text: "Wear waterproof boots if the ground is slushy." });
  } else if (cond.wetLevel >= 3) {
    out.push({ Icon: Umbrella, text: "Heavy rain now — wear a waterproof jacket; an umbrella alone may not be enough." });
  } else if (cond.wetLevel === 2) {
    out.push({ Icon: Umbrella, text: "Rain now — wear a waterproof jacket." });
  } else if (cond.wetLevel === 1) {
    out.push({ Icon: Umbrella, text: "Light rain now — take a rain jacket or umbrella." });
  }
  if (lv("wind") >= 2) out.push({ Icon: Wind, text: cond.wet ? "Choose a rain jacket that also blocks the wind." : "A wind-blocking jacket will help." });
  if (lv("sun") >= 2) out.push({ Icon: Sun, text: "Bring sunglasses and use sunscreen if you’ll be outside for a while." });
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

function isOuterwearLayer(label) {
  return /coat|jacket|parka|shell/i.test(String(label || ""));
}

function rainOuterwear({ wetLevel, currentWetLevel, effective, activity }) {
  let label;
  if (wetLevel >= 3) {
    label = effective < 29
      ? "Waterproof insulated parka with hood"
      : effective < 47
        ? "Waterproof insulated coat with hood"
        : effective < 65
          ? "Waterproof jacket with hood"
          : "Waterproof rain jacket with hood";
  } else if (wetLevel >= 2) {
    label = effective < 29
      ? "Waterproof insulated parka"
      : effective < 47
        ? "Waterproof insulated coat"
        : effective < 65
          ? "Waterproof light jacket"
          : "Waterproof shell or rain jacket";
  } else {
    label = effective < 29
      ? "Water-resistant insulated parka"
      : effective < 47
        ? "Water-resistant insulated coat"
        : effective < 65
          ? "Water-resistant light jacket"
          : "Packable rain shell";
  }

  let note;
  if (currentWetLevel > 0 && wetLevel > currentWetLevel) {
    note = wetLevel >= 3
      ? "Wear it now; rain could become heavy before you return."
      : "Wear it now; rain could get heavier while you’re out.";
  } else if (currentWetLevel >= 3) {
    note = "Wear it now; an umbrella alone may not be enough.";
  } else if (currentWetLevel >= 2) {
    note = activity === "dashing" ? "Keep it close for the trip." : "Wear it while you’re outside.";
  } else if (currentWetLevel >= 1) {
    note = "Wear it now or carry an umbrella.";
  } else if (wetLevel >= 3) {
    note = "Rain could become heavy before you return.";
  } else if (wetLevel >= 2) {
    note = "Steady rain could start while you’re out.";
  } else {
    note = "Rain could start before you return.";
  }

  return { label, note };
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

/**
 * Account controls inside the profile panel.
 *
 * Anonymous  → "Save your profile": attaches an identity to the SAME account,
 *              so existing ratings and calibration carry over untouched.
 * Signed in  → shows the account and a sign-out that returns to anonymous use.
 *
 * A second device uses the same buttons: linking fails there because the
 * identity already exists, and sync.js falls back to signing in, after which
 * the app adopts the cloud profile.
 */
function AccountSection({ auth, cloudState, ratingCount, onEnableCloud }) {
  const providers = availableProviders();
  const [mode, setMode] = useState(null);        // null | "email"
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(null);        // provider key while redirecting
  const [status, setStatus] = useState(null);    // { kind, text }

  const signedIn = auth.status === "permanent";
  const cloudOn = cloudState === "active" || cloudState === "connecting";
  const cloudConfigured = providers.email;

  const prepareCloud = async () => {
    if (cloudOn) return true;
    if (!cloudConfigured || !onEnableCloud) {
      setStatus({ kind: "error", text: "Accounts are not available in this build." });
      return false;
    }
    const connected = await onEnableCloud();
    if (!connected) {
      setStatus({ kind: "error", text: "Could not connect right now. Check your connection and try again." });
    }
    return connected;
  };

  const runProvider = async (provider, opts = {}) => {
    const key = opts.cornell ? "cornell" : provider;
    setBusy(key);
    setStatus(null);
    const ready = await prepareCloud();
    if (!ready) { setBusy(null); return; }
    const res = await startProviderAuth(provider, { mode: "link", ...opts });
    if (!res.ok) {
      setBusy(null);
      setStatus({ kind: "error", text: res.error });
    }
    // On success the browser redirects, so no further state change is needed.
  };

  const submitEmail = async () => {
    setBusy("email");
    setStatus(null);
    const ready = await prepareCloud();
    if (!ready) { setBusy(null); return; }
    const res = await sendEmailLink(email, { mode: "link" });
    setBusy(null);
    if (res.ok) {
      setStatus({
        kind: "sent",
        text: `Check ${email.trim()} and open the link on this device. After it is saved, use the same email on your other devices.`,
      });
      setMode(null);
    } else {
      setStatus({ kind: "error", text: res.error });
    }
  };

  const doSignOut = async () => {
    setBusy("out");
    await signOutCloud();
    setBusy(null);
    setStatus({ kind: "ok", text: "Signed out. Layer still works with a new anonymous profile on this device." });
  };

  if (!cloudConfigured) {
    return (
      <div className="account-block account-block-muted">
        <div className="account-head"><ShieldCheck size={17} strokeWidth={2.2} /><span>Account</span></div>
        <p className="account-copy">Account sign-in is not configured in this build. Your profile is still saved on this device.</p>
      </div>
    );
  }

  if (signedIn) {
    return (
      <div className="account-block account-block-signed">
        <div className="account-head"><ShieldCheck size={17} strokeWidth={2.2} /><span>Account</span></div>
        <div className="account-signed">
          <Check size={17} strokeWidth={2.6} />
          <div>
            <strong>Profile saved to your account</strong>
            <small>{auth.email || (auth.provider ? `Signed in with ${auth.provider}` : "Signed in")}</small>
          </div>
        </div>
        <p className="account-copy">Use the same account on another device to load your Layer profile.</p>
        <button type="button" className="profile-secondary account-out" disabled={busy === "out"} onClick={doSignOut}>
          <LogOut size={15} strokeWidth={2.2} /> {busy === "out" ? "Signing out…" : "Sign out"}
        </button>
        {status && <p className={`account-status ${status.kind}`} role={status.kind === "error" ? "alert" : "status"} aria-live="polite">{status.text}</p>}
      </div>
    );
  }

  return (
    <div className="account-block">
      <div className="account-head"><ShieldCheck size={17} strokeWidth={2.2} /><span>Save or restore your profile</span></div>
      <p className="account-copy">
        {ratingCount > 0
          ? `Keep your ${ratingCount} rating${ratingCount === 1 ? "" : "s"} if you change devices or clear this browser.`
          : "Sign in once to use the same profile on your other devices."}
      </p>

      <div className="account-providers">
        {providers.cornell && (
          <button type="button" className="account-btn account-cornell" disabled={Boolean(busy)}
            onClick={() => runProvider("google", { cornell: true })}>
            {busy === "cornell" ? "Opening…" : "Continue with Cornell"}
          </button>
        )}
        {providers.google && (
          <button type="button" className="account-btn" disabled={Boolean(busy)}
            onClick={() => runProvider("google")}>
            {busy === "google" ? "Opening…" : "Continue with Google"}
          </button>
        )}
        {providers.apple && (
          <button type="button" className="account-btn" disabled={Boolean(busy)}
            onClick={() => runProvider("apple")}>
            {busy === "apple" ? "Opening…" : "Continue with Apple"}
          </button>
        )}
        {providers.email && mode !== "email" && (
          <button type="button" className="account-btn" disabled={Boolean(busy)} onClick={() => { setMode("email"); setStatus(null); }}>
            <Mail size={15} strokeWidth={2.2} /> Continue with email
          </button>
        )}
      </div>

      {mode === "email" && (
        <div className="account-email">
          <label className="sr-only" htmlFor="layer-account-email">Email address</label>
          <input
            id="layer-account-email"
            className="account-input"
            type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" autoFocus
            value={email} onChange={(e) => { setEmail(e.target.value); setStatus(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") submitEmail(); }}
          />
          <div className="account-email-actions">
            <button type="button" className="profile-secondary" onClick={() => { setMode(null); setStatus(null); }}>Cancel</button>
            <button type="button" className="profile-primary" disabled={busy === "email"} onClick={submitEmail}>
              {busy === "email" ? "Sending…" : "Email me a link"}
            </button>
          </div>
        </div>
      )}

      {status && <p className={`account-status ${status.kind}`} role={status.kind === "error" ? "alert" : "status"} aria-live="polite">{status.text}</p>}
      <p className="account-fine">
        No password required. Signing in turns on sync; you can keep using Layer without an account.
      </p>
    </div>
  );
}

function Onboarding({ onDone, cloudAvailable = true }) {
  const [climate, setClimate] = useState(null);
  const [tol, setTol] = useState(null);
  const [allowCloud, setAllowCloud] = useState(false);
  const canContinue = Boolean(climate && tol);

  return (
    <div className="lyr ob-wrap">
      <style>{css}</style>
      <div
        className="ob-scene"
        style={{ backgroundImage: `url(${BACKGROUNDS.clear})` }}
        aria-hidden="true"
      />
      <div className="ob-backdrop" aria-hidden="true" />
      <div className="ob-card glass">
        <div className="ob-brand-row">
          <div className="ob-mark">Layer</div>
          <span className="ob-time">30-second setup</span>
        </div>
        <h1 className="ob-h">Dress for how it feels to you.</h1>
        <p className="ob-p">
          Layer turns Cornell weather into a simple outfit recommendation, then gets better from your ratings.
        </p>

        <div className="ob-value-strip" aria-label="How Layer works">
          <span><strong>1</strong> Check the weather</span>
          <span><strong>2</strong> See what to wear</span>
          <span><strong>3</strong> Rate it later</span>
        </div>

        <div className="ob-q">
          <span className="ob-l">Which climate feels most familiar?</span>
          <div className="ob-opts">
            {CLIMATES.map((c) => (
              <button
                type="button"
                key={c.key}
                aria-pressed={climate === c.key}
                className={`ob-opt ${climate === c.key ? "on" : ""}`}
                onClick={() => setClimate(c.key)}
              >
                <span className="ob-opt-l">{c.label}</span>
                <span className="ob-opt-n">{c.note}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ob-q">
          <span className="ob-l">Compared with other people, you usually feel…</span>
          <div className="ob-opts ob-opts-row">
            {TOLERANCE.map((t) => (
              <button
                type="button"
                key={t.key}
                aria-pressed={tol === t.key}
                className={`ob-opt ${tol === t.key ? "on" : ""}`}
                onClick={() => setTol(t.key)}
              >
                <span className="ob-opt-l">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {cloudAvailable && (
          <label className={`ob-backup ${allowCloud ? "on" : ""}`}>
            <Cloud size={20} strokeWidth={2.1} aria-hidden="true" />
            <span>
              <strong>Turn on cloud sync</strong>
              <small>Optional. Mirrors your profile now; add an account later for recovery.</small>
            </span>
            <input
              type="checkbox"
              checked={allowCloud}
              onChange={(event) => setAllowCloud(event.target.checked)}
            />
            <span className="toggle-ui" aria-hidden="true" />
          </label>
        )}

        <div className="ob-privacy">
          No account is required. Layer uses Cornell’s fixed campus location—not your phone’s GPS.
          If you sign in later, your email is stored only to restore your profile on another device.
        </div>

        <button
          type="button"
          className="ob-go"
          disabled={!canContinue}
          onClick={() => onDone(climate, tol, cloudAvailable && allowCloud)}
        >
          See my recommendation <ArrowRight size={16} strokeWidth={2.6} />
        </button>
        <p className="ob-note">
          {cloudAvailable && allowCloud
            ? "Cloud sync is on. Add an account later to restore this profile elsewhere."
            : "Your profile will stay on this device. You can turn on sync later in Profile."}
        </p>
      </div>
    </div>
  );
}

export default function Layer() {
  const mounted = useRef(true);
  const rainVideoRef = useRef(null);
  const [model, setModel] = useState(deepCopy(EMPTY_MODEL));
  const [ready, setReady] = useState(false);
  const [wx, setWx] = useState(null);
  const [wxState, setWxState] = useState("loading");
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState(null);
  const [activity, setActivity] = useState("walking");
  const [planOpen, setPlanOpen] = useState(false);
  const [departAt, setDepartAt] = useState(null); // null = leaving now; else absolute ms
  const [duration, setDuration] = useState(60);
  const [cycling, setCycling] = useState(false);
  const [askBlame, setAskBlame] = useState(null);
  const [toast, setToast] = useState(null);
  // A brand-new tester has not been outside yet, so the rating controls stay
  // behind one deliberate tap. This prevents accidental day-one feedback from
  // training the model before the user has actually tried a recommendation.
  const [readyToRate, setReadyToRate] = useState(false);
  const [followed, setFollowed] = useState("yes");
  const [showModel, setShowModel] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [cloudState, setCloudState] = useState("connecting");
  const [cloudActionBusy, setCloudActionBusy] = useState(false);
  const [weatherRefreshing, setWeatherRefreshing] = useState(false);
  const [rainVideoFailed, setRainVideoFailed] = useState(false);
  const [rainVideoVersion, setRainVideoVersion] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const profilePanelRef = useRef(null);

  useEffect(() => () => { mounted.current = false; }, []);

  // Reflect background sync status in the UI (device-only | local | connecting
  // | active | unavailable) so calibration storage is never a mystery.
  useEffect(() => subscribeCloud((s) => { if (mounted.current) setCloudState(s); }), []);

  // Account identity (anonymous vs signed in), used by the profile panel.
  const [auth, setAuth] = useState({ status: "none", email: null, provider: null, signedInAt: 0 });
  useEffect(() => subscribeAuth((a) => { if (mounted.current) setAuth(a); }), []);

  useEffect(() => {
    const updateClock = () => setNow(new Date());
    updateClock();

    // A short interval keeps the displayed minute aligned with the phone clock.
    // Mobile browsers may delay timers while backgrounded, so visibility/focus
    // handlers below also update it immediately when the app returns.
    const id = window.setInterval(updateClock, 10000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!profileOpen) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setResetConfirmOpen(false);
        setProfileOpen(false);
      }
    };

    // Rendered through a body portal below. Lock both scrolling elements because
    // iOS browsers do not consistently honour body overflow on its own.
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    const focusId = window.requestAnimationFrame(() => {
      profilePanelRef.current?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(focusId);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

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

      // 2) Finish any previously interrupted reset before cloud reconciliation.
      // This prevents an older cloud model from restoring data the user cleared.
      if (hasPendingReset()) {
        await resetPersonalizationCloud(deepCopy(EMPTY_MODEL));
        if (hasPendingReset()) return;
      }

      // 3) In the background, mint the anonymous session and reconcile with cloud.
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

  /**
   * After an explicit sign-in the user is saying "put my profile on this
   * device", so the cloud copy wins outright — unlike the ordinary background
   * reconciliation, which only adopts a richer cloud model. Without this, a new
   * phone that had already collected a couple of local ratings would keep them
   * and silently ignore the account it just signed into.
   */
  const adoptedSignIn = useRef(0);
  useEffect(() => {
    if (!auth.signedInAt || auth.signedInAt === adoptedSignIn.current) return;
    adoptedSignIn.current = auth.signedInAt;
    let cancelled = false;
    (async () => {
      try {
        const cloud = await pullModel();
        if (cancelled || !mounted.current) return;
        if (cloud?.model) {
          const cloudModel = normalizeModel(cloud.model);
          if (cloudModel.seeded) {
            setModel(cloudModel);
            await storageSet(MODEL_KEY, JSON.stringify(cloudModel));
            setToast("Signed in — your saved profile is now on this device.");
            return;
          }
        }
        // Nothing saved on the account yet: keep this device's profile and
        // push it up so the account starts from what the user already has.
        setModel((current) => {
          if (current?.seeded) pushModel(current, totalObservations(current));
          return current;
        });
        setToast("Signed in — this profile is now saved to your account.");
      } catch {
        /* offline: local profile stands, reconciliation retries on next load */
      }
    })();
    return () => { cancelled = true; };
  }, [auth.signedInAt]);

  const seed = useCallback((climateKey, tolKey, allowCloud = false) => {
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

  const connectCloud = useCallback(async () => {
    if (cloudState === "active") return true;
    if (cloudState === "local") return false;
    if (cloudActionBusy) return cloudState === "active";

    setCloudActionBusy(true);
    setCloudPref(true);
    setCloudState("connecting");
    try {
      const connected = await retryCloud();
      if (!connected) return false;

      if (hasPendingReset()) {
        await resetPersonalizationCloud(deepCopy(EMPTY_MODEL));
        if (hasPendingReset()) return false;
      }

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
      return true;
    } finally {
      setCloudActionBusy(false);
    }
  }, [cloudActionBusy, cloudState, model]);

  const handleCloudAction = useCallback(async () => {
    if (cloudActionBusy) return;
    if (cloudState === "active") {
      setCloudPref(false);
      setCloudState("device-only");
      return;
    }
    if (cloudState === "connecting" || cloudState === "local") return;
    await connectCloud();
  }, [cloudActionBusy, cloudState, connectCloud]);

  const resumeRainVideo = useCallback(({ restart = false, reload = false } = {}) => {
    const video = rainVideoRef.current;
    if (!video || document.visibilityState === "hidden") return false;

    try {
      // iOS and mobile browsers can pause muted background video whenever the
      // page is backgrounded. Re-asserting these properties before play()
      // makes the element eligible to resume without opening a media player.
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;

      if (restart && video.readyState >= 1) {
        try { video.currentTime = 0; } catch {}
      }
      if (reload && (video.readyState < 2 || video.error)) video.load();

      const playAttempt = video.play();
      if (playAttempt?.catch) {
        playAttempt.catch(() => {
          // A suspended decoder sometimes needs one reload after the app
          // returns from the background. Keep the static rain image visible
          // while this retry happens.
          if (!reload && document.visibilityState === "visible") {
            try {
              video.load();
              const retry = video.play();
              retry?.catch?.(() => {});
            } catch {}
          }
        });
      }
      return true;
    } catch {
      return false;
    }
  }, []);

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
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York&timeformat=unixtime&past_minutely_15=2&forecast_minutely_15=96&forecast_days=2`;

    const probeLatitudes = CAMPUS_RAIN_POINTS.map(([lat]) => lat).join(",");
    const probeLongitudes = CAMPUS_RAIN_POINTS.map(([, lon]) => lon).join(",");
    const rainProbeUrl = `https://api.open-meteo.com/v1/forecast?latitude=${probeLatitudes}&longitude=${probeLongitudes}` +
      `&current=weather_code,precipitation,rain,showers` +
      `&minutely_15=weather_code,precipitation,rain,showers` +
      `&timezone=America%2FNew_York&timeformat=unixtime&past_minutely_15=2&forecast_minutely_15=2`;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const [mainResult, probeResult] = await Promise.allSettled([
        fetch(url, { signal: ctrl.signal }),
        fetch(rainProbeUrl, { signal: ctrl.signal }),
      ]);
      clearTimeout(timer);

      if (mainResult.status !== "fulfilled" || !mainResult.value.ok) {
        const status = mainResult.status === "fulfilled" ? mainResult.value.status : "network";
        throw new Error(`weather request failed (${status})`);
      }
      const data = await mainResult.value.json();

      const currentMs = typeof data.current?.time === "number" ? data.current.time * 1000 : Date.now();
      // 15-minute precipitation values describe the interval that just ended.
      // Never let a future interval erase rain that is already falling.
      const minuteIndex = data.minutely_15?.time?.length
        ? getLatestIndexAtOrBefore(data.minutely_15.time, currentMs)
        : -1;

      const primaryRainSignal = rainSignalFromLocation(data);
      const currentProbability = Math.round(probabilityAt(data.hourly, currentMs));
      let campusRainSignal = { ...primaryRainSignal, scope: primaryRainSignal.severity > 0 ? "primary" : "none", support: primaryRainSignal.severity > 0 ? 1 : 0 };

      // A single forecast grid point can miss a narrow shower across Cornell's
      // spread-out campus. A lightweight multi-point request is used only to
      // strengthen the rain signal; it never changes temperature or wind.
      if (probeResult.status === "fulfilled" && probeResult.value.ok) {
        try {
          const probeJson = await probeResult.value.json();
          const locations = Array.isArray(probeJson) ? probeJson : [probeJson];
          const signals = locations.map(rainSignalFromLocation);
          if (signals.length) signals[0] = primaryRainSignal;
          campusRainSignal = campusRainConsensus(signals, currentProbability);
        } catch (probeError) {
          console.warn("[weather] campus rain probe unavailable:", probeError?.message || probeError);
        }
      }

      const rainRate = Math.max(primaryRainSignal.rate, campusRainSignal.rate);
      const rawCurrentCode = Number(data.current?.weather_code ?? 3);
      const recentCode = minuteIndex >= 0 ? Number(data.minutely_15.weather_code?.[minuteIndex] ?? rawCurrentCode) : rawCurrentCode;
      const strongestCode = wmoRainSeverity(recentCode) > wmoRainSeverity(rawCurrentCode) ? recentCode : rawCurrentCode;
      const currentCode = campusRainSignal.severity > wmoRainSeverity(strongestCode)
        ? Number(campusRainSignal.code ?? strongestCode)
        : strongestCode;
      const currentIsDay = Number(data.current?.is_day ?? (minuteIndex >= 0 ? data.minutely_15.is_day?.[minuteIndex] : 1) ?? 1);
      const currentWind = Number(data.current?.wind_speed_10m ?? (minuteIndex >= 0 ? data.minutely_15.wind_speed_10m?.[minuteIndex] : 0) ?? 0);
      const currentGust = Number(data.current?.wind_gusts_10m ?? (minuteIndex >= 0 ? data.minutely_15.wind_gusts_10m?.[minuteIndex] : currentWind) ?? currentWind);

      const payload = {
        current: {
          actual: Math.round(data.current.temperature_2m),
          apparent: Math.round(data.current.apparent_temperature),
          code: currentCode,
          wind: Math.round(currentWind),
          gust: Math.round(currentGust),
          precip: currentProbability,
          precipRate: rainRate,
          rainScope: campusRainSignal.scope,
          rainSupport: campusRainSignal.support,
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

      // Timers and media are commonly suspended while a mobile browser is in
      // the background. Bring both the clock and rain footage back immediately.
      setNow(new Date());
      const video = rainVideoRef.current;
      resumeRainVideo();
      if (video?.paused) {
        setRainVideoFailed(false);
        setRainVideoVersion((version) => version + 1);
      }

      const age = weatherUpdatedAt ? Date.now() - weatherUpdatedAt : Infinity;
      if (age > 90 * 1000) {
        loadWeather(true).finally(() => {
          if (mounted.current) setNow(new Date());
          window.requestAnimationFrame(() => resumeRainVideo());
        });
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
    };
  }, [loadWeather, resumeRainVideo, weatherUpdatedAt]);

  useEffect(() => {
    const current = wx?.current;
    if (!current || rainVideoFailed) return;
    const currentCond = decodeWeather(current.code, current.isDay, current.precipRate);
    if (currentCond.category !== "rain") return;
    const frame = window.requestAnimationFrame(() => resumeRainVideo());
    return () => window.cancelAnimationFrame(frame);
  }, [rainVideoFailed, resumeRainVideo, wx?.current?.code, wx?.current?.isDay, wx?.current?.precipRate]);

  const handleManualRefresh = useCallback(() => {
    if (weatherRefreshing) return;
    setWeatherRefreshing(true);
    setRainVideoFailed(false);
    setNow(new Date());

    // Force a fresh media element as well as retrying play(). This is more
    // reliable on iOS after the decoder has been suspended in another app.
    setRainVideoVersion((version) => version + 1);
    resumeRainVideo({ restart: true, reload: true });

    loadWeather(true).finally(() => {
      if (mounted.current) {
        setNow(new Date());
        setWeatherRefreshing(false);
      }
      window.requestAnimationFrame(() => resumeRainVideo());
    });
  }, [loadWeather, resumeRainVideo, weatherRefreshing]);

  const openPersonalization = useCallback(() => {
    setResetConfirmOpen(false);
    setProfileOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById("personalization-section")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  const handleResetPersonalization = useCallback(async () => {
    if (resetBusy) return;
    setResetBusy(true);

    const empty = deepCopy(EMPTY_MODEL);
    // The sync layer clears queued feedback immediately and either clears the
    // current cloud profile or leaves a retry marker that blocks old cloud data
    // from being restored later.
    await Promise.race([
      resetPersonalizationCloud(empty),
      new Promise((resolve) => window.setTimeout(() => resolve({ ok: false, cloud: "pending" }), 4500)),
    ]);
    await storageSet(MODEL_KEY, JSON.stringify(empty));

    if (!mounted.current) return;
    setModel(empty);
    setActivity("walking");
    setPlanOpen(false);
    setDepartAt(null);
    setDuration(60);
    setCycling(false);
    setAskBlame(null);
    setToast(null);
    setFollowed("yes");
    setShowModel(false);
    setShowWhy(false);
    setResetConfirmOpen(false);
    setProfileOpen(false);
    setResetBusy(false);
  }, [resetBusy]);

  const outingStart = useMemo(
    () => (departAt != null ? new Date(departAt) : now),
    [departAt, now]
  );

  // Departure choices for the "leave later" row: absolute, snapped times, plus
  // the currently-chosen time if it has aged out of the generated set (so the
  // user's selection always stays visible and highlighted).
  const departureOptions = useMemo(() => {
    const opts = laterDepartureOptions(now.getTime());
    if (departAt != null && !opts.includes(departAt)) opts.push(departAt);
    return opts.sort((a, b) => a - b);
  }, [now, departAt]);

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

    if (departAt == null && wx.current) {
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
  }, [wx, outingStart, duration, departAt, now]);

  const result = useMemo(() => {
    if (!plan) return null;
    const isDay = Number(plan.depart.isDay ?? 1) !== 0;
    const cond = decodeWeather(plan.depart.code, isDay ? 1 : 0, plan.depart.precipRate);
    const laterConditions = plan.codes.slice(1).map((code, index) => decodeWeather(
      code,
      plan.daylight?.[index + 1] ?? 1,
      plan.precipRates?.[index + 1] ?? 0,
    ));
    const laterWetLevel = Math.max(
      0,
      ...laterConditions.map((condition) => condition.wetLevel || 0),
      rainIntensityFromRate(plan.peakRainRate),
    );
    const outingWetLevel = Math.max(cond.wetLevel || 0, laterWetLevel);
    const snowSoon = !cond.snow && laterConditions.some((condition) => condition.snow);
    const heavyRainSoon = !snowSoon && cond.wetLevel < 3 && outingWetLevel >= 3;
    const rainSoon = !cond.wet && !snowSoon && !heavyRainSoon && (
      outingWetLevel > 0 || plan.maxPrecip >= 45
    );

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
    let weatherLayers = isDay
      ? [...baseBand.layers]
      : baseBand.layers.filter((layer) => !/sun protection|sunglasses|shade/i.test(layer.label));

    if (!cond.clear) {
      weatherLayers = weatherLayers.filter((layer) => !/sun protection|sunglasses|shade/i.test(layer.label));
    }

    if (outingWetLevel > 0 && !cond.snow && !snowSoon) {
      // Give the user one clear outerwear choice instead of stacking a generic
      // jacket and a separate rain shell. The recommendation still covers the
      // whole selected outing, while the condition label describes departure.
      weatherLayers = weatherLayers.filter((layer) =>
        !/thin layer for indoors/i.test(layer.label) && !isOuterwearLayer(layer.label)
      );
      weatherLayers.push(rainOuterwear({
        wetLevel: outingWetLevel,
        currentWetLevel: cond.wetLevel || 0,
        effective,
        activity,
      }));
    }

    const band = {
      ...baseBand,
      sub: cond.wetLevel >= 3
        ? "Waterproof layer needed."
        : cond.wet
          ? "Rain protection needed."
          : outingWetLevel >= 3
            ? "Pack a waterproof layer."
            : outingWetLevel > 0
              ? "Pack rain protection."
              : baseBand.sub,
      layers: weatherLayers,
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
    const whyLines = [];
    if (personalShift !== 0) {
      whyLines.push(`The official feels-like temperature is ${base}°. Your profile shifts the recommendation to ${effective}°.`);
    } else {
      whyLines.push(`The official feels-like temperature is ${base}° before activity and outing adjustments.`);
    }

    if (activity === "waiting") {
      whyLines.push("Standing still creates less body heat, so Layer recommends a little more warmth.");
    } else if (activity === "walking") {
      whyLines.push("Walking adds body heat, so Layer avoids unnecessary layers.");
    } else {
      whyLines.push("This is a short trip, so Layer keeps the outfit light.");
    }

    if (cycling) {
      whyLines.push("Cycling makes the air feel windier, so a jacket that blocks wind will help.");
    } else if (plan.depart.wind >= 12) {
      whyLines.push(`Wind is around ${plan.depart.wind} mph, which can make exposed areas feel cooler.`);
    } else if (cond.wet || plan.depart.precip >= 30) {
      whyLines.push("Rain and damp clothing can make you feel colder, so a water-resistant layer helps.");
    } else if (isDay && cond.clear && base >= 72) {
      whyLines.push("Direct sun can add warmth, especially during a longer walk.");
    } else if (duration >= 60) {
      whyLines.push(`This outfit covers about ${durationLabel(duration).toLowerCase()} outside.`);
    }

    return {
      effective,
      band,
      cond,
      threats,
      extras: extrasFor(threats, cond),
      personalShift,
      rangeText: `${plan.minApparent}°–${plan.maxApparent}°`,
      tempDelta,
      significantTempChange: Math.abs(tempDelta) >= 6,
      rainSoon,
      heavyRainSoon,
      snowSoon,
      peakPrecip: plan.maxPrecip,
      peakRainRate: plan.peakRainRate,
      outingWetLevel,
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
    const withHistory = deepCopy(model);
    withHistory.history = [...withHistory.history, {
      at: Date.now(),
      apparent: plan.depart.apparent,
      effective: result.effective,
      activity,
      followed,
      outcome: direction === 0 ? "right" : direction < 0 ? "cold" : "warm",
      blame: blameKey || null,
    }].slice(-80);

    // The calibration math lives in ./lib/model (pure + unit-tested).
    const next = updateModel(withHistory, {
      apparentTemp: plan.depart.apparent,
      direction,
      blameKey,
      followed,
    });

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
      start_offset: departAt == null ? 0 : clamp(Math.round((departAt - now.getTime()) / HOUR_MS), 0, 48),
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
  }, [plan, result, model, activity, followed, commit, departAt, duration, cycling, wx, now]);

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
  if (!model.seeded) return <Onboarding onDone={seed} cloudAvailable={cloudState !== "local"} />;
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
  const scene = {
    key: liveCond.category,
    src: sceneSource(liveCond.category, liveIsDay) ?? scenicByCode(liveWeatherCode).src,
  };
  const todayText = humanDate(now);
  const timeText = formatTime(now);
  const accent = result.band.accent;
  const ratingCount = model.history.length;
  const learningProgress = Math.min(95, Math.round((ratingCount / (ratingCount + 4)) * 100));
  const learningLabel = ratingCount === 0 ? "Starting profile" : `${learningProgress}% learned`;
  const planningSummary = `${departAt == null ? "Leaving now" : `Leaving ${formatTime(outingStart)}`} • ${DURATIONS.find((d) => d.minutes === duration)?.label || `${duration} min`} outside${cycling ? " • Cycling" : ""}`;
  const weatherAgeMinutes = weatherUpdatedAt == null ? null : Math.max(0, Math.floor((now.getTime() - weatherUpdatedAt) / 60000));
  const weatherAgeText = weatherRefreshing
    ? "Checking campus…"
    : weatherAgeMinutes == null
      ? ""
      : wxState === "cached"
        ? weatherAgeMinutes < 1 ? "Cached just now" : `Cached ${weatherAgeMinutes} min ago`
        : wxState === "offline"
          ? "Sample data"
          : weatherAgeMinutes < 1 ? "Updated now" : `Updated ${weatherAgeMinutes} min ago`;
  const conditionText = departAt == null && wx?.current?.rainScope === "nearby" && cond.wet
    ? "Passing rain around campus"
    : cond.label;

  return (
    <div
      className={`lyr weather-${scene.key} rain-severity-${liveCond.wetLevel}${liveCond.thunder ? " thunder-active" : ""}${liveIsDay ? "" : " night-mode"}`}
      data-weather-scene={scene.key}
      style={{ "--accent": accent }}
    >
      <style>{css}</style>
      <div
        key={`${scene.key}-${liveIsDay ? "day" : "night"}`}
        className="scene-image"
        style={{ backgroundImage: `url(${scene.src})` }}
        aria-hidden="true"
      />
      {liveCond.category === "rain" && !rainVideoFailed && (
        <video
          ref={rainVideoRef}
          key={`rain-video-${liveCond.wetLevel}-${rainVideoVersion}`}
          className={`rain-video ${liveCond.wetLevel >= 3 ? "rain-video-heavy" : liveCond.wetLevel === 2 ? "rain-video-mod" : "rain-video-light"}`}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={BACKGROUNDS.rain}
          controls={false}
          disablePictureInPicture
          tabIndex={-1}
          aria-hidden="true"
          onLoadedData={() => resumeRainVideo()}
          onCanPlay={() => resumeRainVideo()}
          onEnded={() => resumeRainVideo({ restart: true })}
          onError={() => setRainVideoFailed(true)}
        >
          <source src={RAIN_VIDEO} type="video/mp4" />
        </video>
      )}
      <div className="backdrop" />
      <div className="app-shell">
        <header className="topbar">
          <div className="campus-id">
            <div className="campus-line"><MapPin size={14} strokeWidth={2.4} /><span>{CAMPUS.title}</span><small>{CAMPUS.subtitle}</small></div>
          </div>
          <div className="top-actions">
            {wxState === "offline" && <span className="pill">sample data</span>}
            <button
              className={`round-btn${weatherRefreshing ? " is-refreshing" : ""}`}
              onClick={handleManualRefresh}
              aria-label={weatherRefreshing ? "Refreshing weather" : "Refresh weather and rain animation"}
              aria-busy={weatherRefreshing}
              title={weatherAgeText || "Refresh weather"}
            >
              <RefreshCw className="refresh-icon" size={18} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              className={`round-btn profile-trigger${profileOpen ? " is-active" : ""}${auth.status === "permanent" ? " has-account" : ""}`}
              aria-label="Open profile and account"
              aria-expanded={profileOpen}
              aria-controls="layer-profile-panel"
              title="Profile and account"
              onClick={() => { setResetConfirmOpen(false); setProfileOpen(true); }}
            >
              <UserRound size={18} strokeWidth={2.2} />
              {auth.status === "permanent" && <span className="profile-status-dot" aria-hidden="true" />}
            </button>
          </div>
        </header>

        <main className="content-grid">
          <section className="hero">
            <div className="hero-meta">
              <div className="hero-place">{CAMPUS.name}</div>
              <div className="hero-date" role="status" aria-live="polite">{todayText} <span className="dot" /> {timeText} <span className="dot" /> <span className="cond-inline">{ConditionIcon ? <ConditionIcon size={15} strokeWidth={2.2} /> : null}{conditionText}</span></div>
            </div>
            <h1 className="verdict">{result.band.verdict}</h1>
            <p className="sub">{result.band.sub}</p>
            <div className="reads">
              <div className="read">
                <span className="read-k">{departAt == null ? "Temperature" : "Forecast"}</span>
                <span className="read-v">{plan.depart.actual}°</span>
              </div>
              <ArrowRight size={18} strokeWidth={2.4} className="read-arrow" />
              <div className="read read-you">
                <span className="read-k">For you</span>
                <span className="read-v">{result.effective}°</span>
              </div>
              {result.personalShift !== 0 && (
                <span className="shift">
                  {Math.abs(result.personalShift)}° {result.personalShift < 0 ? "cooler" : "warmer"} for you
                  {ratingCount === 0 && <em className="shift-src"> · from your setup</em>}
                </span>
              )}
            </div>
            <div className="hero-foot"><span>{planningSummary}</span>{weatherAgeText && <span className="weather-age" role="status" aria-live="polite">{weatherAgeText}</span>}</div>
          </section>

          <aside className="planner glass card compact-planner planner-card">
            <div className="planner-head">
              <h2>Heading out?</h2>
              <button className="link-btn" aria-expanded={planOpen} aria-controls="outing-planner-controls" onClick={() => setPlanOpen((v) => !v)}>
                {planOpen ? "Hide" : "Plan a later time"} <ChevronDown size={15} className={planOpen ? "open" : ""} />
              </button>
            </div>
            <div className="plan-block">
              <span className="mini-l">{departAt == null ? "How long will you be out?" : `Leaving ${formatTime(outingStart)} — for how long?`}</span>
              <div className="chips duration-chips">
                {DURATIONS.map((d) => (
                  <button type="button" key={d.minutes} aria-pressed={duration === d.minutes} className={`chip ${duration === d.minutes ? "on" : ""}`} onClick={() => setDuration(d.minutes)}>{d.label}</button>
                ))}
              </div>
            </div>
            {planOpen && (
              <div id="outing-planner-controls" className="planner-body">
                <div className="plan-block">
                  <span className="mini-l">When are you leaving?</span>
                  <div className="chips">
                    <button type="button" aria-pressed={departAt == null} className={`chip ${departAt == null ? "on" : ""}`} onClick={() => setDepartAt(null)}>Now</button>
                    {departureOptions.map((ms) => (
                      <button type="button" key={ms} aria-pressed={departAt === ms} className={`chip ${departAt === ms ? "on" : ""}`} onClick={() => setDepartAt(ms)}>
                        {formatTime(new Date(ms))}
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
              <span>Official feels like {result?.rangeText || "--"}</span>
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
                {result.heavyRainSoon && <span><Umbrella size={14} strokeWidth={2.4} /> Rain could become heavy before you return.</span>}
                {result.rainSoon && <span><Umbrella size={14} strokeWidth={2.4} /> Chance of rain rises to about {result.peakPrecip}% before you return.</span>}
                {result.cycling && <span><Bike size={14} strokeWidth={2.4} /> Cycling will make the wind feel stronger.</span>}
              </div>
            )}
          </section>

          <section className="card glass main-card activity-card">
            <div className="card-head activity-head">
              <div>
                <h2 className="card-h">What’s the plan?</h2>
                <p className="card-sub">Choose one to tailor the recommendation.</p>
              </div>
            </div>
            <div className="acts" role="group" aria-label="Outdoor activity">
              {Object.entries(ACTIVITIES).map(([key, a]) => {
                const A = a.Icon;
                return (
                  <button type="button" key={key} aria-pressed={activity === key} className={`act ${activity === key ? "on" : ""}`} onClick={() => setActivity(key)}>
                    <A size={18} strokeWidth={2.2} />
                    <span className="act-l">{a.label}</span>
                    <span className="act-h">{a.hint}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card glass main-card threat-card">
            <div className="card-head threat-head">
              <div>
                <h2 className="card-h">Comfort factors</h2>
                <p className="card-sub">What could affect you during this outing.</p>
              </div>
              <div className="scale" aria-label="Comfort factor scale">{LEVELS.map((l) => <span key={l}>{l}</span>)}</div>
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
            <h2 className="card-h">How did the recommendation feel?</h2>
            {ratingCount === 0 && !readyToRate ? (
              <div className="first-rate">
                <p className="first-rate-copy">
                  Try this recommendation, then rate how it felt when you return. Layer only learns from outings you actually completed.
                </p>
                <button type="button" className="first-rate-go" onClick={() => setReadyToRate(true)}>
                  Rate this outing <ArrowRight size={15} strokeWidth={2.6} />
                </button>
              </div>
            ) : (
              <p className="card-sub feedback-copy">Rate it after your outing.</p>
            )}
            {(ratingCount > 0 || readyToRate) && (
            <>
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
                <div className="blame-h"><span>What affected your comfort?</span><button className="icon-btn" onClick={() => setAskBlame(null)}><X size={15} strokeWidth={2.4} /></button></div>
                <div className="blame-list">
                  {result?.threats.filter((t) => (result.isDay || t.key !== "sun") && (askBlame === "cold" ? t.key !== "sun" : true)).map((t) => {
                    const T = t.Icon;
                    return (
                      <button key={t.key} className="blame-b" onClick={() => applyFeedback(askBlame === "cold" ? -1 : 1, t.key)}>
                        <T size={15} strokeWidth={2.2} /> {t.blame}
                      </button>
                    );
                  })}
                  <button className="blame-b blame-skip" onClick={() => applyFeedback(askBlame === "cold" ? -1 : 1, null)}>Not sure — it just felt off</button>
                </div>
              </div>
            )}
            </>
            )}
            {toast && <div className="toast">{toast}</div>}
          </section>

          <section id="personalization-section" className="card glass main-card calibration-card">
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
                {cloudState === "active" && " · Cloud sync active"}
                {cloudState === "connecting" && " · Connecting…"}
                {cloudState === "unavailable" && " · Cloud sync unavailable"}
                {cloudState === "device-only" && " only"}
                {cloudState === "local" && " only · Cloud not configured"}
              </span>
            </div>



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


        </main>
        <footer className="data-source-footer">
          Weather data by{" "}
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
          {" · "}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
          {" · "}adapted for Layer
        </footer>
      </div>

      {profileOpen && typeof document !== "undefined" && createPortal(
        <div
          className="profile-overlay"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) { setResetConfirmOpen(false); setProfileOpen(false); }
          }}
          style={{ "--accent": accent }}
        >
          <section
            ref={profilePanelRef}
            id="layer-profile-panel"
            className="profile-panel glass"
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-panel-title"
          >
            <div className="profile-panel-head">
              <h2 id="profile-panel-title">Profile & account</h2>
              <button className="icon-btn profile-close" type="button" aria-label="Close profile" onClick={() => { setResetConfirmOpen(false); setProfileOpen(false); }}>
                <X size={18} strokeWidth={2.4} />
              </button>
            </div>

            <p className="profile-intro">
              {auth.status === "permanent"
                ? "Your ratings and personalization can now follow you across devices."
                : "See what Layer has learned, save this profile, or start fresh."}
            </p>

            <div className="profile-stat-grid">
              <div className="profile-stat"><strong>{ratingCount}</strong><span>rating{ratingCount === 1 ? "" : "s"}</span></div>
              <div className="profile-stat"><strong>{ratingCount === 0 ? "New" : `${learningProgress}%`}</strong><span>profile progress</span></div>
            </div>

            <AccountSection
              auth={auth}
              cloudState={cloudState}
              ratingCount={ratingCount}
              onEnableCloud={connectCloud}
            />

            <div className="profile-section-label">Storage</div>
            <div className="profile-storage-list">
              <div className="profile-storage-row profile-storage-compact">
                <HardDrive size={19} strokeWidth={2.1} />
                <div><strong>This device</strong><span>Personalization is saved locally.</span></div>
                <Check size={18} strokeWidth={2.4} className="profile-ok" />
              </div>
              <div className="profile-storage-row profile-storage-compact">
                <Cloud size={19} strokeWidth={2.1} />
                <div>
                  <strong>{cloudState === "active" ? "Cloud sync on" : cloudState === "connecting" ? "Connecting" : cloudState === "unavailable" ? "Cloud sync needs attention" : cloudState === "local" ? "Cloud sync not configured" : "Cloud sync off"}</strong>
                  <span>{cloudState === "active" ? "New ratings are synced to this cloud profile." : "Local recommendations keep working."}</span>
                </div>
                {cloudState === "active" && <Check size={18} strokeWidth={2.4} className="profile-ok" />}
              </div>
            </div>

            {!resetConfirmOpen ? (
              <>
                <div className="profile-actions">
                  {cloudState !== "local" && (
                    <button
                      type="button"
                      className="profile-primary"
                      disabled={cloudActionBusy || cloudState === "connecting"}
                      onClick={handleCloudAction}
                    >
                      {cloudActionBusy || cloudState === "connecting"
                        ? "Connecting…"
                        : cloudState === "active"
                          ? "Turn off cloud sync"
                          : cloudState === "unavailable"
                            ? "Retry cloud sync"
                            : "Enable cloud sync"}
                    </button>
                  )}
                  <button type="button" className="profile-secondary" onClick={openPersonalization}>
                    How Layer has learned
                  </button>
                </div>
                <button
                  type="button"
                  className="profile-reset-link"
                  onClick={() => setResetConfirmOpen(true)}
                >
                  <RotateCcw size={15} strokeWidth={2.2} /> Reset personalization
                </button>
              </>
            ) : (
              <div className="reset-confirm" role="alertdialog" aria-labelledby="reset-title" aria-describedby="reset-copy">
                <div className="reset-title-row">
                  <AlertTriangle size={19} strokeWidth={2.2} />
                  <h3 id="reset-title">Start fresh?</h3>
                </div>
                <p id="reset-copy">
                  Layer will erase your setup, ratings, and learned adjustments. You’ll answer the two setup questions again.
                </p>
                <div className="reset-actions">
                  <button type="button" className="profile-secondary" disabled={resetBusy} onClick={() => setResetConfirmOpen(false)}>Cancel</button>
                  <button type="button" className="profile-danger" disabled={resetBusy} onClick={handleResetPersonalization}>
                    {resetBusy ? "Resetting…" : "Reset personalization"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      , document.body)}
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
/* Real rain footage replaces the synthetic streak animation. The static
   rain image remains underneath as a poster/fallback if autoplay is blocked. */
.rain-video {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
  object-fit: cover;
  object-position: center 48%;
  transform: scale(1.012);
  filter: saturate(.78) contrast(1.08) brightness(.82);
  opacity: .94;
}
.rain-video-light {
  opacity: .8;
  filter: saturate(.82) contrast(1.05) brightness(.9);
}
.rain-video-mod {
  opacity: .94;
  filter: saturate(.76) contrast(1.09) brightness(.8);
}
.rain-video-heavy {
  opacity: 1;
  filter: saturate(.68) contrast(1.13) brightness(.68);
}
.rain-severity-3 .backdrop { background: linear-gradient(180deg, rgba(2,9,19,.36) 0%, rgba(2,9,19,.46) 32%, rgba(2,9,19,.62) 70%, rgba(1,7,16,.78) 100%); }
@media (prefers-reduced-motion: reduce) {
  .rain-video { display: none; }
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
  /* Dedicated night photograph — only a light touch, it is already dark. */
  filter: saturate(.9) contrast(1.04) brightness(.92);
}
.night-mode.weather-cloudy .scene-image {
  filter: saturate(.68) contrast(1.08) brightness(.46);
}
.night-mode.weather-rain .scene-image {
  filter: saturate(.72) contrast(1.1) brightness(.44);
}
.night-mode .rain-video {
  filter: saturate(.62) contrast(1.12) brightness(.5);
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
.round-btn.is-refreshing .refresh-icon { animation: refreshSpin .8s linear infinite; }
@keyframes refreshSpin { to { transform: rotate(360deg); } }
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
.duration-chips { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.duration-chips .chip { width: 100%; padding-inline: 8px; white-space: nowrap; }
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
.card-sub { margin:4px 0 0; color:#718097; font-size:12.5px; line-height:1.35; }
.activity-head { align-items:flex-start; }
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
.threat-head {
  display:grid; grid-template-columns:minmax(110px,130px) minmax(0,1fr);
  align-items:end; gap:18px;
}
.scale {
  display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:4px; width:100%;
  font-family:'DM Mono',monospace; color:var(--muted-dark); font-size:10px;
  text-transform:uppercase; text-align:center;
}
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
.feedback-copy { margin:6px 0 16px; }
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
.sr-only {
  position:absolute !important; width:1px !important; height:1px !important;
  padding:0 !important; margin:-1px !important; overflow:hidden !important;
  clip:rect(0,0,0,0) !important; white-space:nowrap !important; border:0 !important;
}
.ob-wrap {
  position:relative; isolation:isolate; overflow:hidden;
  min-height:100vh; min-height:100dvh; display:flex; align-items:center; justify-content:center;
  padding:clamp(18px, 4vw, 44px);
  background:#0B1B2C; color:#112033;
}
.ob-scene {
  position:absolute; inset:-2%; z-index:-3;
  background-size:cover; background-position:center 54%;
  transform:scale(1.035);
  filter:saturate(.92) contrast(1.02);
}
.ob-backdrop {
  position:absolute; inset:0; z-index:-2;
  background:
    radial-gradient(circle at 78% 18%, rgba(255,211,122,.28), transparent 34%),
    linear-gradient(110deg, rgba(5,16,29,.77) 0%, rgba(7,20,35,.52) 42%, rgba(7,20,35,.20) 100%),
    linear-gradient(180deg, rgba(8,20,34,.08), rgba(8,20,34,.36));
}
.ob-card {
  position:relative; z-index:1; width:min(760px, 100%);
  border-radius:32px; padding:clamp(24px, 4vw, 40px);
  background:rgba(250,251,253,.965);
  border:1px solid rgba(255,255,255,.72);
  box-shadow:0 30px 90px rgba(3,10,19,.38);
  -webkit-backdrop-filter:blur(18px); backdrop-filter:blur(18px);
}
.ob-brand-row { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:18px; }
.ob-mark {
  font-family:'Outfit',sans-serif; color:#112033; font-size:22px; line-height:1;
  font-weight:850; letter-spacing:-.02em;
}
.ob-mark::before {
  content:""; display:inline-block; width:10px; height:10px; margin-right:9px;
  border-radius:3px; background:#E0A32E; box-shadow:6px 6px 0 rgba(224,163,46,.36);
  transform:translateY(-1px);
}
.ob-time {
  display:inline-flex; align-items:center; min-height:30px; padding:6px 10px;
  border-radius:999px; background:#EEF3F8; color:#637087;
  font:600 11px 'DM Mono',monospace; letter-spacing:.06em; text-transform:uppercase;
}
.ob-h {
  max-width:660px; font-family:'Outfit',sans-serif;
  font-size:clamp(42px, 7vw, 66px); line-height:.95; letter-spacing:-.045em;
  margin:0 0 14px; color:#112033;
}
.ob-p { max-width:620px; color:#58677E; font-size:clamp(16px,2vw,18px); line-height:1.52; margin:0 0 24px; }
.ob-value-strip {
  display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px;
  margin:0 0 28px; padding:8px; border-radius:18px; background:#F0F4F8;
}
.ob-value-strip span {
  min-width:0; display:flex; align-items:center; gap:9px;
  padding:10px 9px; color:#5B6980; font-size:12.5px; font-weight:650; line-height:1.25;
}
.ob-value-strip strong {
  flex:0 0 auto; width:24px; height:24px; display:grid; place-items:center;
  border-radius:8px; background:white; color:#B67813;
  font:700 11px 'DM Mono',monospace; box-shadow:0 2px 8px rgba(17,32,51,.07);
}
.ob-q { margin-bottom:22px; }
.ob-l { display:block; margin-bottom:10px; color:#243349; font-size:14px; font-weight:780; }
.ob-opts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; }
.ob-opts-row { grid-template-columns:repeat(3,minmax(0,1fr)); }
.ob-opt {
  position:relative; min-height:76px; border:1px solid #E1E8F0; background:#F7F9FC; border-radius:17px;
  padding:13px 36px 13px 14px; text-align:left; cursor:pointer; color:#112033;
  transition:transform .15s ease, border-color .15s ease, background-color .15s ease, box-shadow .15s ease;
}
.ob-opt:hover { transform:translateY(-1px); border-color:#C9D5E2; background:#FFF; }
.ob-opt.on {
  border-color:#E0A32E; background:#FFF8E9;
  box-shadow:0 0 0 2px rgba(224,163,46,.13), 0 7px 20px rgba(116,78,16,.08);
}
.ob-opt.on::after {
  content:"✓"; position:absolute; top:12px; right:13px; width:20px; height:20px;
  display:grid; place-items:center; border-radius:50%; background:#E0A32E; color:white;
  font-size:12px; font-weight:900;
}
.ob-opt-l { display:block; font-size:14px; font-weight:780; line-height:1.25; }
.ob-opt-n { display:block; margin-top:4px; color:#6D7A90; font-size:11.5px; line-height:1.35; }
.ob-backup {
  display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:12px;
  margin:4px 0 14px; padding:14px 15px; border:1px solid #E1E8F0; border-radius:17px;
  background:#F7F9FC; cursor:pointer; color:#112033;
}
.ob-backup > svg { color:#61718A; }
.ob-backup strong { display:block; font-size:13.5px; }
.ob-backup small { display:block; margin-top:3px; color:#718097; font-size:11.5px; line-height:1.35; }
.ob-backup input { position:absolute; opacity:0; pointer-events:none; }
.toggle-ui {
  position:relative; width:42px; height:24px; border-radius:999px; background:#CFD8E3;
  box-shadow:inset 0 0 0 1px rgba(17,32,51,.05); transition:background .18s ease;
}
.toggle-ui::after {
  content:""; position:absolute; top:3px; left:3px; width:18px; height:18px;
  border-radius:50%; background:white; box-shadow:0 2px 6px rgba(17,32,51,.22);
  transition:transform .18s ease;
}
.ob-backup.on { border-color:#C6D9CF; background:#F2F9F5; }
.ob-backup.on > svg { color:#31835A; }
.ob-backup.on .toggle-ui { background:#3F9A69; }
.ob-backup.on .toggle-ui::after { transform:translateX(18px); }
.ob-backup:has(input:focus-visible) { outline:3px solid rgba(224,163,46,.45); outline-offset:3px; }
.ob-privacy {
  margin:0 0 18px; padding:13px 14px; border-radius:15px;
  background:#F1F5F9; color:#59687F; font-size:12.5px; line-height:1.5;
  border:1px solid #E1E8F0;
}
.ob-go {
  width:100%; min-height:54px; border:none; cursor:pointer; background:#112033; color:white;
  border-radius:16px; padding:15px 18px; font:780 15px 'Instrument Sans',sans-serif;
  display:flex; justify-content:center; align-items:center; gap:9px;
  box-shadow:0 10px 26px rgba(17,32,51,.18); transition:transform .15s ease, background .15s ease;
}
.ob-go:hover:not(:disabled) { background:#24384F; transform:translateY(-1px); }
.ob-go:active:not(:disabled) { transform:translateY(0); }
.ob-go:disabled { opacity:.42; cursor:not-allowed; box-shadow:none; }
.ob-note { margin:11px 0 0; color:#7A8799; text-align:center; font-size:11.5px; line-height:1.4; }
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


.profile-trigger { position:relative; }
.profile-status-dot {
  position:absolute; right:4px; bottom:4px; width:9px; height:9px; border-radius:50%;
  background:#4BB477; border:2px solid rgba(23,42,64,.92); box-shadow:0 0 0 1px rgba(255,255,255,.3);
}
.profile-section-label {
  margin:18px 2px 9px; color:#7A8799;
  font:700 10.5px 'DM Mono',monospace; letter-spacing:.1em; text-transform:uppercase;
}
.account-block-muted { background:#F6F8FB; }
.account-block-signed { background:#F2F8F4; border-color:#D7E8DE; }
.round-btn.is-active { background: rgba(255,255,255,.28); box-shadow: inset 0 0 0 1px rgba(255,255,255,.28); }
.profile-overlay {
  --ink: #112033;
  --panel-border: #D9E2EC;
  position: fixed; inset: 0; width: 100vw; height: 100vh; height: 100dvh;
  z-index: 2147483000; isolation: isolate; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: rgba(5, 13, 24, .62);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  pointer-events: auto; overscroll-behavior: contain;
  font-family: 'Instrument Sans', system-ui, sans-serif;
}
.profile-panel {
  width: min(520px, 100%); max-height: min(760px, calc(100dvh - 40px)); overflow-y: auto;
  border-radius: 28px; padding: 24px; color: var(--ink); background: rgba(250,251,253,.985);
  box-shadow: 0 28px 90px rgba(0,0,0,.34); pointer-events: auto;
  overscroll-behavior: contain; -webkit-overflow-scrolling: touch; outline: none;
}
.profile-panel-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.profile-panel h2 { margin:0; font-family:'Outfit', sans-serif; font-size:30px; line-height:1.05; }
.profile-close {
  flex-shrink:0; width:44px; height:44px; padding:0; border-radius:50%;
  display:grid; place-items:center; border:1px solid #112033;
  background:#112033; color:#FFFFFF; box-shadow:0 6px 18px rgba(17,32,51,.18);
  -webkit-appearance:none; appearance:none; touch-action:manipulation;
}
.profile-close:hover { background:#263A52; border-color:#263A52; }
.profile-close:active { transform:scale(.96); }
.profile-close:focus-visible { outline:3px solid color-mix(in srgb, var(--accent) 62%, white); outline-offset:3px; }
.profile-intro { margin:16px 0 20px; color:#5E6D83; line-height:1.55; }
.profile-stat-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-bottom:18px; }
.profile-stat { padding:16px; border-radius:18px; background:#F1F4F8; display:flex; flex-direction:column; gap:4px; }
.profile-stat strong { font-family:'Outfit', sans-serif; font-size:22px; }
.profile-stat span { color:#718097; font-size:12.5px; }
.profile-storage-list { display:grid; gap:10px; }
.profile-storage-row { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:12px; align-items:start; padding:15px; border:1px solid #E4EAF1; border-radius:18px; background:white; }
.profile-storage-row > svg:first-child { color:#62728A; margin-top:2px; }
.profile-storage-row strong { display:block; margin-bottom:3px; font-size:14px; }
.profile-storage-row span { display:block; color:#718097; font-size:12.5px; line-height:1.45; }
.profile-ok { color:#4AA56A; }
.profile-storage-compact { align-items:center; }
.profile-note { margin:12px 2px 0; color:#718097; font-size:12.5px; line-height:1.45; }
.account-block { margin-top:18px; padding:16px; border-radius:18px; background:#F5F8FC; border:1px solid #E4EAF1; }
.account-head { display:flex; align-items:center; gap:8px; font-family:'Outfit', sans-serif; font-weight:700; font-size:13.5px; color:#26344A; }
.account-head svg { color:#4C7FB8; }
.account-copy { margin:9px 0 0; color:#5C6A82; font-size:13px; line-height:1.5; }
.account-providers { display:flex; flex-direction:column; gap:8px; margin-top:13px; }
.account-btn { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:13px 14px; border-radius:14px; border:1px solid #D3DDEA; background:#FFF; color:#23324A; font-family:'Instrument Sans', sans-serif; font-size:14px; font-weight:600; cursor:pointer; }
.account-btn:hover:not(:disabled) { background:#F0F5FB; border-color:#B9C9DE; }
.account-btn:disabled { opacity:.55; cursor:default; }
.account-cornell { background:#B31B1B; border-color:#B31B1B; color:#FFF; }
.account-cornell:hover:not(:disabled) { background:#9E1717; border-color:#9E1717; }
.account-email { margin-top:11px; }
.account-input { width:100%; padding:12px 13px; border-radius:13px; border:1px solid #D3DDEA; background:#FFF; font-family:'Instrument Sans', sans-serif; font-size:14.5px; color:#23324A; }
.account-input:focus { outline:none; border-color:#4C7FB8; box-shadow:0 0 0 3px rgba(76,127,184,.18); }
.account-email-actions { display:flex; gap:9px; margin-top:10px; }
.account-email-actions button { flex:1; }
.account-signed { display:flex; align-items:center; gap:11px; margin-top:12px; padding:12px 13px; border-radius:14px; background:#E9F5EE; border:1px solid #CBE6D7; }
.account-signed svg { color:#2F855A; flex-shrink:0; }
.account-signed strong { display:block; font-size:13.5px; color:#1F3D2C; }
.account-signed small { display:block; font-size:12px; color:#4A6B58; word-break:break-all; }
.account-out { display:inline-flex; align-items:center; gap:7px; margin-top:12px; }
.account-status { margin:11px 0 0; font-size:12.5px; line-height:1.45; }
.account-status.error { color:#B4462F; }
.account-status.sent, .account-status.ok { color:#2F855A; }
.account-fine { margin:12px 0 0; color:#8490A2; font-size:11.5px; line-height:1.45; }
.first-rate { margin-top:4px; }
.first-rate-copy { margin:0; font-size:14px; line-height:1.5; color:#43516A; }
.first-rate-go { display:inline-flex; align-items:center; gap:8px; margin-top:13px; padding:12px 16px; border-radius:14px; border:none; cursor:pointer; background:#23324A; color:#FFF; font-family:'Instrument Sans', sans-serif; font-size:14px; font-weight:600; }
.first-rate-go:hover { background:#16233A; }
.shift-src { font-style:normal; opacity:.72; }
.profile-actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:18px; }
.profile-primary, .profile-secondary {
  min-height:48px; border-radius:14px; padding:12px 16px; font-weight:800; cursor:pointer;
  -webkit-appearance:none; appearance:none; touch-action:manipulation;
  transition:transform .15s ease, background-color .15s ease, border-color .15s ease, box-shadow .15s ease;
}
.profile-primary {
  border:1px solid #112033; background:#112033; color:#FFFFFF;
  box-shadow:0 8px 22px rgba(17,32,51,.18);
}
.profile-primary:hover:not(:disabled) { background:#263A52; border-color:#263A52; }
.profile-primary:active:not(:disabled), .profile-secondary:active { transform:translateY(1px); }
.profile-secondary { border:1px solid #CBD6E2; background:#FFFFFF; color:#33445C; }
.profile-primary:disabled { background:#AAB4C1; border-color:#AAB4C1; color:#FFFFFF; opacity:1; cursor:default; box-shadow:none; }
.profile-primary:focus-visible, .profile-secondary:focus-visible {
  outline:3px solid color-mix(in srgb, var(--accent) 62%, white); outline-offset:3px;
}
.profile-secondary:hover { background:#F5F8FC; border-color:#B8C6D6; }
.profile-reset-link {
  margin:14px auto 0; border:0; background:transparent; color:#8A4B4B;
  display:inline-flex; align-items:center; justify-content:center; gap:7px;
  min-height:40px; padding:8px 12px; font:600 13px 'Instrument Sans', sans-serif; cursor:pointer;
}
.profile-reset-link:hover { color:#A53E3E; text-decoration:underline; text-underline-offset:3px; }
.profile-reset-link:focus-visible, .profile-danger:focus-visible { outline:3px solid rgba(188,73,73,.28); outline-offset:3px; }
.reset-confirm { margin-top:18px; padding:17px; border:1px solid #E9C9C9; border-radius:18px; background:#FFF7F7; }
.reset-title-row { display:flex; align-items:center; gap:9px; color:#9A3E3E; }
.reset-title-row h3 { margin:0; font-family:'Outfit',sans-serif; font-size:18px; color:#5B2C2C; }
.reset-confirm p { margin:9px 0 15px; color:#725B63; font-size:13px; line-height:1.5; }
.reset-actions { display:grid; grid-template-columns:1fr 1.2fr; gap:9px; }
.profile-danger {
  min-height:46px; padding:0 16px; border-radius:14px; border:1px solid #B84A4A;
  background:#B84A4A; color:white; font:700 14px 'Instrument Sans',sans-serif; cursor:pointer;
}
.profile-danger:hover:not(:disabled) { background:#A33D3D; border-color:#A33D3D; }
.profile-danger:disabled { opacity:.62; cursor:default; }

.data-source-footer {
  margin:26px auto 0; padding:10px 14px; width:max-content; max-width:100%;
  border-radius:999px; background:rgba(7,18,31,.38); color:rgba(240,245,252,.68);
  font-size:10.5px; line-height:1.4; text-align:center;
  -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
}
.data-source-footer a { color:rgba(255,255,255,.82); text-underline-offset:2px; }
.data-source-footer a:hover { color:#FFFFFF; }
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

@keyframes profileSheetIn {
  from { opacity: 0; transform: translateY(28px); }
  to { opacity: 1; transform: translateY(0); }
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
  .rain-video { object-position: 58% center; }
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
  .duration-chips { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .threat-head { grid-template-columns:1fr; align-items:stretch; gap:12px; }
  .scale { gap:4px; font-size:9px; }
  .threat {
    grid-template-columns: 1fr;
    align-items: stretch;
    gap: 10px;
  }
  .th-l { min-width: 0; }
  .meter { width: 100%; min-height: 9px; }
  .follow-line, .planner-head, .card-head { align-items: flex-start; }
  .ob-wrap { align-items:flex-start; padding:12px; }
  .ob-scene { background-position:57% center; }
  .ob-backdrop {
    background:
      linear-gradient(180deg, rgba(5,16,29,.40) 0%, rgba(5,16,29,.66) 42%, rgba(5,16,29,.78) 100%);
  }
  .ob-card { margin-top:max(8px, env(safe-area-inset-top)); padding:22px 17px; border-radius:26px; }
  .ob-brand-row { margin-bottom:15px; }
  .ob-time { font-size:9.5px; min-height:27px; }
  .ob-h { font-size:43px; }
  .ob-p { font-size:15px; margin-bottom:18px; }
  .ob-value-strip { grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; margin-bottom:22px; }
  .ob-value-strip span { flex-direction:column; justify-content:center; text-align:center; gap:6px; padding:8px 3px; font-size:10.5px; }
  .ob-opts { grid-template-columns:1fr; }
  .ob-opts-row { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .ob-opts-row .ob-opt { padding:12px 25px 12px 9px; text-align:center; }
  .ob-opts-row .ob-opt-l { font-size:12px; }
  .ob-opts-row .ob-opt.on::after { top:8px; right:7px; width:17px; height:17px; font-size:10px; }
  .ob-opt { min-height:0; }
  .ob-backup { align-items:start; }
  .toggle-ui { align-self:center; }
  .data-source-footer { width:100%; border-radius:16px; font-size:9.5px; }
  .profile-overlay {
    align-items:flex-end; padding: max(8px, env(safe-area-inset-top)) 0 0;
    background: rgba(5,13,24,.72);
    -webkit-backdrop-filter: none; backdrop-filter: none;
  }
  .profile-panel {
    width:100%; max-height:calc(100dvh - max(8px, env(safe-area-inset-top)));
    border-radius:28px 28px 0 0;
    padding:22px 18px calc(22px + env(safe-area-inset-bottom));
    animation: profileSheetIn .22s ease-out both;
  }
  .profile-panel h2 { font-size:27px; }
  .profile-stat-grid { grid-template-columns:1fr 1fr; }
  .profile-actions { display:grid; grid-template-columns:1fr; }
  .profile-primary, .profile-secondary { width:100%; min-height:52px; font-size:16px; }
  .reset-actions { grid-template-columns:1fr; }
  .profile-danger { min-height:52px; font-size:16px; }
  .profile-close { width:46px; height:46px; }
}
`;
