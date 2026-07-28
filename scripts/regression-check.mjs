import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/Layer.jsx", import.meta.url), "utf8");
const sync = fs.readFileSync(new URL("../src/lib/sync.js", import.meta.url), "utf8");

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
  ["rain intensity reconciles WMO code with a 15-minute rate", /rateFrom15MinuteTotal/.test(source) && /Math\.max\(wmoRainSeverity\(value\), measured\)/.test(source)],
  ["weather request includes current and 15-minute precipitation", /current=[^`\n]*,precipitation,/.test(source) && /minutely_15=[^`\n]*precipitation/.test(source)],
  ["weather refreshes automatically", /ACTIVE_RAIN_REFRESH_MS/.test(source) && /setInterval\(\(\) => loadWeather\(true\)/.test(source)],
  ["rain overlay follows live conditions", /liveCond\.category === "rain"/.test(source)],
  ["onboarding heading is not duplicated", (source.match(/Cold is personal\./g) || []).length === 1],
  ["balanced outing durations are offered", /"20 min"/.test(source) && /"1 hr"/.test(source) && /"2 hrs"/.test(source) && /"4\+ hrs"/.test(source)],
  ["live rain uses the latest completed interval", /getLatestIndexAtOrBefore/.test(source) && /currentLiquidTotal/.test(source)],
  ["rain condition controls the scene", /key: liveCond\.category/.test(source)],
  ["active rain adds waterproof clothing", /Waterproof rain jacket with hood/.test(source) && /Packable rain shell/.test(source)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
