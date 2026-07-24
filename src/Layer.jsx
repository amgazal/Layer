import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudFog, CloudSun,
  Wind, Zap, Snowflake, Droplets, Check, Flame, MapPin, RefreshCw,
  Umbrella, ChevronDown, Footprints, Timer, Car, TrendingUp, X, ArrowRight,
  Bike, Clock3, AlertTriangle, UserRound, CircleHelp
} from "lucide-react";

const CAMPUS = {
  name: "Ithaca, NY",
  title: "Cornell University",
  subtitle: "Ithaca campus",
  lat: 42.4534,
  lon: -76.4735,
};

const MODEL_KEY = "layer:model:v5";
const CACHE_KEY = "layer:wx-cache:v5";
const CACHE_TTL = 15 * 60 * 1000;

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
];

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
      { label: "Lightest breathable top", note: "Linen or loose cotton." },
      { label: "Shorts or a thin skirt" },
      { label: "Cap and sunglasses" },
    ] },
  { key: "warm", min: 74, accent: "#E0A32E", sky: ["#7BB5FF", "#F6C56E"], verdict: "Warm and easy", sub: "One layer works.", layers: [
      { label: "T-shirt" },
      { label: "Light bottoms" },
      { label: "Thin layer for indoors", note: "Optional." },
    ] },
  { key: "mild", min: 65, accent: "#7AB560", sky: ["#7BA4CC", "#A8D09E"], verdict: "Comfortable", sub: "No bundling needed.", layers: [
      { label: "T-shirt or long sleeve" },
      { label: "Light sweater", note: "Optional." },
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

function decodeWeather(code) {
  const make = (label, Icon, extra = {}) => ({ label, Icon, wet: false, snow: false, clear: false, category: "cloudy", ...extra });
  if (code === 0) return make("Clear", Sun, { clear: true, category: "clear" });
  if (code <= 2) return make("Partly cloudy", CloudSun, { clear: true, category: "clear" });
  if (code === 3) return make("Overcast", Cloud, { category: "cloudy" });
  if (code === 45 || code === 48) return make("Fog", CloudFog, { category: "cloudy" });
  if (code >= 51 && code <= 57) return make("Drizzle", CloudDrizzle, { wet: true, category: "rain" });
  if (code >= 61 && code <= 67) return make("Rain", CloudRain, { wet: true, category: "rain" });
  if (code >= 71 && code <= 77) return make("Snow", CloudSnow, { snow: true, category: "snow" });
  if (code >= 80 && code <= 82) return make("Showers", CloudRain, { wet: true, category: "rain" });
  if (code >= 85 && code <= 86) return make("Snow showers", CloudSnow, { snow: true, category: "snow" });
  if (code >= 95) return make("Thunderstorm", Zap, { wet: true, category: "rain" });
  return make("Cloudy", Cloud, { category: "cloudy" });
}

function threatsFor({ effective, wind, cond, precip }) {
  const cold = effective < 25 ? 3 : effective < 38 ? 2 : effective < 50 ? 1 : 0;
  const windLevel = wind >= 24 ? 3 : wind >= 15 ? 2 : wind >= 8 ? 1 : 0;
  const wet = cond.snow || precip >= 60 ? 3 : precip >= 30 || cond.wet ? 2 : precip >= 15 ? 1 : 0;
  const sun = cond.clear && effective >= 82 ? 3 : cond.clear && effective >= 72 ? 2 : cond.clear ? 1 : 0;
  return [
    { key: "cold", label: "Cold", Icon: Snowflake, level: cold, blame: "The cold itself got me" },
    { key: "wind", label: "Wind", Icon: Wind, level: windLevel, blame: "The wind cut through" },
    { key: "wet", label: "Wet", Icon: Droplets, level: wet, blame: "I got wet" },
    { key: "sun", label: "Sun", Icon: Sun, level: sun, blame: "The sun was punishing" },
  ];
}

function extrasFor(threats, cond) {
  const out = [];
  const lv = (k) => threats.find((t) => t.key === k)?.level ?? 0;
  if (cond.snow) out.push({ Icon: Snowflake, text: "Waterproof boots — the ground will soak through." });
  else if (lv("wet") >= 2) out.push({ Icon: Umbrella, text: "Take a shell or umbrella." });
  if (lv("wind") >= 2) out.push({ Icon: Wind, text: "Make the outer layer wind resistant." });
  if (lv("sun") >= 2) out.push({ Icon: Sun, text: "Sunglasses and sunscreen if you’ll be out a while." });
  return out;
}

function getClosestHourlyIndex(times, targetMs) {
  if (!times?.length) return 0;
  let best = 0;
  let minDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i]).getTime() - targetMs);
    if (diff < minDiff) {
      minDiff = diff;
      best = i;
    }
  }
  return best;
}

