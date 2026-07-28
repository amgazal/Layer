/**
 * Layer — backend smoke test.
 *
 * Proves the whole data path works BEFORE real users touch it:
 *   1. anonymous sign-in                     (auth is on)
 *   2. event upload with client_event_id     (the outbox insert)
 *   3. duplicate upload is a no-op           (idempotency / dedupe)
 *   4. read your own rows back               (own-row SELECT)
 *   5. a second user CANNOT read the first's (Row Level Security)
 *   6. model_state upsert + read back        (calibration mirror)
 *   7. invalid rows are rejected             (CHECK constraints)
 *
 * Run (Node 20.6+):
 *     node --env-file=.env scripts/smoke-test.mjs
 * or:
 *     SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/smoke-test.mjs
 *
 * Use a DEV Supabase project — it creates a few anonymous users and leaves a
 * couple of test rows (cleanup SQL is printed at the end).
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error("✗ Missing env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or SUPABASE_URL / SUPABASE_ANON_KEY).");
  process.exit(1);
}

const newClient = () =>
  createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const uuid = () => crypto.randomUUID();
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
};

const sampleEvent = (client_event_id) => ({
  client_event_id,
  apparent: 41, effective: 36, actual: 43, wind: 12, precip: 20,
  condition: "Cloudy", weather_code: 3, is_day: true,
  activity: "walking", start_offset: 0, duration: 30, cycling: false,
  band: "cold", followed: "yes", outcome: "cold", blame: "wind",
});

async function main() {
  console.log("\nLayer backend smoke test\n" + "─".repeat(40));

  // ── User A: sign in ──────────────────────────────────────────────
  const A = newClient();
  const { data: aAuth, error: aErr } = await A.auth.signInAnonymously();
  if (aErr) {
    console.error(`\n✗ Anonymous sign-in failed: ${aErr.message}`);
    console.error("  → Enable it in Supabase → Authentication → Providers → Anonymous sign-ins.\n");
    process.exit(1);
  }
  const userA = aAuth.user.id;
  check("anonymous sign-in (user A)", Boolean(userA));

  // ── Event upload ────────────────────────────────────────────────
  const evId = uuid();
  const { error: insErr } = await A.from("events")
    .upsert({ user_id: userA, ...sampleEvent(evId) }, { onConflict: "client_event_id", ignoreDuplicates: true });
  check("event upload", !insErr, insErr?.message);

  // ── Duplicate upload = no-op ────────────────────────────────────
  const { error: dupErr } = await A.from("events")
    .upsert({ user_id: userA, ...sampleEvent(evId) }, { onConflict: "client_event_id", ignoreDuplicates: true });
  const { count: dupCount } = await A.from("events")
    .select("*", { count: "exact", head: true }).eq("client_event_id", evId);
  check("duplicate upload rejected (idempotent)", !dupErr && dupCount === 1, `count=${dupCount}`);

  // ── Read own rows ───────────────────────────────────────────────
  const { data: mine } = await A.from("events").select("client_event_id").eq("client_event_id", evId);
  check("read own event back", mine?.length === 1);

  // ── RLS isolation: User B cannot see A's row ────────────────────
  const B = newClient();
  const { data: bAuth, error: bErr } = await B.auth.signInAnonymously();
  check("anonymous sign-in (user B)", !bErr && Boolean(bAuth?.user?.id));
  const { data: crossRead } = await B.from("events").select("client_event_id").eq("client_event_id", evId);
  check("RLS blocks cross-user read", (crossRead?.length ?? 0) === 0, `saw ${crossRead?.length} rows`);

  // ── model_state upsert + read ───────────────────────────────────
  const model = { v: 5, seeded: true, regime: { cold: { off: -4, n: 2 }, mild: { off: 0, n: 1 }, warm: { off: 1, n: 0 } }, factors: { wind: 2, wet: 0, sun: 0 }, history: [] };
  const { error: msErr } = await A.from("model_state")
    .upsert({ user_id: userA, model, observations: 3, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  const { data: msBack } = await A.from("model_state").select("model, observations").eq("user_id", userA).maybeSingle();
  check("model_state upsert + read", !msErr && msBack?.observations === 3 && msBack?.model?.regime?.cold?.off === -4);

  // ── CHECK constraints reject garbage ────────────────────────────
  const { error: badDur } = await A.from("events")
    .insert({ user_id: userA, client_event_id: uuid(), ...sampleEvent(uuid()), duration: -500 });
  check("constraint rejects duration = -500", Boolean(badDur), badDur ? "" : "row was accepted!");

  const { error: badAct } = await A.from("events")
    .insert({ user_id: userA, client_event_id: uuid(), ...sampleEvent(uuid()), activity: "airplane" });
  check("constraint rejects activity = 'airplane'", Boolean(badAct), badAct ? "" : "row was accepted!");

  // ── Summary ─────────────────────────────────────────────────────
  console.log("─".repeat(40));
  console.log(`${failed === 0 ? "✓ ALL PASSED" : "✗ FAILURES"}  ·  ${passed} passed, ${failed} failed\n`);
  console.log("Cleanup (run in the SQL editor if you want the test rows gone):");
  console.log(`  delete from public.events where user_id in ('${userA}', '${bAuth?.user?.id ?? ""}');`);
  console.log(`  delete from public.model_state where user_id = '${userA}';\n`);

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("\n✗ Unexpected error:", e.message); process.exit(1); });
