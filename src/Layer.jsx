import { buildOuting, outingTemperature } from "./lib/outing";
import { CACHE_KEY, CAMPUS_POINTS, fetchWeather, readWeatherCache, weatherTrust, weatherFreshness, locateOnce, activeCorrection, correctCurrent } from "./lib/weather-client";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudFog, CloudSun,
  Wind, Zap, Snowflake, Droplets, Check, Flame, MapPin, RefreshCw,
  Umbrella, ChevronDown, Footprints, Timer, Car, TrendingUp, X, ArrowRight, ArrowLeft,
  Bike, Clock3, AlertTriangle, UserRound, CircleHelp, Moon, CloudMoon,
  HardDrive, RotateCcw, Mail, LogOut, ShieldCheck
} from "lucide-react";
import {
  CLAMP, clamp, deepCopy, EMPTY_MODEL, normalizeModel,
  totalObservations, updateModel, seedModel, feedbackStreak,
} from "./lib/model";
import {
  classifyWeather,
  rainIntensityFromRate, rainSignalFromLocation,

} from "./lib/weather";
import { visibleTemperatureShift, temperatureShiftLabel } from "./lib/presentation";
import {
  ensureAuth, pullModel, pullProfile, pushModel, pushProfile, logEvent,
  flushOutbox, setCloudPref, subscribeCloud, retryCloud,
  subscribeAuth, currentAuth, hasPendingReset, resetPersonalizationCloud,
  availableProviders, startProviderAuth, sendEmailLink, signOutCloud,
  exchangeAuthCode,
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
const MODEL_KEY = "layer:model:v5";
const WEATHER_REFRESH_MS = 5 * 60 * 1000;
const ACTIVE_RAIN_REFRESH_MS = 2 * 60 * 1000;
// Open-Meteo is_day drives both automatic night dimming and sun-threat accuracy.

const ASSET_BASE = import.meta.env.BASE_URL;
const BACKGROUNDS = {
  clear: `${ASSET_BASE}backgrounds/clear.webp`,
  clearCampus: `${ASSET_BASE}backgrounds/clear-campus.webp`,
  partlyCampus: `${ASSET_BASE}backgrounds/partly-campus.webp`,
  sunsetCampus: `${ASSET_BASE}backgrounds/sunset-campus.webp`,
  clearNight: `${ASSET_BASE}backgrounds/clear-night.webp`,
  cloudy: `${ASSET_BASE}backgrounds/cloudy.webp`,
  rain: `${ASSET_BASE}backgrounds/rain.webp`,
  snow: `${ASSET_BASE}backgrounds/snow.webp`,
};

// Keep the scene stable for a whole day while still giving repeat users some
// visual variety. Weather always wins first: rain, snow and overcast keep their
// dedicated scenes; clear/partly-cloudy conditions can rotate among the user's
// own Cornell photographs.
function sceneSource(category, isDay, rawCode = 0, when = new Date()) {
  if (category === "clear" && !isDay) return BACKGROUNDS.clearNight;
  if (category !== "clear") return BACKGROUNDS[category];

  const code = Number(rawCode);
  const hour = when.getHours();

  // A warm sunset photograph is only used while Open-Meteo still reports
  // daylight, so Layer never shows a sunset in the middle of the night.
  if (hour >= 18 && hour <= 20) return BACKGROUNDS.sunsetCampus;
  if (code === 2) return BACKGROUNDS.partlyCampus;

  // Mainly-clear / clear days alternate between two Cornell scenes by date.
  return when.getDate() % 2 === 0 ? BACKGROUNDS.clearCampus : BACKGROUNDS.clear;
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

const seededModelFromSetup = seedModel;

const ACTIVITIES = {
  waiting: { label: "Standing", Icon: Timer, adj: -5, hint: "Stop, platform, queue" },
  walking: { label: "Walking", Icon: Footprints, adj: 2, hint: "Moving on foot" },
  dashing: { label: "Mostly sheltered", Icon: Car, adj: 6, hint: "Door to car to door" },
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
    { key: "wet", label: cond.snow ? "Snow & dampness" : "Rain & dampness", Icon: Droplets, level: wet, blame: "Rain or dampness" },
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


function LoadingScreen({ message = "Reading the weather on campus…" } = {}) {
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
        <span>{message}</span>
      </div>
    </div>
  );
}


function EmailSentView({ email, onBack }) {
  const address = String(email || "").trim();

  const openEmailApp = () => {
    // There is no browser-standard "open inbox" URL. mailto: hands off to the
    // user's preferred mail app without assuming Gmail, Outlook, or Apple Mail.
    window.location.href = "mailto:";
  };

  return (
    <div className="email-sent-view" role="status" aria-live="polite">
      <div className="email-sent-head">
        <button type="button" className="email-sent-back" aria-label="Use a different email" onClick={onBack}>
          <ArrowLeft size={20} strokeWidth={2.4} />
        </button>
        <strong>Email sent</strong>
        <span aria-hidden="true" />
      </div>

      <div className="email-sent-art" aria-hidden="true">
        <div className="email-sent-orbit" />
        <div className="email-sent-envelope">
          <Mail size={34} strokeWidth={1.8} />
          <span><Check size={15} strokeWidth={3} /></span>
        </div>
      </div>

      <h3>Check your email</h3>
      <p className="email-sent-copy">
        We sent a secure Layer sign-in link to <strong>{address}</strong>.
      </p>

      <button type="button" className="email-open-btn" onClick={openEmailApp}>
        <Mail size={18} strokeWidth={2.3} /> Open email app
      </button>

      <p className="email-sent-tip">
        Keep this Layer tab open. When you tap the link, Layer will hand the sign-in back to this tab when your browser allows it.
      </p>

      <button type="button" className="email-change-btn" onClick={onBack}>
        Use a different email
      </button>
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
function AccountSection({ auth, cloudState, ratingCount, onEnableCloud, intent = "link" }) {
  const providers = availableProviders();
  const [mode, setMode] = useState(null);        // null | "email"
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(null);        // provider key while redirecting
  const [status, setStatus] = useState(null);    // { kind, text }
  const [sentEmail, setSentEmail] = useState(null);

  useEffect(() => {
    if (!sentEmail || typeof document === "undefined") return undefined;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
    };
  }, [sentEmail]);

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
    // Returning users sign directly into their permanent account. Creating an
    // anonymous cloud session here causes the onboarding/auth UI to flicker and
    // can reconcile a temporary profile before the real account arrives.
    const ready = intent === "signin" ? true : await prepareCloud();
    if (!ready) { setBusy(null); return; }
    const res = await startProviderAuth(provider, { mode: intent, ...opts });
    if (!res.ok) {
      setBusy(null);
      setStatus({ kind: "error", text: res.error });
    }
    // On success the browser redirects, so no further state change is needed.
  };

  const submitEmail = async () => {
    setBusy("email");
    setStatus(null);
    const ready = intent === "signin" ? true : await prepareCloud();
    if (!ready) { setBusy(null); return; }
    const res = await sendEmailLink(email, { mode: intent });
    setBusy(null);
    if (res.ok) {
      setSentEmail(email.trim());
      setStatus(null);
      setMode(null);
    } else {
      setStatus({ kind: "error", text: res.error });
    }
  };

  const doSignOut = async () => {
    setBusy("out");
    const result = await signOutCloud();
    setBusy(null);
    setStatus(result.ok ? { kind: "ok", text: "Signed out. Your calibration stays on this device; cloud sync is off." } : { kind: "error", text: result.error });
  };

  if (!cloudConfigured) {
    return (
      <div className="account-block account-block-muted">
        <div className="account-head"><ShieldCheck size={17} strokeWidth={2.2} /><span>Account</span></div>
        <p className="account-copy">Account sign-in is not configured in this build. Your profile is still saved on this device.</p>
      </div>
    );
  }

  if (sentEmail && typeof document !== "undefined") {
    return createPortal(
      <div className="email-sent-overlay">
        <div className="email-sent-modal">
          <EmailSentView
            email={sentEmail}
            onBack={() => { setSentEmail(null); setMode("email"); setStatus(null); }}
          />
        </div>
      </div>,
      document.body,
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
        <p className="account-copy">Your ratings and settings sync automatically. Use the same account to restore them on another device.</p>
        <button type="button" className="profile-secondary account-out" disabled={busy === "out"} onClick={doSignOut}>
          <LogOut size={15} strokeWidth={2.2} /> {busy === "out" ? "Signing out…" : "Sign out"}
        </button>
        {status && <p className={`account-status ${status.kind}`} role={status.kind === "error" ? "alert" : "status"} aria-live="polite">{status.text}</p>}
      </div>
    );
  }

  return (
    <div className="account-block">
      <div className="account-head"><ShieldCheck size={17} strokeWidth={2.2} /><span>{intent === "signin" ? "Sign in to restore your profile" : "Sign in to sync your profile"}</span></div>
      <p className="account-copy">
        {intent === "signin"
          ? "Use the email or account you previously linked to Layer. Your saved personalization will load automatically."
          : ratingCount > 0
            ? `Save your ${ratingCount} rating${ratingCount === 1 ? "" : "s"} and personalization, then restore them on another device.`
            : "Signing in saves this profile to your account and makes it available on your other devices."}
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
        No password required. Signing in turns on account sync automatically.
      </p>
    </div>
  );
}

function Onboarding({
  onDone,
  cloudAvailable = true,
  auth,
  cloudState,
  onEnableCloud,
  notice = null,
}) {
  const [climate, setClimate] = useState(null);
  const [tol, setTol] = useState(null);
  const [allowCloud, setAllowCloud] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const canContinue = Boolean(climate && tol);

  useEffect(() => {
    if (auth?.status === "permanent") setShowSignIn(false);
  }, [auth?.status]);

  return (
    <div className="lyr ob-wrap">
      <style>{css}</style>
      <div
        className="ob-scene"
        style={{ backgroundImage: `url(${BACKGROUNDS.clearCampus})` }}
        aria-hidden="true"
      />
      <div className="ob-backdrop" aria-hidden="true" />
      <div className="ob-card glass">
        {notice && (
          <div className="ob-account-notice" role="status" aria-live="polite">
            <Check size={16} strokeWidth={2.8} /> <span>{notice}</span>
          </div>
        )}
        {showSignIn ? (
          <div className="ob-login-view">
            <div className="ob-login-head">
              <button
                type="button"
                className="ob-login-back"
                aria-label="Back to setup"
                onClick={() => setShowSignIn(false)}
              >
                <ArrowLeft size={19} strokeWidth={2.4} />
              </button>
              <span>Layer account</span>
              <span aria-hidden="true" />
            </div>
            <h1 className="ob-login-title">Welcome back.</h1>
            <p className="ob-login-copy">
              Sign in with the account you linked before. If it has a saved Layer profile, you’ll skip setup and pick up where you left off.
            </p>
            <AccountSection
              auth={auth}
              cloudState={cloudState}
              ratingCount={0}
              onEnableCloud={onEnableCloud}
              intent="signin"
            />
            <button type="button" className="ob-new-user" onClick={() => setShowSignIn(false)}>
              New to Layer? Set up a profile instead
            </button>
          </div>
        ) : (
          <>
            <div className="ob-brand-row">
              <div className="ob-mark">Layer</div>
              {auth?.status === "permanent" ? (
                <span className="ob-signed-entry" title={auth.email || "Signed in"}>
                  <Check size={14} strokeWidth={2.6} />
                  <span>Signed in</span>
                </span>
              ) : cloudAvailable ? (
                <button type="button" className="ob-signin-entry" onClick={() => setShowSignIn(true)}>
                  <UserRound size={15} strokeWidth={2.3} />
                  <span>Sign in</span>
                </button>
              ) : null}
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

            {cloudAvailable && auth?.status !== "permanent" && (
              <label className={`ob-backup ${allowCloud ? "on" : ""}`}>
                <Cloud size={20} strokeWidth={2.1} aria-hidden="true" />
                <span>
                  <strong>Use anonymous cloud sync</strong>
                  <small>Optional. Mirrors this browser profile; sign in later to restore it on other devices.</small>
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
              No account is required. Layer uses a fixed campus location unless you choose Use my location.
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
              {auth?.status === "permanent"
                ? "Your setup will be saved to your signed-in account."
                : cloudAvailable && allowCloud
                ? "Anonymous sync is on. Add an account later for cross-device recovery."
                : "Your profile stays on this device unless you choose sync later."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function Layer() {
  const mounted = useRef(true);
  const modelRevision = useRef(0);
  const rainVideoRef = useRef(null);
  const [model, setModel] = useState(deepCopy(EMPTY_MODEL));
  const [ready, setReady] = useState(false);
  const [wx, setWx] = useState(null);
  const weatherRequest = useRef(null);
  const weatherSnapshot = useRef(null);
  const [preciseMode, setPreciseMode] = useState(false);
  const [locationNotice, setLocationNotice] = useState(null);
  const [correction, setCorrection] = useState(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);

  const [wxState, setWxState] = useState("loading");
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState(null);
  const [activity, setActivity] = useState("walking");
  const [planOpen, setPlanOpen] = useState(false);
  const [departAt, setDepartAt] = useState(null); // null = leaving now; else absolute ms
  const [duration, setDuration] = useState(60);
  const [cycling, setCycling] = useState(false);
  const [askBlame, setAskBlame] = useState(null);
  const [toast, setToast] = useState(null);
  const [accountNotice, setAccountNotice] = useState(null);
  const [authExchangeBusy, setAuthExchangeBusy] = useState(false);
  const [accountRestore, setAccountRestore] = useState({ key: null, status: "idle" });
  const [restoreAttempt, setRestoreAttempt] = useState(0);
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

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; weatherRequest.current?.abort(); }; }, []);

  // Mobile Safari can preserve a tiny horizontal scroll offset after an auth
  // handoff or browser-tab transition. Layer has no horizontal navigation, so
  // clamp that offset whenever this page becomes active.
  useEffect(() => {
    const clampHorizontalScroll = () => {
      if (typeof window === "undefined") return;
      const y = window.scrollY || 0;
      if (window.scrollX !== 0) window.scrollTo(0, y);
      if (document.documentElement) document.documentElement.scrollLeft = 0;
      if (document.body) document.body.scrollLeft = 0;
    };
    clampHorizontalScroll();
    requestAnimationFrame(clampHorizontalScroll);
    window.addEventListener("pageshow", clampHorizontalScroll);
    window.addEventListener("orientationchange", clampHorizontalScroll);
    return () => {
      window.removeEventListener("pageshow", clampHorizontalScroll);
      window.removeEventListener("orientationchange", clampHorizontalScroll);
    };
  }, []);

  // Reflect background sync status in the UI (device-only | local | connecting
  // | active | unavailable) so calibration storage is never a mystery.
  useEffect(() => subscribeCloud((s) => { if (mounted.current) setCloudState(s); }), []);

  // Account identity (anonymous vs signed in), used by the profile panel.
  const [auth, setAuth] = useState(() => currentAuth());
  useEffect(() => subscribeAuth((a) => { if (mounted.current) setAuth(a); }), []);

  const handoffCode = useRef(null);
  const handoffBusy = useRef(false);

  // Finish email authentication inside the already-open Layer tab. The email
  // callback sends the one-time PKCE code over same-origin BroadcastChannel /
  // storage. Exchanging the code here keeps this tab in place instead of
  // navigating it to auth-callback.html and back (the visible flicker in the
  // mobile recording).
  useEffect(() => {
    const channelName = "layer-auth-handoff-v2";
    const storageKey = "layer:auth-code-handoff-v2";
    let channel = null;
    const reply = (type, nonce) => {
      const data = { type, nonce, at: Date.now() };
      try {
        const sender = new BroadcastChannel(channelName);
        sender.postMessage(data);
        sender.close();
      } catch {}
      try { localStorage.setItem("layer:auth-result-v2", JSON.stringify(data)); } catch {}
    };

    const acceptCode = async (data) => {
      if (handoffBusy.current || data?.type !== "layer-auth-code" || typeof data.code !== "string" || !data.code || handoffCode.current === data.code) return;
      if (data?.at && Date.now() - Number(data.at) > 2 * 60 * 1000) return;
      handoffCode.current = data.code;
      handoffBusy.current = true;
      setAuthExchangeBusy(true);
      reply("layer-auth-ack", data.nonce);

      const result = await exchangeAuthCode(data.code);
      handoffBusy.current = false;
      if (result.ok) {
        reply("layer-auth-complete", data.nonce);
        try { localStorage.removeItem(storageKey); } catch {}
        if (mounted.current) setAuthExchangeBusy(false);
        // SIGNED_IN now drives the normal permanent-account restoration effect.
        // Keep the loading state up until that effect finishes so onboarding
        // never flashes between authentication and model restoration.
        return;
      }

      handoffCode.current = null;
      if (mounted.current) {
        setAuthExchangeBusy(false);
        setAccountNotice(result.error || "Layer could not finish the sign-in. Request a new email link and try again.");
      }
      reply("layer-auth-error", data.nonce);
    };

    try {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = (event) => { acceptCode(event.data); };
    } catch {}

    const onStorage = (event) => {
      if (event.key !== storageKey || !event.newValue) return;
      try { acceptCode(JSON.parse(event.newValue)); } catch {}
    };
    window.addEventListener("storage", onStorage);

    // Covers a callback that arrived while Safari briefly suspended this tab.
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved) acceptCode(saved);
    } catch {}

    return () => {
      window.removeEventListener("storage", onStorage);
      try { channel?.close(); } catch {}
    };
  }, []);

  useEffect(() => {
    if (auth.status !== "permanent") return;
    let pending = false;
    let nonce = null;
    try {
      pending = sessionStorage.getItem("layer:auth-success-pending") === "1";
      nonce = sessionStorage.getItem("layer:auth-handoff-nonce");
    } catch {}
    if (!pending) return;

    setAccountNotice(auth.email
      ? `Signed in as ${auth.email}.`
      : "Signed in successfully.");

    if (nonce) {
      try {
        const channel = new BroadcastChannel("layer-auth-handoff-v2");
        channel.postMessage({ type: "layer-auth-complete", nonce });
        channel.close();
      } catch {}
    }
    try {
      sessionStorage.removeItem("layer:auth-success-pending");
      sessionStorage.removeItem("layer:auth-handoff-nonce");
      localStorage.removeItem("layer:auth-code-handoff-v2");
    } catch {}
  }, [auth.status, auth.email]);

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
    const previousFocus = document.activeElement;
    const closeOnEscape = (event) => {
      if (document.querySelector(".email-sent-overlay")) return;
      if (event.key === "Tab") {
        const elements = [...(profilePanelRef.current?.querySelectorAll("button:not(:disabled), input, a[href], [tabindex=\"0\"]") ?? [])];
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && (document.activeElement === first || !profilePanelRef.current?.contains(document.activeElement) || document.activeElement === profilePanelRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
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

    profilePanelRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [profileOpen]);

  const persist = useCallback(async (next) => {
    await storageSet(MODEL_KEY, JSON.stringify(next));
  }, []);

  const commit = useCallback((next) => {
    modelRevision.current += 1;
    setModel(next);
    persist(next);                              // local-first: write immediately
    pushModel(next, totalObservations(next));   // background cloud mirror (no-op if disabled)
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1) Local is the source of truth for first paint — never blocks on network.
      const saved = await storageGet(MODEL_KEY);
      if (cancelled) return;
      let localModel = null;
      if (saved?.value) {
        try { localModel = normalizeModel(JSON.parse(saved.value)); setModel(localModel); }
        catch {}
      }
      if (mounted.current) setReady(true);

      // Permanent accounts have a single reconciliation owner below.
      if (currentAuth().status === "permanent") return;

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
        const revision = modelRevision.current;
        const cloud = await pullModel();
        if (cancelled || !mounted.current || modelRevision.current !== revision || hasPendingReset() || currentAuth().status === "permanent") return;
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
    return () => { cancelled = true; };
  }, []);


  /**
   * After an explicit sign-in the user is saying "put my profile on this
   * device", so the cloud copy wins outright — unlike the ordinary background
   * reconciliation, which only adopts a richer cloud model. Without this, a new
   * phone that had already collected a couple of local ratings would keep them
   * and silently ignore the account it just signed into.
   */
  // A new identity/attempt is pending during render, before effects can run.
  // Never use a ref recording "started" as evidence that restoration completed.
  const restoreKey = auth.status === "permanent"
    ? `${auth.userId}:${auth.signedInAt}:${restoreAttempt}` : null;
  const restoreStatus = restoreKey
    ? (accountRestore.key === restoreKey ? accountRestore.status : "pending") : "idle";
  useEffect(() => {
    if (!ready || !restoreKey) return;
    let cancelled = false;
    const current = () => !cancelled && mounted.current
      && currentAuth().status === "permanent" && currentAuth().userId === auth.userId
      && currentAuth().signedInAt === auth.signedInAt;
    const finish = status => { if (current()) setAccountRestore({ key: restoreKey, status }); };
    const localModel = model;
    setAccountRestore({ key: restoreKey, status: "pending" });
    (async () => {
      try {
        if (hasPendingReset()) {
          await resetPersonalizationCloud(deepCopy(EMPTY_MODEL));
          if (hasPendingReset()) throw new Error("Reset pending");
        }
        if (!current()) return;
        const cloud = await pullModel();
        if (!current()) return;
        let restored = cloud?.model ? normalizeModel(cloud.model) : null;
        let attach = false;
        if (!restored?.seeded) {
          const savedProfile = await pullProfile();
          if (!current()) return;
          restored = seededModelFromSetup(savedProfile?.climate, savedProfile?.tolerance);
          // Only confirmed absence permits attaching a seeded device profile.
          if (!restored && localModel.seeded) restored = localModel;
          attach = Boolean(restored);
        }
        if (restored?.seeded) {
          modelRevision.current += 1;
          setModel(restored);
          await storageSet(MODEL_KEY, JSON.stringify(restored));
          if (!current()) return;
          if (attach) pushModel(restored, totalObservations(restored));
          setAccountNotice(attach
            ? "Your Layer profile is ready. Account sync will continue in the background."
            : "Welcome back — your saved Layer profile is ready.");
          finish("restored");
        } else {
          setAccountNotice("Signed in. No saved Layer profile was found yet — finish setup once to get started.");
          finish("empty");
        }
      } catch {
        finish("error");
      }
    })();
    return () => { cancelled = true; };
    // Local initialization must finish first. Later model updates must not
    // cancel an account restore or start another reconciliation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, restoreKey]);

  const seed = useCallback((climateKey, tolKey, allowCloud = false) => {
    // Permanent sign-in already opted into account sync; the anonymous
    // checkbox must not turn that off when a genuinely empty account seeds.
    allowCloud = auth.status === "permanent" || allowCloud;
    setCloudPref(allowCloud);
    setCloudState(allowCloud ? "connecting" : "device-only");
    const next = seededModelFromSetup(climateKey, tolKey);
    if (!next) return;
    commit(next);
    pushProfile({ climate: climateKey, tolerance: tolKey });
  }, [commit, auth.status]);

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
    } catch {
      setAccountNotice("Your saved profile could not load. Please retry sync.");
      return false;
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
    // Single flight includes JSON decoding; focus/pageshow/manual calls coalesce.
    if (weatherRequest.current) return;
    const ctrl = new AbortController();
    weatherRequest.current = ctrl;
    setWeatherRefreshing(true);
    let timer;
    try {
      if (!weatherSnapshot.current) {
        const stored = await storageGet(CACHE_KEY);
        const cached = readWeatherCache(stored?.value);
        if (cached && !preciseMode && mounted.current) {
          weatherSnapshot.current = cached;
          setWx(cached.data); setWeatherUpdatedAt(cached.at); setWxState('cached');
        }
      }
      const location = preciseMode ? await locateOnce() : null;
      const points = location?.points;
      if (ctrl.signal.aborted) return;
      if (preciseMode) setLocationNotice(location.issue === 'outside'
        ? 'Layer supports the Ithaca area. Showing Cornell campus weather.'
        : location.issue ? 'Location unavailable. Using Cornell campus weather.' : null);
      timer = setTimeout(() => ctrl.abort(), 10000);
      const payload = await fetchWeather({ points: points ?? CAMPUS_POINTS, signal: ctrl.signal, precise: !!points });
      if (!mounted.current || ctrl.signal.aborted) return;
      const at = Date.now();
      weatherSnapshot.current = { at, data: payload };
      setWx(payload); setWeatherUpdatedAt(at); setNow(new Date(at)); setWxState('live');
      // Precise lookups remain session-only, including their returned forecast.
      if (!points) await storageSet(CACHE_KEY, JSON.stringify({ at, data: payload }));
    } catch {
      if (!mounted.current || weatherRequest.current !== ctrl) return;
      setWxState(weatherSnapshot.current ? 'failed' : 'unavailable');
    } finally {
      clearTimeout(timer);
      if (weatherRequest.current === ctrl) weatherRequest.current = null;
      if (mounted.current && !weatherRequest.current) setWeatherRefreshing(false);
    }
  }, [preciseMode]);

  useEffect(() => { loadWeather(); return () => { weatherRequest.current?.abort(); weatherRequest.current = null; }; }, [loadWeather]);


  useEffect(() => {
    const current = wx?.current;
    const currentCond = current
      ? decodeWeather(current.code, current.isDay, current.precipRate)
      : null;
    const intervalMs = currentCond?.wet ? ACTIVE_RAIN_REFRESH_MS : WEATHER_REFRESH_MS;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") loadWeather(true); }, intervalMs);
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
    modelRevision.current += 1;

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

  const correctionActive = activeCorrection(correction, now.getTime());
  const displayWeather = useMemo(() => wx ? { ...wx, current: correctCurrent(wx.current, correction, now.getTime()) } : null, [wx, correction, now]);
  const trust = weatherTrust(wx, weatherUpdatedAt, now.getTime());
  const plan = useMemo(() => trust === 'unavailable' ? null : buildOuting(displayWeather,
    Math.max(outingStart.getTime(), now.getTime()), duration, departAt == null),
    [displayWeather, outingStart, duration, departAt, now, trust]);
  const reportConditions = (kind) => {
    const at = Date.now();
    setNow(new Date(at));
    setCorrection({ kind, at });
    setCorrectionOpen(false);
    // Coalesce an in-flight request; it is already an immediate refresh.
    loadWeather(true);
  };

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
    const outingWetLevel = Math.max(cond.wetLevel || 0, laterWetLevel, plan.maxPrecip >= 45 ? 1 : 0);
    const snowSoon = !cond.snow && laterConditions.some((condition) => condition.snow);
    const heavyRainSoon = !snowSoon && cond.wetLevel < 3 && outingWetLevel >= 3;
    const rainSoon = !cond.wet && !snowSoon && !heavyRainSoon && (
      outingWetLevel > 0 || plan.maxPrecip >= 45
    );

    const base = plan.depart.apparent;
    const thermal = outingTemperature(plan, model, activity, cycling);
    const eff = thermal.effective;
    const effective = thermal.effective;
    const baseBand = bandFor(thermal.wearEffective);
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

    if (thermal.cooling && duration >= 60) {
      const protection = bandFor(thermal.protective).layers.find(layer => isOuterwearLayer(layer.label))?.label || 'Sweater or fleece';
      weatherLayers.push({ label: `Bring: ${protection}`, note: 'Add it for the colder part of your outing.' });
    } else if (thermal.warming) {
      weatherLayers = weatherLayers.map(layer => ({ ...layer, note: isOuterwearLayer(layer.label) ? 'Wear at departure; remove as it warms.' : layer.note }));
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
      wind: plan.peakWind + (cycling ? 6 : 0),
      gust: plan.peakGust + (cycling ? 6 : 0),
      cond,
      precip: plan.maxPrecip,
      peakRainRate: plan.peakRainRate,
      isDay,
    });
    const personalShift = Math.round(eff - base);
    const displayShift = visibleTemperatureShift(plan.depart.actual, effective);
    const tempDelta = Math.round(plan.endApparent - plan.depart.apparent);
    const whyLines = [];
    const airTemperature = Math.round(plan.depart.actual);
    const officialFeelsLike = Math.round(base);
    if (airTemperature === officialFeelsLike && officialFeelsLike === effective) {
      whyLines.push(`The air temperature and your dress-for temperature are both ${effective}°.`);
    } else {
      whyLines.push(`Air temperature is ${airTemperature}°. The official feels-like reading is ${officialFeelsLike}°, and Layer recommends dressing for ${effective}°.`);
    }

    if (activity === "waiting") {
      whyLines.push("Standing still creates less body heat, so Layer recommends a little more warmth.");
    } else if (activity === "walking") {
      whyLines.push("Walking adds body heat, so Layer avoids unnecessary layers.");
    } else {
      whyLines.push("Sheltered travel reduces outdoor exposure, so Layer reduces insulation.");
    }

    if (cycling) {
      whyLines.push("Cycling makes the air feel windier, so a jacket that blocks wind will help.");
    } else if (threats.find(threat => threat.key === "wind")?.level >= 2) {
      whyLines.push(`Wind or gusts strengthen during this outing, so a wind-blocking layer helps.`);
    } else if (outingWetLevel > 0) {
      whyLines.push("Rain and damp clothing can make you feel colder, so a water-resistant layer helps.");
    } else if (isDay && cond.clear && base >= 72) {
      whyLines.push("Direct sun can add warmth, especially during a longer walk.");
    } else if (duration >= 60) {
      whyLines.push(`This outfit covers about ${durationLabel(duration).toLowerCase()} outside.`);
    }

    if (thermal.explanation) whyLines.splice(1, 0, thermal.explanation);
    return {
      effective,
      representativeApparent: thermal.representativeApparent,
      band,
      cond,
      threats,
      extras: extrasFor(threats, cond).map(extra => ({ ...extra, text: departAt == null ? extra.text : extra.text.replaceAll(" now", " at departure") })),
      personalShift,
      displayShift,
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
  }, [plan, model, activity, cycling, duration, departAt]);

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
    const feedbackAt = Date.now();
    setNow(new Date(feedbackAt));
    const withHistory = deepCopy(model);
    withHistory.history = [...withHistory.history, {
      at: feedbackAt,
      apparent: plan.depart.apparent,
      effective: result.effective,
      activity,
      followed,
      outcome: direction === 0 ? "right" : direction < 0 ? "cold" : "warm",
      blame: blameKey || null,
    }].slice(-80);

    // The calibration math lives in ./lib/model (pure + unit-tested).
    const next = updateModel(withHistory, {
      apparentTemp: result.representativeApparent,
      weatherCorrected: Boolean(correction) || trust !== "recent",
      direction,
      blameKey,
      followed,
    });

    commit(next);

    // Append to the cloud research log — richer than the trimmed local history,
    // and recorded for every outcome including "didn't follow".
    if (!correction && trust === "recent") logEvent({
      apparent: Math.round(plan.depart.apparent),
      effective: result.effective,
      actual: Math.round(plan.depart.actual),
      wind: Math.round(plan.depart.wind),
      precip: Math.round(plan.depart.precip),
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
    const streak = feedbackStreak(next.history);
    setToast(`${streak === 7 ? '7 days of feedback. Nice consistency.' : streak > 1
      ? `Nice — ${streak}-day feedback streak.` : 'Thanks — another outing rated.'}${correction || trust !== 'recent'
      ? ' Saved without adjusting your comfort profile because weather was uncertain.' : ''}`);

  }, [plan, result, model, activity, followed, commit, departAt, duration, cycling, wx, now, correction, trust]);

  const onFeedback = (kind) => {
    if (kind === "right") applyFeedback(0, null);
    else setAskBlame(kind);
  };

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!accountNotice) return;
    const id = setTimeout(() => setAccountNotice(null), 5200);
    return () => clearTimeout(id);
  }, [accountNotice]);

  if (!ready || auth.status === "checking") return <LoadingScreen />;
  if (authExchangeBusy || restoreStatus === "pending") {
    return <LoadingScreen message="Loading your saved Layer profile…" />;
  }
  if (restoreStatus === "error") return <div className="lyr weather-cloudy loading-screen"><style>{css}</style><main className="card glass unavailable" role="alert">
    <h1>Your saved profile couldn’t load</h1><p>Your account is signed in. Retry to restore your saved personalization.</p>
    <button className="profile-primary" onClick={() => setRestoreAttempt(n => n+1)}>Retry profile</button>
  </main></div>;
  if (!model.seeded) {
    return (
      <Onboarding
        onDone={seed}
        cloudAvailable={cloudState !== "local"}
        auth={auth}
        cloudState={cloudState}
        onEnableCloud={connectCloud}
        notice={accountNotice}
      />
    );
  }
  if (!plan || !result) {
    if (weatherRefreshing && !wx) return <LoadingScreen />;
    return <div className="lyr weather-cloudy loading-screen"><style>{css}</style>
      <main className="card glass unavailable" role="status"><h1>Weather unavailable</h1>
      <p>We couldn’t get trustworthy weather for this outing. Check your connection and try again.</p>
      <button className="profile-primary" onClick={handleManualRefresh} disabled={weatherRefreshing}>{weatherRefreshing ? 'Updating…' : 'Retry'}</button>
      {departAt != null && <button className="profile-secondary" onClick={() => setDepartAt(null)}>Return to now</button>}
      </main></div>;
  }

  const cond = result.cond;

  const liveWeatherCode = displayWeather?.current?.code ?? plan.depart.code ?? 3;
  const liveIsDay = Number(wx?.current?.isDay ?? plan.depart.isDay ?? 1) !== 0;
  const liveCond = decodeWeather(
    liveWeatherCode,
    liveIsDay ? 1 : 0,
    Number(displayWeather?.current?.precipRate ?? 0),
  );
  const scene = {
    key: liveCond.category,
    src: sceneSource(liveCond.category, liveIsDay, liveWeatherCode, now) ?? scenicByCode(liveWeatherCode).src,
  };
  const todayText = humanDate(now);
  const timeText = formatTime(now);
  const accent = result.band.accent;
  const ratingCount = model.history.length;
  const learningLabel = ratingCount === 0 ? "Starting profile" : "Learning from your feedback";
  const streak = feedbackStreak(model.history, now.getTime());
  const planningSummary = `${departAt == null ? "Leaving now" : `Leaving ${formatTime(outingStart)}`} • ${DURATIONS.find((d) => d.minutes === duration)?.label || `${duration} min`} outside${cycling ? " • Cycling" : ""}`;
  const weatherAgeText = weatherFreshness(weatherUpdatedAt, now.getTime(), trust, weatherRefreshing, wxState === 'failed');
  const ConditionIcon = liveCond.Icon;
  const conditionText = correctionActive ? `${correctionActive.kind === 'rain' ? 'Raining here' : correctionActive.kind === 'snow' ? 'Snowing here' : 'Dry here'} · your report`
    : ['nearby','campus'].includes(wx?.current?.rainScope) && liveCond.wet ? 'Passing shower around campus' : liveCond.label;

  return (
    <div
      className={`lyr weather-${scene.key} rain-severity-${liveCond.wetLevel}${liveCond.thunder ? " thunder-active" : ""}${liveIsDay ? "" : " night-mode"}`}
      data-weather-scene={scene.key}
      style={{ "--accent": accent }}
    >
      <style>{css}</style>
      {accountNotice && (
        <div className="account-success-toast" role="status" aria-live="polite">
          <Check size={17} strokeWidth={2.8} />
          <span>{accountNotice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setAccountNotice(null)}>
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>
      )}
      <div
        key={`${scene.key}-${liveIsDay ? "day" : "night"}`}
        className="scene-image"
        style={{ backgroundImage: `url(${scene.src})` }}
        aria-hidden="true"
      />
      {liveCond.category === "rain" && !rainVideoFailed && !reducedMotion && (
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
            <div className="campus-line"><MapPin size={14} strokeWidth={2.4} /><span>{CAMPUS.title}</span><small>{wx.locationLabel || "Campus"}</small></div>
          </div>
          <div className="top-actions">
            
            <button
              className={`round-btn${weatherRefreshing ? " is-refreshing" : ""}`}
              onClick={handleManualRefresh}
              aria-label={weatherRefreshing ? "Refreshing weather" : "Refresh weather"}
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
                <span className="read-v">{Math.round(plan.depart.actual)}°</span>
              </div>
              <ArrowRight size={18} strokeWidth={2.4} className="read-arrow" />
              <div className="read read-you">
                <span className="read-k">For you</span>
                <span className="read-v">{result.effective}°</span>
              </div>
              {result.displayShift !== 0 && (
                <span className="shift">
                  {temperatureShiftLabel(result.displayShift)}
                  {ratingCount === 0 && <em className="shift-src"> · includes your setup</em>}
                </span>
              )}
            </div>
            <div className="hero-foot"><span>{planningSummary}</span>{weatherAgeText && <span className={`weather-freshness${trust === 'stale' ? " is-stale" : ""}`}><span className="weather-age" role="status" aria-atomic="true">{weatherAgeText}</span>{!weatherRefreshing && (trust === 'stale' || wxState === 'failed') && <button className="weather-link" onClick={handleManualRefresh}>Refresh</button>}</span>}</div>
            <div className="weather-controls">
              <button className="weather-link" onClick={() => { setLocationNotice(null); setPreciseMode(v => !v); }}>{preciseMode ? 'Use campus location' : 'Use my location'}</button>
              <button className="weather-link" aria-expanded={correctionOpen} onClick={() => setCorrectionOpen(v => !v)}>Conditions look wrong?</button>
            </div>
            {locationNotice && <p role="status">{locationNotice}</p>}
            {correctionOpen && <div className="chips">{[['rain','Raining here'],['snow','Snowing here'],['dry','Dry here']].map(([kind,label]) => <button className="chip" key={kind} onClick={() => reportConditions(kind)}>{label}</button>)}</div>}
            {correctionActive && <p className="trust-note" role="status">Your report applies for 15 minutes on this device. <button className="weather-link" onClick={() => setCorrection(null)}>Clear report</button></p>}
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
            <label className={`toggle-row ride-toggle ${cycling ? "active" : ""}`}>
              <div className="toggle-copy">
                <Bike size={18} strokeWidth={2.2} />
                <span><strong>Bike or scooter</strong><small>Adjust for extra wind while riding.</small></span>
              </div>
              <input type="checkbox" checked={cycling} onChange={(e) => setCycling(e.target.checked)} />
              <span className="toggle-ui" />
            </label>
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
              </div>
            )}
            <div className="planner-summary">
              <span><Clock3 size={14} strokeWidth={2.2} /> {`${formatTime(outingStart)}–${formatTime(outingEnd)}`}</span>
              <span>Feels like {result?.rangeText || "--"}</span>
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
                {result.rainSoon && <span><Umbrella size={14} strokeWidth={2.4} /> Rain is possible before you return. Pack rain protection.</span>}
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
                    <span className="meter" role="img" aria-label={`${t.label}: ${LEVELS[t.level]}`}>{[0,1,2,3].map((i) => <span key={i} className={`seg ${i === t.level && t.level > 0 ? "fill" : ""}`} />)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card glass main-card feedback-card">
            {streak > 0 && <p className="feedback-streak"><Flame size={15} aria-hidden="true" />{streak}-day feedback streak</p>}
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
                <div className="blame-h"><span>What affected your comfort?</span><button className="icon-btn" aria-label="Cancel feedback" onClick={() => setAskBlame(null)}><X size={15} strokeWidth={2.4} /></button></div>
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
            {toast && <div className="toast" role="status">{toast}</div>}
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
              <p className="empty">Rate a few outings and Layer will begin showing your comfort feedback trend.</p>
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
                <div className="explain">Layer learns separate adjustments for cold, mild, and warm days. It can also learn whether wind, wetness, or sun affects you more than average. It learns from ratings for outfits you actually wore.</div>
              </div>
            )}
          </section>


        </main>
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
              <div className="profile-stat"><strong>{streak}</strong><span>day feedback streak</span></div>
            </div>

            <AccountSection
              auth={auth}
              cloudState={cloudState}
              ratingCount={ratingCount}
              onEnableCloud={connectCloud}
            />

            <div className="profile-section-label">Storage & sync</div>
            <div className="profile-storage-list">
              <div className="profile-storage-row profile-storage-compact">
                <HardDrive size={19} strokeWidth={2.1} />
                <div><strong>Saved on this device</strong><span>Your saved profile stays here. Fresh weather requires a connection.</span></div>
                <Check size={18} strokeWidth={2.4} className="profile-ok" />
              </div>
              <div className="profile-storage-row profile-storage-compact">
                <Cloud size={19} strokeWidth={2.1} />
                <div>
                  <strong>
                    {auth.status === "permanent"
                      ? "Synced to your account"
                      : cloudState === "active"
                        ? "Anonymous cloud sync on"
                        : cloudState === "connecting"
                          ? "Connecting"
                          : cloudState === "unavailable"
                            ? "Anonymous sync needs attention"
                            : cloudState === "local"
                              ? "Cloud sync not configured"
                              : "Device-only profile"}
                  </strong>
                  <span>
                    {auth.status === "permanent"
                      ? "Your ratings and settings can be restored on another device."
                      : cloudState === "active"
                        ? "This browser profile is mirrored online. Sign in for cross-device recovery."
                        : "Sign in to sync and restore this profile on other devices."}
                  </span>
                </div>
                {(auth.status === "permanent" || cloudState === "active") && <Check size={18} strokeWidth={2.4} className="profile-ok" />}
              </div>
            </div>

            {!resetConfirmOpen ? (
              <>
                <div className="profile-actions">
                  {auth.status !== "permanent" && cloudState !== "local" && (
                    <button
                      type="button"
                      className="profile-primary"
                      disabled={cloudActionBusy || cloudState === "connecting"}
                      onClick={handleCloudAction}
                    >
                      {cloudActionBusy || cloudState === "connecting"
                        ? "Connecting…"
                        : cloudState === "active"
                          ? "Turn off anonymous sync"
                          : cloudState === "unavailable"
                            ? "Retry anonymous sync"
                            : "Enable anonymous sync"}
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

            <div className="profile-about">
              <strong>About Layer</strong>
              <span>
                Weather data from <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
                {" under "}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.
                Layer adapts it into personalized outfit guidance.
              </span>
            </div>
          </section>
        </div>
      , document.body)}
    </div>
  );
}

const css = `
.unavailable { width:min(480px, calc(100% - 32px)); }
.weather-controls { display:flex; flex-wrap:wrap; gap:8px 18px; margin-top:12px; }
.weather-link { background:transparent; border:0; color:inherit; text-decoration:underline; text-underline-offset:4px; cursor:pointer; padding:8px 0; min-height:44px; }
.trust-note { font-size:14px; line-height:1.5; padding:12px; background:rgba(10,22,38,.6); border-radius:12px; }

@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Instrument+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');

.lyr {
  --ink: #112033;
  --muted: rgba(242, 246, 255, 0.84);
  --muted-dark: #4C5B70;
  min-height: 100vh;
  width: 100%;
  max-width: 100%;
  position: relative;
  overflow-x: hidden;
  overscroll-behavior-x: none;
  touch-action: pan-y;
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
  width: min(1120px, calc(100% - 32px));
  max-width: 100%;
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
  max-width: 100%; overflow-wrap: anywhere;
  margin-left: 10px; margin-bottom: 14px; font-family:'DM Mono',monospace; font-size: 12px; color: #FFE5A2;
  padding: 12px 16px; border-radius: 16px; background: rgba(240, 176, 54, .28); border: 1px solid rgba(255, 213, 124, .22);
}
.hero-foot { margin-top: 18px; font-size: 15px; color: rgba(255,255,255,.88); display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; }
.weather-age { font-size:12px; color:#fff; }
.weather-freshness { display:flex; align-items:center; flex-wrap:wrap; gap:4px 10px; max-width:100%; padding:2px 8px; border-radius:10px; background:#172538; }
.weather-freshness.is-stale { background:#44321c; }
.weather-freshness.is-stale .weather-age, .weather-freshness .weather-link { color:#ffdda0; }
.feedback-streak { display:flex; align-items:center; gap:6px; color:#785017; font-size:12px; margin:0 0 10px; }
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
  background: rgba(238, 179, 73, .16); color: #46556A; box-shadow: inset 0 0 0 1px rgba(234, 177, 73, .65);
}
.toggle-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 14px 16px; border-radius: 18px; background: #F7F9FC; border: 1px solid #E8EDF5;
}
.toggle-copy { display:flex; gap: 12px; align-items: center; }
.toggle-copy span { display:flex; flex-direction: column; }
.toggle-copy small { color: var(--muted-dark); font-size: 12px; }
.toggle-row input { position:absolute; opacity:0; width:1px; height:1px; }
.toggle-ui {
  width: 44px; height: 26px; border-radius: 999px; background: #D7DCE5; position: relative; transition: .2s ease;
}
.toggle-ui::after {
  content: ""; width: 20px; height: 20px; border-radius: 999px; background: white; position: absolute; top: 3px; left: 3px; transition: .2s ease;
  box-shadow: 0 2px 5px rgba(0,0,0,.16);
}
.toggle-row.active .toggle-ui { background: rgba(234, 177, 73, .85); }
.toggle-row.active .toggle-ui::after { left: 21px; }
.ride-toggle { margin-top: 14px; }
.ride-toggle strong { font-size: 14px; }
.planner-summary {
  margin-top: 18px; padding-top: 16px; border-top: 1px solid rgba(17, 32, 51, .08); color: #46556A;
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
.wear-num { font-size: 18px; color: #46556A; width: 20px; text-align: right; }
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
.why-toggle svg { color: #46556A; }
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
.why-panel li::marker { color: #46556A; }
.tipbar {
  margin: 10px -26px -24px; padding: 16px 22px; display:grid; gap: 10px;
  background: linear-gradient(180deg, rgba(248,243,232,1) 0%, rgba(249,245,236,.96) 100%); border-top: 1px solid rgba(227, 206, 158, .45);
}
.tip { display:flex; gap: 10px; align-items:flex-start; color:#42526a; font-size: 15px; }
.tip svg { color: #46556A; flex-shrink: 0; }
.warnbar { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 12px; color: #5f6f85; font-size: 14px; }
.warnbar span { display: inline-flex; align-items: center; gap: 8px; background:#F7F8FB; padding: 10px 12px; border-radius: 12px; }
.warnbar svg { color: #46556A; flex-shrink: 0; }
.card-sub { margin:4px 0 0; color:#4C5B70; font-size:12.5px; line-height:1.35; }
.activity-head { align-items:flex-start; }
.acts { display:flex; gap: 14px; }
.act {
  flex: 1; text-align: left; display:flex; flex-direction: column; gap: 6px; padding: 20px; border-radius: 24px; border: none;
  cursor: pointer; background: #F2F4F9; color: #39485F;
}
.act svg { color: #69788F; }
.act.on { background: rgba(248, 242, 225, .95); box-shadow: inset 0 0 0 2px rgba(234,177,73,.8); }
.act.on svg, .act.on .act-l { color: #4C5B70; }
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
.follow-q { color:#43536b; font-size: 15px; }
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
.metric-v { font-family:'Outfit', sans-serif; font-size: 54px; line-height: 1; font-weight: 800; color: #46556A; }
.metric-k { color:#586781; max-width: 270px; }
.delta { display:inline-flex; align-items:center; gap: 6px; margin-top: 10px; color:#66758A; font-size: 14px; font-weight: 700; }
.delta.up { color: #3D9560; }
.spark { display:flex; gap: 4px; margin-top: 14px; }
.sp { width: 18px; height: 18px; border-radius: 4px; background: rgba(17,32,51,.09); }
.sp.right { background: #6FB558; } .sp.cold { background: #7FB6DD; } .sp.warm { background: #E9B93F; }
.empty { margin: 0 0 18px; color:#4C5B70; }
.calibration-head { align-items: flex-start; }
.calibration-copy { margin: 8px 0 0; color:#4C5B70; line-height:1.45; max-width:560px; }
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
.ob-account-notice {
  display:flex; align-items:center; gap:8px; margin:-4px 0 16px; padding:10px 12px;
  border-radius:14px; background:#EAF6EF; border:1px solid #CDE8D8;
  color:#2D6F4E; font-size:12.5px; font-weight:700; line-height:1.4;
}
.ob-brand-row { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:18px; }
.ob-signin-entry {
  display:inline-flex; align-items:center; justify-content:center; gap:7px;
  min-height:38px; padding:8px 12px; border-radius:999px;
  border:1px solid #D6E0EA; background:#F5F8FC; color:#33445C;
  font:750 12.5px 'Instrument Sans',sans-serif; cursor:pointer;
  transition:background .15s ease, border-color .15s ease, transform .15s ease;
}
.ob-signin-entry:hover { background:#FFF; border-color:#BFCEDD; transform:translateY(-1px); }
.ob-signin-entry:active { transform:translateY(0); }
.ob-signed-entry {
  display:inline-flex; align-items:center; gap:6px; min-height:36px; padding:7px 11px;
  border-radius:999px; background:#EAF6EF; border:1px solid #CEE7D8; color:#2F7752;
  font:750 12px 'Instrument Sans',sans-serif;
}
.ob-login-view { min-height:420px; }
.ob-login-head {
  display:grid; grid-template-columns:42px 1fr 42px; align-items:center;
  gap:10px; margin-bottom:26px; color:#56657B;
  font:750 12px 'DM Mono',monospace; letter-spacing:.07em; text-transform:uppercase;
}
.ob-login-head > span:first-of-type { text-align:center; }
.ob-login-back {
  width:42px; height:42px; display:grid; place-items:center; border-radius:50%;
  border:1px solid #D6E0EA; background:#F5F8FC; color:#23324A; cursor:pointer;
}
.ob-login-back:hover { background:#FFF; border-color:#BFCEDD; }
.ob-login-title {
  margin:0 0 10px; color:#112033; font-family:'Outfit',sans-serif;
  font-size:clamp(38px,6vw,54px); line-height:1; letter-spacing:-.035em;
}
.ob-login-copy { margin:0 0 18px; color:#5E6D83; font-size:15px; line-height:1.55; max-width:58ch; }
.ob-login-view .account-block { margin-top:0; background:#F6F8FB; }
.ob-new-user {
  width:100%; margin-top:14px; min-height:44px; border:0; background:transparent;
  color:#5D6D84; font:700 12.5px 'Instrument Sans',sans-serif; cursor:pointer;
}
.ob-new-user:hover { color:#23324A; text-decoration:underline; text-underline-offset:3px; }
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
.ob-opt-n { display:block; margin-top:4px; color:#4C5B70; font-size:11.5px; line-height:1.35; }
.ob-backup {
  display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:12px;
  margin:4px 0 14px; padding:14px 15px; border:1px solid #E1E8F0; border-radius:17px;
  background:#F7F9FC; cursor:pointer; color:#112033;
}
.ob-backup > svg { color:#61718A; }
.ob-backup strong { display:block; font-size:13.5px; }
.ob-backup small { display:block; margin-top:3px; color:#4C5B70; font-size:11.5px; line-height:1.35; }
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
.ob-note { margin:11px 0 0; color:#4C5B70; text-align:center; font-size:11.5px; line-height:1.4; }
.sync-status { display:inline-flex; align-items:center; }
.sync-active { color:#2F855A !important; background:#E7F4EC !important; }
.sync-unavailable { color:#9A6A2E !important; background:#F6EEE0 !important; }
.sync-device-only { color:#5A6785 !important; }
.cloud-controls { margin: 12px 0 4px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.cloud-control-btn { border:1px solid #D3DDEA; background:white; color:#43506A; cursor:pointer; border-radius:12px; padding:9px 12px; font-weight:700; font-size:12.5px; }
.cloud-control-btn:hover:not(:disabled) { background:#F5F8FC; }
.cloud-control-btn:disabled { opacity:.55; cursor:default; }
.cloud-controls span { color:#4C5B70; font-size:12.5px; line-height:1.4; }
.upgrade-card { position:relative; border:1px solid #E4EBF3; }
.upgrade-x { position:absolute; top:14px; right:14px; border:none; background:none; cursor:pointer; color:#9AA6B8; padding:4px; border-radius:8px; }
.upgrade-x:hover { color:#43506A; background:#F1F5FA; }
.upgrade-h { font-family:'Outfit', sans-serif; font-weight:700; font-size:16px; margin-bottom:6px; }
.upgrade-p { color:#5C6A82; font-size:13.5px; line-height:1.5; margin:0 0 14px; max-width:46ch; }
.upgrade-row { display:flex; gap:8px; }
.upgrade-input { flex:1; min-width:0; border:1px solid #D3DDEA; border-radius:12px; padding:11px 13px; font-size:14px; font-family:'Instrument Sans', sans-serif; color:var(--ink); background:white; }
.upgrade-input:focus { outline:none; border-color:#46556A; box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.upgrade-go { border:none; cursor:pointer; background:var(--ink); color:white; border-radius:12px; padding:11px 18px; font-weight:700; font-size:14px; }
.upgrade-go:disabled { opacity:.5; cursor:default; }
.upgrade-err { margin-top:9px; color:#B4462F; font-size:12.5px; }
.upgrade-sent { display:flex; align-items:center; gap:10px; color:#2F855A; font-size:13.5px; line-height:1.45; }
.upgrade-sent svg { flex-shrink:0; }


.account-success-toast {
  position:fixed; z-index:2147482500; top:max(14px, env(safe-area-inset-top)); left:50%;
  transform:translateX(-50%); width:min(520px, calc(100% - 28px));
  display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:10px;
  padding:12px 13px; border-radius:16px; background:rgba(238,249,242,.98);
  border:1px solid #CBE5D6; color:#245E42; box-shadow:0 16px 45px rgba(6,20,33,.22);
  font:700 13px 'Instrument Sans',sans-serif; backdrop-filter:blur(12px);
}
.account-success-toast > svg { color:#3A9664; }
.account-success-toast button {
  width:30px; height:30px; display:grid; place-items:center; border:0; border-radius:50%;
  background:transparent; color:#4D6B5B; cursor:pointer;
}
.account-success-toast button:hover { background:#DCEFE4; }
.profile-trigger { position:relative; }
.profile-status-dot {
  position:absolute; right:4px; bottom:4px; width:9px; height:9px; border-radius:50%;
  background:#4BB477; border:2px solid rgba(23,42,64,.92); box-shadow:0 0 0 1px rgba(255,255,255,.3);
}
.profile-section-label {
  margin:18px 2px 9px; color:#4C5B70;
  font:700 10.5px 'DM Mono',monospace; letter-spacing:.1em; text-transform:uppercase;
}
.account-block-muted { background:#F6F8FB; }
.account-block-signed { background:#F2F8F4; border-color:#D7E8DE; }
.round-btn.is-active { background: rgba(255,255,255,.28); box-shadow: inset 0 0 0 1px rgba(255,255,255,.28); }
.profile-overlay {
  --ink: #112033;
  --panel-border: #D9E2EC;
  position: fixed; inset: 0; width: 100%; height: 100vh; height: 100dvh;
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
.profile-stat span { color:#4C5B70; font-size:12.5px; }
.profile-storage-list { display:grid; gap:10px; }
.profile-storage-row { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:12px; align-items:start; padding:15px; border:1px solid #E4EAF1; border-radius:18px; background:white; }
.profile-storage-row > svg:first-child { color:#4C5B70; margin-top:2px; }
.profile-storage-row strong { display:block; margin-bottom:3px; font-size:14px; }
.profile-storage-row span { display:block; color:#4C5B70; font-size:12.5px; line-height:1.45; }
.profile-ok { color:#4AA56A; }
.profile-storage-compact { align-items:center; }
.profile-note { margin:12px 2px 0; color:#4C5B70; font-size:12.5px; line-height:1.45; }
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
.account-fine { margin:12px 0 0; color:#4C5B70; font-size:11.5px; line-height:1.45; }
.email-sent-overlay {
  --ink:#112033;
  position:fixed; inset:0; z-index:2147483600; width:100%; height:100vh; height:100dvh;
  display:grid; place-items:center; padding:24px; background:rgba(7,16,29,.92);
  font-family:'Instrument Sans',system-ui,sans-serif; overflow:auto; overscroll-behavior:contain;
}
.email-sent-modal {
  width:min(440px,100%); border-radius:28px; background:#F8FAFC; color:#112033;
  box-shadow:0 28px 90px rgba(0,0,0,.38); overflow:hidden;
}
.email-sent-view { padding:22px; text-align:center; color:#112033; }
.email-sent-head {
  display:grid; grid-template-columns:44px 1fr 44px; align-items:center;
  margin-bottom:18px; color:#243349;
}
.email-sent-head strong { font-family:'Outfit',sans-serif; font-size:17px; }
.email-sent-back {
  width:42px; height:42px; display:grid; place-items:center; border-radius:50%;
  border:1px solid #D8E1EB; background:#FFF; color:#23324A; cursor:pointer;
}
.email-sent-back:hover { background:#F1F5F9; }
.email-sent-art {
  position:relative; width:132px; height:112px; margin:2px auto 12px;
  display:grid; place-items:center;
}
.email-sent-orbit {
  position:absolute; width:108px; height:108px; border-radius:50%;
  background:
    radial-gradient(circle at 68% 30%, rgba(242,189,76,.9) 0 13%, transparent 14%),
    linear-gradient(145deg, #19314D, #7C285F);
  opacity:.95;
}
.email-sent-envelope {
  position:relative; z-index:1; width:86px; height:62px; border-radius:15px;
  display:grid; place-items:center; background:#FFF; color:#34445B;
  border:1px solid rgba(17,32,51,.10); box-shadow:0 16px 32px rgba(17,32,51,.18);
}
.email-sent-envelope > span {
  position:absolute; right:-8px; bottom:-8px; width:28px; height:28px; border-radius:50%;
  display:grid; place-items:center; background:#3B9B68; color:#FFF;
  border:3px solid #F8FAFC;
}
.email-sent-view h3 { margin:0 0 7px; font-family:'Outfit',sans-serif; font-size:27px; }
.email-sent-copy { margin:0 auto; max-width:38ch; color:#5E6D83; font-size:14px; line-height:1.5; }
.email-sent-copy strong { color:#33445C; word-break:break-word; }
.email-open-btn {
  width:100%; min-height:50px; margin-top:18px; border:0; border-radius:15px;
  display:flex; align-items:center; justify-content:center; gap:9px;
  background:#112033; color:#FFF; font:800 14px 'Instrument Sans',sans-serif; cursor:pointer;
  box-shadow:0 10px 24px rgba(17,32,51,.18);
}
.email-open-btn:hover { background:#263A52; }
.email-sent-tip { margin:13px auto 0; max-width:44ch; color:#4C5B70; font-size:11.5px; line-height:1.5; }
.email-change-btn {
  margin-top:8px; min-height:38px; border:0; background:transparent; color:#526D91;
  font:700 12px 'Instrument Sans',sans-serif; cursor:pointer;
}
.email-change-btn:hover { text-decoration:underline; text-underline-offset:3px; }
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

.profile-about {
  margin-top:18px; padding-top:14px; border-top:1px solid #E2E8F0;
  display:grid; gap:4px; color:#4C5B70; font-size:11.5px; line-height:1.5;
}
.profile-about strong {
  color:#46556A; font:700 10.5px 'DM Mono',monospace; letter-spacing:.08em; text-transform:uppercase;
}
.profile-about a { color:#526D91; text-underline-offset:2px; }
.profile-about a:hover { color:#263A52; }
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
  .compact-planner { position: static; order: 3; }
  .activity-card { order: 4; }
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
  .app-shell { width: calc(100% - 18px); max-width: calc(100% - 18px); padding-top: 14px; }
  .scene-image, .rain-video { transform: none; }
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
  .ride-toggle { margin-top: 12px; padding: 12px 13px; }
  .ride-toggle .toggle-copy { gap: 10px; }
  .ride-toggle .toggle-copy small { line-height: 1.3; }
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
  .lyr.ob-wrap {
    width:auto; max-width:none; min-width:0;
    align-items:flex-start;
    padding-top:max(12px, env(safe-area-inset-top));
    padding-right:max(12px, env(safe-area-inset-right));
    padding-bottom:max(12px, env(safe-area-inset-bottom));
    padding-left:max(12px, env(safe-area-inset-left));
    overflow-x:hidden;
  }
  .ob-scene { background-position:57% center; }
  .ob-backdrop {
    background:
      linear-gradient(180deg, rgba(5,16,29,.40) 0%, rgba(5,16,29,.66) 42%, rgba(5,16,29,.78) 100%);
  }
  .ob-card {
    box-sizing:border-box; width:100%; max-width:760px; min-width:0; margin:0 auto;
    padding:22px 17px; border-radius:26px; overflow:hidden;
  }
  .ob-card > * { min-width:0; max-width:100%; }
  .ob-brand-row { width:100%; min-width:0; }
  .ob-mark { flex:0 1 auto; min-width:0; }
  .ob-signin-entry, .ob-signed-entry { flex:0 0 auto; max-width:44%; white-space:nowrap; }
  .ob-brand-row { margin-bottom:15px; }
  .ob-signin-entry { min-height:36px; padding:7px 10px; font-size:12px; }
  .ob-time { font-size:9.5px; min-height:27px; }
  .ob-login-view { min-height:0; }
  .ob-login-head { margin-bottom:20px; }
  .ob-login-title { font-size:40px; }
  .ob-login-copy { font-size:14px; }
  .ob-login-view .account-block { padding:14px; }
  .email-sent-overlay {
    place-items:stretch; padding:max(12px, env(safe-area-inset-top)) 0 0;
    background:#101923;
  }
  .email-sent-modal {
    width:100%; min-height:calc(100dvh - max(12px, env(safe-area-inset-top)));
    border-radius:28px 28px 0 0; display:grid; align-content:start;
  }
  .email-sent-view { padding:22px 20px calc(24px + env(safe-area-inset-bottom)); }
  .email-sent-art { width:126px; height:112px; margin-top:24px; }
  .email-sent-view h3 { font-size:25px; }
  .ob-h { font-size:clamp(38px, 11vw, 43px); overflow-wrap:anywhere; }
  .ob-p { font-size:15px; margin-bottom:18px; overflow-wrap:anywhere; }
  .ob-opt, .ob-backup, .account-block, .account-email, .email-sent-modal { min-width:0; max-width:100%; }
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