function conditionWindow(hourly, startIndex, durationMinutes) {
  const hours = Math.max(1, Math.ceil(durationMinutes / 60));
  const end = Math.min(hourly.time.length - 1, startIndex + hours);
  const slice = (key) => hourly[key].slice(startIndex, end + 1);
  const apparent = slice("apparent_temperature");
  const actual = slice("temperature_2m");
  const wind = slice("wind_speed_10m");
  const precip = slice("precipitation_probability");
  const codes = slice("weather_code");
  return {
    startIndex,
    endIndex: end,
    apparent,
    actual,
    wind,
    precip,
    codes,
    depart: {
      actual: Math.round(actual[0]),
      apparent: Math.round(apparent[0]),
      wind: Math.round(wind[0]),
      precip: Math.round(precip[0] ?? 0),
      code: codes[0],
      time: hourly.time[startIndex],
    },
    minApparent: Math.round(Math.min(...apparent)),
    maxApparent: Math.round(Math.max(...apparent)),
    endApparent: Math.round(apparent[apparent.length - 1]),
    maxPrecip: Math.round(Math.max(...precip)),
    endPrecip: Math.round(precip[precip.length - 1] ?? 0),
  };
}

function formatTime(dateLike) {
  return new Date(dateLike).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function humanDate(dateLike) {
  return new Date(dateLike).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function outfitIcons(i) {
  const cycle = ["👕", "👖", "🧥", "🧣", "🧤"];
  return cycle[i % cycle.length];
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
        <button className="ob-go" disabled={!climate || !tol} onClick={() => onDone(climate, tol)}>
          Start <ArrowRight size={16} strokeWidth={2.6} />
        </button>
      </div>
    </div>
  );
}

export default function Layer() {
  const mounted = useRef(true);
  const [model, setModel] = useState(deepCopy(EMPTY_MODEL));
  const [ready, setReady] = useState(false);
  const [wx, setWx] = useState(null);
  const [wxState, setWxState] = useState("loading");
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

  useEffect(() => () => { mounted.current = false; }, []);

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
    persist(next);
  }, [persist]);

  useEffect(() => {
    (async () => {
      const saved = await storageGet(MODEL_KEY);
      if (saved?.value) {
        try { setModel(normalizeModel(JSON.parse(saved.value))); }
        catch {}
      }
      if (mounted.current) setReady(true);
    })();
  }, []);

  useEffect(() => {
    Object.values(BACKGROUNDS).forEach((src) => {
      const image = new Image();
      image.src = src;
    });
  }, []);

  const seed = useCallback((climateKey, tolKey) => {
    const climate = CLIMATES.find((x) => x.key === climateKey);
    const tol = TOLERANCE.find((x) => x.key === tolKey);
    const next = deepCopy(EMPTY_MODEL);
    next.seeded = true;
    for (const k of ["cold", "mild", "warm"]) {
      next.regime[k].off = clamp(climate.seed[k] + tol.adj, -CLAMP, CLAMP);
      next.regime[k].n = 0.6;
    }
    commit(next);
  }, [commit]);

  const loadWeather = useCallback(async (force = false) => {
    setWxState("loading");
    if (!force) {
      const c = await storageGet(CACHE_KEY);
      if (c?.value) {
        try {
          const parsed = JSON.parse(c.value);
          if (Date.now() - parsed.at < CACHE_TTL) {
            setWx(parsed.data);
            setWxState("cached");
            return;
          }
        } catch {}
      }
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${CAMPUS.lat}&longitude=${CAMPUS.lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation_probability` +
      `&hourly=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation_probability` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2`;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      const payload = {
        current: {
          actual: Math.round(data.current.temperature_2m),
          apparent: Math.round(data.current.apparent_temperature),
          code: data.current.weather_code,
          wind: Math.round(data.current.wind_speed_10m),
          precip: Math.round(data.current.precipitation_probability ?? 0),
          time: data.current.time,
        },
        hourly: data.hourly,
      };
      if (!mounted.current) return;
      setWx(payload);
      setWxState("live");
      await storageSet(CACHE_KEY, JSON.stringify({ at: Date.now(), data: payload }));
    } catch {
      if (!mounted.current) return;
      const now = new Date();
      const hourlyTimes = Array.from({ length: 12 }, (_, i) => new Date(now.getTime() + i * 60 * 60 * 1000).toISOString());
      setWx({
        current: { actual: 71, apparent: 72, code: 2, wind: 9, precip: 10, time: now.toISOString() },
        hourly: {
          time: hourlyTimes,
          temperature_2m: [71, 72, 73, 74, 75, 74, 73, 72, 70, 68, 67, 66],
          apparent_temperature: [72, 73, 74, 75, 76, 75, 74, 73, 71, 69, 68, 67],
          wind_speed_10m: [9, 10, 11, 10, 9, 8, 8, 8, 9, 10, 9, 8],
          precipitation_probability: [10, 8, 6, 5, 5, 5, 10, 12, 15, 16, 14, 12],
          weather_code: [2, 2, 2, 1, 1, 2, 2, 3, 3, 3, 2, 2],
        },
      });
      setWxState("offline");
    }
  }, []);

  useEffect(() => { loadWeather(); }, [loadWeather]);

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
    const index = getClosestHourlyIndex(wx.hourly.time, outingStart.getTime());
    const windowPlan = conditionWindow(wx.hourly, index, duration);

    if (startOffset === 0 && wx.current) {
      const apparentValues = [wx.current.apparent, ...windowPlan.apparent].filter(Number.isFinite);
      return {
        ...windowPlan,
        depart: {
          ...windowPlan.depart,
          actual: wx.current.actual,
          apparent: wx.current.apparent,
          wind: wx.current.wind,
          precip: wx.current.precip,
          code: wx.current.code,
          time: now.toISOString(),
        },
        minApparent: Math.round(Math.min(...apparentValues)),
        maxApparent: Math.round(Math.max(...apparentValues)),
      };
    }

    return windowPlan;
  }, [wx, outingStart, duration, startOffset, now]);

  const result = useMemo(() => {
    if (!plan) return null;
    const cond = decodeWeather(plan.depart.code);
    const base = plan.depart.apparent;
    let eff = base + pooledOffset(model, base);
    const windIntensity = clamp((plan.depart.wind - 6) / 14, 0, 1.4);
    eff -= windIntensity * model.factors.wind;
    if (cond.wet || cond.snow) eff -= model.factors.wet;
    if (cond.clear && base > 66) eff += model.factors.sun;
    eff += ACTIVITIES[activity].adj;
    if (cycling) eff += base < 55 ? -4 : base < 72 ? -2 : -1;

    const effective = Math.round(eff);
    const band = bandFor(effective);
    const threats = threatsFor({ effective, wind: plan.depart.wind + (cycling ? 6 : 0), cond, precip: plan.depart.precip });
    const personalShift = Math.round(eff - base);
    const tempDelta = Math.round(plan.endApparent - plan.depart.apparent);
    const laterConditions = plan.codes.slice(1).map(decodeWeather);
    const snowSoon = !cond.snow && laterConditions.some((condition) => condition.snow);
    const rainSoon = !cond.wet && !snowSoon && plan.maxPrecip >= 45;

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
    } else if (cond.clear && base >= 72) {
      whyLines.push("Direct sun can add warmth, especially during a longer walk.");
    } else if (duration >= 60) {
      whyLines.push(`The recommendation covers about ${duration === 60 ? "an hour" : `${duration / 60} hours`} outside.`);
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
      snowSoon,
      peakPrecip: plan.maxPrecip,
      whyLines: whyLines.slice(0, 3),
      cycling,
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
  }, [plan, result, model, activity, followed, commit]);

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
  const scene = scenicByCode(liveWeatherCode);
  const todayText = humanDate(now);
  const timeText = formatTime(now);
  const accent = result.band.accent;
  const ratingCount = model.history.length;
  const learningProgress = Math.min(95, Math.round((ratingCount / (ratingCount + 4)) * 100));
  const learningLabel = ratingCount === 0 ? "Starting profile" : `${learningProgress}% learned`;
  const planningSummary = `${startOffset === 0 ? "Leaving now" : `Leaving ${formatTime(outingStart)}`} • ${DURATIONS.find((d) => d.minutes === duration)?.label || `${duration} min`} outside${cycling ? " • Cycling" : ""}`;

  return (
    <div
      className={`lyr weather-${scene.key}`}
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
      <div className="app-shell">
        <header className="topbar">
          <div className="campus-id">
            <div className="campus-line"><MapPin size={14} strokeWidth={2.4} /><span>{CAMPUS.title}</span><small>{CAMPUS.subtitle}</small></div>
          </div>
          <div className="top-actions">
            {wxState === "offline" && <span className="pill">sample data</span>}
            <button className="round-btn" onClick={() => loadWeather(true)} aria-label="Refresh weather"><RefreshCw size={18} strokeWidth={2.2} /></button>
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
            <div className="hero-foot">{planningSummary}</div>
          </section>

          <aside className="planner glass card compact-planner planner-card">
            <div className="planner-head">
              <h2>Plan another outing</h2>
              <button className="link-btn" aria-expanded={planOpen} aria-controls="outing-planner-controls" onClick={() => setPlanOpen((v) => !v)}>
                {planOpen ? "Hide" : "Show"} <ChevronDown size={15} className={planOpen ? "open" : ""} />
              </button>
            </div>
            {planOpen && (
              <div id="outing-planner-controls" className="planner-body">
                <div className="plan-block">
                  <span className="mini-l">Leaving</span>
                  <div className="chips">
                    {START_OFFSETS.map((offset) => (
                      <button key={offset} className={`chip ${startOffset === offset ? "on" : ""}`} onClick={() => setStartOffset(offset)}>
                        {offset === 0 ? "Now" : formatTime(new Date(now.getTime() + offset * 60 * 60 * 1000))}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="plan-block">
                  <span className="mini-l">Outside for</span>
                  <div className="chips">
                    {DURATIONS.map((d) => (
                      <button key={d.minutes} className={`chip ${duration === d.minutes ? "on" : ""}`} onClick={() => setDuration(d.minutes)}>{d.label}</button>
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
                  <span className="wear-emoji">{outfitIcons(i)}</span>
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
            {(result.significantTempChange || result.rainSoon || result.snowSoon || result.cycling) && (
              <div className="warnbar" role="status" aria-live="polite">
                {result.significantTempChange && (
                  <span>
                    <AlertTriangle size={14} strokeWidth={2.4} />
                    It may feel {Math.abs(result.tempDelta)}° {result.tempDelta < 0 ? "colder" : "warmer"} by {formatTime(outingEnd)}.
                  </span>
                )}
                {result.snowSoon && <span><Snowflake size={14} strokeWidth={2.4} /> Snow may begin before you return.</span>}
                {result.rainSoon && <span><Umbrella size={14} strokeWidth={2.4} /> Rain risk rises to about {result.peakPrecip}% before you return.</span>}
                {result.cycling && <span><Bike size={14} strokeWidth={2.4} /> Cycling adds stronger wind exposure.</span>}
              </div>
            )}
          </section>

          <section className="card glass main-card activity-card">
            <div className="card-head inline-head">
              <h2 className="card-h">What’s the plan?</h2>
              <button className="plan-link" aria-expanded={planOpen} aria-controls="outing-planner-controls" onClick={() => setPlanOpen((v) => !v)}>
                More planning options <ChevronDown size={14} className={planOpen ? "open" : ""} />
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
                    <span className="meter">{[1,2,3,4].map((i) => <span key={i} className={`seg ${i <= Math.max(t.level,1) ? "fill" : ""}`} />)}</span>
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
                  {result?.threats.filter((t) => (askBlame === "cold" ? t.key !== "sun" : true)).map((t) => {
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
              <span>Saved on this device</span>
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
.weather-snow .scene-image { background-position: center 57%; filter: saturate(.78) brightness(1.04) contrast(1.02); }
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
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
.hero-foot { margin-top: 18px; font-size: 15px; color: rgba(255,255,255,.88); }
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
.wear-emoji {
  width: 48px; height: 48px; border-radius: 999px; display:inline-flex; align-items:center; justify-content:center;
  background: #FAF2DF; font-size: 24px;
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
.ob-go { border:none; cursor:pointer; background: var(--ink); color:white; border-radius: 18px; padding: 16px 18px; font-weight:700; display:inline-flex; align-items:center; gap: 8px; }
.ob-go:disabled { opacity: .4; cursor: not-allowed; }

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
  .wear-emoji { width: 42px; height: 42px; font-size: 22px; }
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
