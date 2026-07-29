import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/Layer.jsx", import.meta.url), "utf8");
const sync = fs.readFileSync(new URL("../src/lib/sync.js", import.meta.url), "utf8");
const weather = fs.readFileSync(new URL("../src/lib/weather.js", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

const checks = [
  ["weather API requests current is_day", /current=[^`\n]*is_day/.test(source)],
  ["weather API requests hourly is_day", /hourly=[^`\n]*is_day/.test(source)],
  ["night-mode class is driven by daylight", /night-mode/.test(source) && /liveIsDay/.test(source)],
  ["sun threat is conditional on isDay", /if \(isDay\)[\s\S]*threats\.push\(\{ key: "sun"/.test(source)],
  ["sun factor applies only in daylight", /if \(isDay && cond\.clear/.test(source)],
  ["night clothing removes sun protection", /weatherLayers = isDay[\s\S]*sun protection/.test(source)],
  ["gender-neutral clothing labels are present", /breathable top/.test(source) && /Lightweight bottoms/.test(source)],
  ["empty threat levels do not force a filled bar", !/Math\.max\(t\.level,\s*1\)/.test(source)],
  ["cloud requires explicit opt-in", /return cloudPreference\(\) === "on"/.test(sync)],
  ["outbox removes only uploaded IDs", /uploadedIds[\s\S]*latest\.filter/.test(sync)],
  ["rain intensity reconciles WMO code with a measured rate", /rainIntensityFromRate/.test(weather) && /measured > 0 \|\| codedRain/.test(weather)],
  ["weather request includes current and 15-minute precipitation", /current=[^`\n]*,precipitation,/.test(source) && /minutely_15=[^`\n]*precipitation/.test(source)],
  ["weather refreshes automatically", /ACTIVE_RAIN_REFRESH_MS/.test(source) && /setInterval\(\(\) => loadWeather\(true\)/.test(source)],
  ["rain video follows live conditions", /liveCond\.category === "rain"/.test(source) && /rain-loop\.mp4/.test(source) && /<video/.test(source)],
  ["rain video resumes after app backgrounding", /visibilitychange/.test(source) && /pageshow/.test(source) && /resumeRainVideo/.test(source)],
  ["manual refresh restarts rain footage", /handleManualRefresh/.test(source) && /restart: true, reload: true/.test(source)],
  ["manual refresh updates the visible clock", /handleManualRefresh[\s\S]*setNow\(new Date\(\)\)/.test(source)],
  ["profile button opens a real profile panel", /layer-profile-panel/.test(source) && /setProfileOpen\(true\)/.test(source)],
  ["profile panel uses a body portal for mobile browsers", /createPortal/.test(source) && /document\.body/.test(source) && /100dvh/.test(source)],
  ["redundant activity-card planning link is removed", (source.match(/Plan a later time/g) || []).length === 1],
  ["activity choices explain their effect", /Choose one to tailor the recommendation/.test(source)],
  ["noninteractive clothing rows do not show false chevrons", !/className="wear-arrow"/.test(source)],
  ["profile copy is concise and user-focused", /Layer learns from your ratings/.test(source) && /Turn off cloud sync/.test(source) && /Personalization details/.test(source)],
  ["cloud sync copy explains the anonymous limitation", /cannot restore this profile on another device yet/.test(source)],
  ["synthetic rain streak overlay is removed", !/rain-overlay/.test(source) && !/@keyframes rainfall/.test(source)],
  ["onboarding heading is not duplicated", (source.match(/Cold is personal\./g) || []).length === 1],
  ["balanced outing durations are offered", /"20 min"/.test(source) && /"1 hr"/.test(source) && /"2 hrs"/.test(source) && /"4\+ hrs"/.test(source)],
  ["live rain uses the latest completed interval", /getLatestIndexAtOrBefore/.test(weather) && /rainSignalFromLocation/.test(weather)],
  ["overcast cannot mask measured rain", /Pure condition classifier/.test(weather) && weather.indexOf("if (measured > 0 || codedRain)") < weather.indexOf("if (value === 3)")],
  ["localised campus showers use a conservative multi-point fallback", /CAMPUS_RAIN_POINTS/.test(source) && /campusRainConsensus/.test(source) && /rainProbeUrl/.test(source)],
  ["rain condition controls the scene", /key: liveCond\.category/.test(source)],
  ["active rain adds waterproof clothing", /Waterproof rain jacket with hood/.test(source) && /Packable rain shell/.test(source)],
  ["current rain wording does not use the outing peak", /function extrasFor\(threats, cond\)/.test(source) && !/function extrasFor\(threats, cond, peakRainRate/.test(source)],
  ["light rain can warn about heavier rain later", /cond\.wetLevel < 3 && outingWetLevel >= 3/.test(source) && /Heavy rain may develop before you return/.test(source)],
  ["rain clothing covers the full outing window", /const outingWetLevel = Math\.max/.test(source) && /Heavier rain may develop before you return/.test(source)],
  ["departure time is absolute, not a live offset", /const \[departAt/.test(source) && /laterDepartureOptions/.test(source) && !/startOffset/.test(source)],
  ["temperature display uses actual air temperature now", /departAt == null \? "Temperature" : "Forecast"/.test(source) && /plan\.depart\.actual/.test(source)],
  ["standard apparent temperature is not duplicated in the hero", !/<span className="read-k">Feels like<\/span>/.test(source)],
  ["profile exposes a confirmed personalization reset", /Reset personalization/.test(source) && /Start fresh\?/.test(source) && /handleResetPersonalization/.test(source)],
  ["reset clears synced model, profile, events and pending feedback", /resetPersonalizationCloud/.test(sync) && /from\("events"\)\.delete/.test(sync) && /from\("profiles"\)\.delete/.test(sync) && /observations: 0/.test(sync) && /writeOutbox\(\[\]\)/.test(sync)],
  ["pending reset blocks stale cloud restoration", /hasPendingReset/.test(source) && /if \(hasPendingReset\(\)\) return/.test(source)],
  ["event rows can be deleted by their owner", /create policy "own events delete"/.test(schema)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
