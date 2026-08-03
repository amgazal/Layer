import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/Layer.jsx", import.meta.url), "utf8");
const sync = fs.readFileSync(new URL("../src/lib/sync.js", import.meta.url), "utf8");
const supa = fs.readFileSync(new URL("../src/lib/supabase.js", import.meta.url), "utf8");
const weather = fs.readFileSync(new URL("../src/lib/weather.js", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));

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
  ["profile copy clearly separates anonymous and account sync", /Profile & account/.test(source) && /How Layer has learned/.test(source) && /anonymous sync/i.test(source) && /Synced to your account/.test(source)],
  ["signing in automatically enables sync", /Sign in to sync your profile/.test(source) && /Signing in turns on account sync automatically/.test(source) && /onEnableCloud={connectCloud}/.test(source) && /prepareCloud/.test(source)],
  ["synthetic rain streak overlay is removed", !/rain-overlay/.test(source) && !/@keyframes rainfall/.test(source)],
  ["onboarding has one clear value proposition", (source.match(/Dress for how it feels to you\./g) || []).length === 1 && !/className="intro-card"/.test(source)],
  ["balanced outing durations are offered", /"20 min"/.test(source) && /"1 hr"/.test(source) && /"2 hrs"/.test(source) && /"4\+ hrs"/.test(source)],
  ["live rain uses the latest completed interval", /getLatestIndexAtOrBefore/.test(weather) && /rainSignalFromLocation/.test(weather)],
  ["overcast cannot mask measured rain", /Pure condition classifier/.test(weather) && weather.indexOf("if (measured > 0 || codedRain)") < weather.indexOf("if (value === 3)")],
  ["localised campus showers use a conservative multi-point fallback", /CAMPUS_RAIN_POINTS/.test(source) && /campusRainConsensus/.test(source) && /rainProbeUrl/.test(source)],
  ["rain condition controls the scene", /key: liveCond\.category/.test(source)],
  ["active rain adds waterproof clothing", /Waterproof rain jacket with hood/.test(source) && /Packable rain shell/.test(source)],
  ["current rain wording does not use the outing peak", /function extrasFor\(threats, cond\)/.test(source) && !/function extrasFor\(threats, cond, peakRainRate/.test(source)],
  ["light rain can warn about heavier rain later", /cond\.wetLevel < 3 && outingWetLevel >= 3/.test(source) && /Rain could become heavy before you return/.test(source)],
  ["rain clothing covers the full outing window", /const outingWetLevel = Math\.max/.test(source) && /rainOuterwear/.test(source)],
  ["rainy outfits avoid duplicate outerwear", /isOuterwearLayer/.test(source) && /!isOuterwearLayer\(layer\.label\)/.test(source)],
  ["weather guidance uses plain language", /A wind-blocking jacket will help/.test(source) && /rain could get heavier while you’re out/i.test(source) && !/Rain may strengthen/.test(source)],
  ["weather attribution never clutters the hero", !/className="data-credit"/.test(source)],
  ["feedback is clearly framed as post-outing", /How did the recommendation feel/.test(source) && /Rate it after your outing/.test(source)],
  ["not-followed feedback receives a simple thank-you", /Thanks — your feedback was saved\./.test(source) && !/did not retrain the model/.test(source)],
  ["planner uses concise feels-like wording", /<span>Feels like \{result\?\.rangeText/.test(source) && !/Official feels like/.test(source)],
  ["departure time is absolute, not a live offset", /const \[departAt/.test(source) && /laterDepartureOptions/.test(source) && !/startOffset/.test(source)],
  ["temperature display uses actual air temperature now", /departAt == null \? "Temperature" : "Forecast"/.test(source) && /plan\.depart\.actual/.test(source)],
  ["visible temperature badge matches the displayed arithmetic", /result\.displayShift !== 0/.test(source) && /temperatureShiftLabel\(result\.displayShift\)/.test(source) && !/° personal/.test(source)],
  ["standard apparent temperature is not duplicated in the hero", !/<span className="read-k">Feels like<\/span>/.test(source)],
  ["profile exposes a confirmed personalization reset", /Reset personalization/.test(source) && /Start fresh\?/.test(source) && /handleResetPersonalization/.test(source)],
  ["reset clears synced model, profile, events and pending feedback", /resetPersonalizationCloud/.test(sync) && /from\("events"\)\.delete/.test(sync) && /from\("profiles"\)\.delete/.test(sync) && /observations: 0/.test(sync) && /writeOutbox\(\[\]\)/.test(sync)],
  ["pending reset blocks stale cloud restoration", /hasPendingReset/.test(source) && /if \(hasPendingReset\(\)\) return/.test(source)],
  ["event rows can be deleted by their owner", /create policy "own events delete"/.test(schema)],
  ["queued feedback retries automatically with backoff", /scheduleRetry/.test(sync) && /RETRY_MAX_MS/.test(sync) && /addEventListener\("online"/.test(sync)],
  ["pending calibration is flushed when the page hides", /flushPendingModel/.test(sync) && /pagehide/.test(sync)],
  ["failed model push keeps the snapshot for retry", /if \(!pendingModel\) pendingModel = snapshot/.test(sync)],
  ["mobile layout blocks horizontal drift", /overflow-x: clip/.test(source) && /touch-action: pan-y/.test(source) && !/100vw - 18px/.test(source)],
  ["email auth uses a real static callback page", /auth-callback\.html/.test(supa) && /base: "\.\/"/.test(fs.readFileSync(new URL("../vite.config.js", import.meta.url), "utf8"))],
  ["oauth redirects are consumed by the client", /detectSessionInUrl: true/.test(supa) && /authRedirectUrl/.test(supa)],
  ["sign-in links an anonymous profile before falling back", /linkIdentity/.test(sync) && /signInWithOAuth/.test(sync)],
  ["only configured providers are offered", /VITE_AUTH_PROVIDERS/.test(supa) && /availableProviders/.test(sync)],
  ["explicit sign-in adopts the saved cloud profile", /auth\.signedInAt/.test(source) && /adoptedSignIn/.test(source)],
  ["night clear sky uses its own photograph", /clear-night\.webp/.test(source) && /function sceneSource/.test(source)],
  ["first rating is gated behind an explicit tap", /readyToRate/.test(source) && /Rate this outing/.test(source)],
  ["onboarding names anonymous cloud sync clearly", /Use anonymous cloud sync/.test(source) && /const \[allowCloud, setAllowCloud\] = useState\(false\)/.test(source)],
  ["onboarding privacy copy explains automatic account sync", /No account is required/.test(source) && /Signing in automatically turns on account sync/.test(source)],
  ["onboarding uses one unambiguous primary action", (source.match(/See my recommendation/g) || []).length === 1 && !/className="ob-secondary"/.test(source)],
  ["profile language changes truthfully after sign-in", /auth\.status === "permanent"/.test(source) && /follow you across devices/.test(source)],
  ["comfort levels use complete plain-language labels", /const LEVELS = \["None", "Low", "Medium", "High"\]/.test(source)],
  ["installable app metadata is present", /manifest\.webmanifest/.test(indexHtml) && /apple-mobile-web-app-capable/.test(indexHtml) && manifest.short_name === "Layer"],
  ["open-meteo attribution is discreet and linked in profile", /profile-about/.test(source) && /Weather data from/.test(source) && /open-meteo\.com\//.test(source) && !/data-source-footer/.test(source)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
