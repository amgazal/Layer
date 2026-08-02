import {
  supabase, cloudEnabled, authRedirectUrl, providerEnabled, CORNELL_DOMAIN,
} from "./supabase";

/**
 * Local-first sync layer.
 *
 * Guarantees:
 *   1. Rendering and local storage never wait for the network.
 *   2. Cloud access happens only after an explicit opt-in.
 *   3. Failed auth can be retried without reloading the page.
 *   4. Feedback is queued before upload and cannot be lost by an overlapping flush.
 *   5. Event uploads are idempotent through client_event_id.
 */

const PREF_KEY = "layer:cloud-pref"; // "on" | "off" | missing
const OUTBOX_KEY = "layer:outbox";
const RESET_PENDING_KEY = "layer:reset-pending";

function lsGet(key) {
  try { return window.localStorage?.getItem(key) ?? null; } catch { return null; }
}
function lsSet(key, value) {
  try { window.localStorage?.setItem(key, value); } catch {}
}
function lsRemove(key) {
  try { window.localStorage?.removeItem(key); } catch {}
}
const uuid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    }));

/* ── status emitter ─────────────────────────────────────────────────── */
// device-only | local | connecting | active | unavailable
let netState = "connecting";
const listeners = new Set();

export function cloudPreference() {
  return lsGet(PREF_KEY); // "on", "off", or null
}

export function cloudAllowed() {
  // Missing preference is deliberately device-only. This prevents an
  // anonymous account from being created before the user makes a choice.
  return cloudPreference() === "on";
}

export function cloudStatus() {
  if (!cloudEnabled) return "local";
  if (!cloudAllowed()) return "device-only";
  return netState;
}

export function subscribeCloud(fn) {
  listeners.add(fn);
  fn(cloudStatus());
  return () => listeners.delete(fn);
}

function emit() {
  const state = cloudStatus();
  listeners.forEach((fn) => fn(state));
}

function markNet(state) {
  if (state !== netState) {
    netState = state;
    emit();
  }
}

/* Declared here so opting out can cancel a pending model upload. */
let pushTimer = null;
let pendingModel = null;
let authPromise = null;

export function setCloudPref(allow) {
  lsSet(PREF_KEY, allow ? "on" : "off");

  if (!allow) {
    clearTimeout(pushTimer);
    pushTimer = null;
    pendingModel = null;
    markNet("device-only");
  } else {
    markNet("connecting");
    // Fire-and-forget. The caller may also await ensureAuth() when it wants
    // to reconcile immediately.
    ensureAuth();
    flushOutbox();
  }

  emit();
}

/* ── anonymous auth ─────────────────────────────────────────────────── */
export async function ensureAuth() {
  if (!cloudEnabled || !cloudAllowed()) return null;
  if (authPromise) return authPromise;

  markNet("connecting");
  authPromise = (async () => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (session?.user) return session.user;

      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      return data.user ?? null;
    } catch (error) {
      console.warn("[sync] anonymous sign-in failed:", error?.message || error);
      markNet("unavailable");
      return null;
    }
  })();

  const user = await authPromise;
  // Do not cache a failed promise forever. A temporary outage or a dashboard
  // setting change can now be retried in the same tab.
  if (!user) authPromise = null;
  return user;
}

export async function retryCloud() {
  if (!cloudEnabled || !cloudAllowed()) return false;
  authPromise = null;
  markNet("connecting");
  const user = await ensureAuth();
  if (!user) return false;
  await flushOutbox();
  return true;
}

/* ── model mirror ───────────────────────────────────────────────────── */
export async function pullModel() {
  if (!cloudEnabled || !cloudAllowed()) return null;
  try {
    const user = await ensureAuth();
    if (!user) return null;
    const { data, error } = await supabase
      .from("model_state")
      .select("model, observations, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    markNet("active");
    return data;
  } catch (error) {
    console.warn("[sync] model pull failed:", error?.message || error);
    markNet("unavailable");
    return null;
  }
}

async function uploadPendingModel() {
  pushTimer = null;
  if (!cloudAllowed()) { pendingModel = null; return; }

  const snapshot = pendingModel;
  pendingModel = null;
  if (!snapshot) return;

  try {
    const user = await ensureAuth();
    if (!user || !cloudAllowed()) return;
    const { error } = await supabase.from("model_state").upsert(
      {
        user_id: user.id,
        model: snapshot.model,
        observations: snapshot.observations,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    markNet("active");
  } catch (error) {
    console.warn("[sync] model push failed:", error?.message || error);
    markNet("unavailable");
    // Keep the snapshot so the next push or page-hide flush can retry it.
    if (!pendingModel) pendingModel = snapshot;
  }
}

export function pushModel(model, observations) {
  if (!cloudEnabled || !cloudAllowed()) return;
  pendingModel = { model, observations };
  clearTimeout(pushTimer);
  pushTimer = setTimeout(uploadPendingModel, 800);
}

/**
 * Force any debounced calibration write to go out now. Called when the page is
 * hidden or unloaded so a rating made immediately before closing the tab is not
 * lost with the 800 ms debounce still pending.
 */
export function flushPendingModel() {
  if (!cloudEnabled || !cloudAllowed() || !pendingModel) return;
  clearTimeout(pushTimer);
  uploadPendingModel();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingModel();
  });
  window.addEventListener?.("pagehide", flushPendingModel);
}

export async function pushProfile(profile) {
  if (!cloudEnabled || !cloudAllowed()) return;
  try {
    const user = await ensureAuth();
    if (!user || !cloudAllowed()) return;
    const { error } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        climate: profile.climate ?? null,
        tolerance: profile.tolerance ?? null,
        is_anonymous: user.is_anonymous ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw error;
    markNet("active");
  } catch (error) {
    console.warn("[sync] profile push failed:", error?.message || error);
    markNet("unavailable");
  }
}

/* ── durable event log (outbox) ─────────────────────────────────────── */
function readOutbox() {
  try {
    const value = JSON.parse(lsGet(OUTBOX_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeOutbox(events) {
  lsSet(OUTBOX_KEY, JSON.stringify(events.slice(-200)));
}

/**
 * Events produced before cloud consent stay local and are not retroactively
 * uploaded. Once opted in, each new event is queued first and uploaded second.
 */
export function logEvent(event) {
  if (!cloudEnabled || !cloudAllowed()) return;
  const queued = readOutbox();
  queued.push({ client_event_id: uuid(), ...event });
  writeOutbox(queued);
  flushOutbox();
}

let flushing = false;
/**
 * Automatic delivery.
 *
 * Queued feedback previously waited for the next app open or a manual retry, so
 * a rating made on flaky campus wifi could sit undelivered for days. During a
 * two-week study every rating is a data point, so delivery is now retried on a
 * capped exponential backoff and re-attempted whenever the device regains
 * connectivity or the app returns to the foreground.
 */
const RETRY_BASE_MS = 15 * 1000;
const RETRY_MAX_MS = 10 * 60 * 1000;
let retryTimer = null;
let retryAttempt = 0;

function cancelRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  retryAttempt = 0;
}

function scheduleRetry() {
  if (retryTimer || !cloudEnabled || !cloudAllowed()) return;
  if (readOutbox().length === 0) return;
  const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt, RETRY_MAX_MS);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    flushOutbox();
  }, delay);
}

/** Flush immediately when the device reconnects or the app is refocused. */
function attachDeliveryTriggers() {
  if (typeof window === "undefined") return;
  const attempt = () => {
    if (!cloudEnabled || !cloudAllowed()) return;
    if (readOutbox().length === 0) return;
    cancelRetry();          // a live signal beats waiting out the backoff
    flushOutbox();
  };
  window.addEventListener("online", attempt);
  window.addEventListener("focus", attempt);
  window.addEventListener("pageshow", attempt);
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "visible") attempt();
  });
}
attachDeliveryTriggers();

export async function flushOutbox() {
  if (!cloudEnabled || !cloudAllowed() || flushing) return;
  const batch = readOutbox();
  if (batch.length === 0) return;

  flushing = true;
  let uploaded = false;
  try {
    const user = await ensureAuth();
    if (!user || !cloudAllowed()) { if (user === null) scheduleRetry(); return; }

    const rows = batch.map((event) => ({ user_id: user.id, ...event }));
    const { error } = await supabase
      .from("events")
      .upsert(rows, { onConflict: "client_event_id", ignoreDuplicates: true });
    if (error) throw error;

    // Remove only the events that belonged to this upload batch. If a new
    // feedback event was added while the request was in flight, it remains.
    const uploadedIds = new Set(batch.map((event) => event.client_event_id));
    const latest = readOutbox();
    writeOutbox(latest.filter((event) => !uploadedIds.has(event.client_event_id)));
    uploaded = true;
    cancelRetry();          // delivery succeeded: reset the backoff
    markNet("active");
  } catch (error) {
    console.warn("[sync] event upload failed:", error?.message || error);
    markNet("unavailable");
    scheduleRetry();        // keep trying in the background
  } finally {
    flushing = false;
    if (uploaded && cloudAllowed() && readOutbox().length > 0) {
      setTimeout(() => flushOutbox(), 0);
    }
  }
}


export function hasPendingReset() {
  return lsGet(RESET_PENDING_KEY) === "1";
}

/**
 * Clears every piece of personalised data that Layer owns for the current
 * anonymous profile. Local data is cleared immediately; cloud cleanup is
 * attempted when a Supabase session exists and is retried the next time cloud
 * sync is enabled if the network is unavailable.
 */
export async function resetPersonalizationCloud(emptyModel) {
  clearTimeout(pushTimer);
  pushTimer = null;
  pendingModel = null;
  writeOutbox([]);
  lsSet(RESET_PENDING_KEY, "1");

  if (!cloudEnabled) {
    lsRemove(RESET_PENDING_KEY);
    return { ok: true, cloud: "not-configured" };
  }

  try {
    let user = null;
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    user = session?.user ?? null;

    // When cloud sync is currently enabled, create/recover the anonymous session
    // so the reset can also clear its server-side data. If sync is off and no
    // session exists, there is no reachable cloud profile to delete yet; the
    // pending marker prevents an older cloud model from being restored later.
    if (!user && cloudAllowed()) user = await ensureAuth();
    if (!user) return { ok: true, cloud: "pending" };

    const results = await Promise.all([
      supabase.from("events").delete().eq("user_id", user.id),
      supabase.from("profiles").delete().eq("id", user.id),
      supabase.from("model_state").upsert(
        {
          user_id: user.id,
          model: emptyModel,
          observations: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      ),
    ]);

    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;

    lsRemove(RESET_PENDING_KEY);
    markNet(cloudAllowed() ? "active" : "device-only");
    return { ok: true, cloud: "cleared" };
  } catch (error) {
    console.warn("[sync] personalization reset failed:", error?.message || error);
    if (cloudAllowed()) markNet("unavailable");
    return { ok: false, cloud: "pending", error: error?.message || "Cloud cleanup will retry later." };
  }
}

/* ── account identity ───────────────────────────────────────────────── */
// status: none | anonymous | permanent
let authInfo = { status: "none", email: null, provider: null, signedInAt: 0 };
const authListeners = new Set();

export function currentAuth() { return authInfo; }
export function subscribeAuth(fn) {
  authListeners.add(fn);
  fn(authInfo);
  return () => authListeners.delete(fn);
}
function setAuth(next) {
  authInfo = next;
  authListeners.forEach((fn) => fn(next));
}

if (cloudEnabled) {
  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user;
    if (!user) {
      authPromise = null;
      setAuth({ status: "none", email: null, provider: null, signedInAt: 0 });
      return;
    }

    const permanent = user.is_anonymous === false;
    const provider = user.app_metadata?.provider ?? (user.email ? "email" : null);
    setAuth({
      status: permanent ? "permanent" : "anonymous",
      email: user.email ?? null,
      provider: permanent ? provider : null,
      // A fresh SIGNED_IN on a permanent account means "bring my profile here",
      // which the app uses to adopt the cloud model even if this device has
      // more local observations.
      signedInAt: permanent && event === "SIGNED_IN" ? Date.now() : authInfo.signedInAt,
    });

    if (permanent) {
      supabase.from("profiles")
        .update({ is_anonymous: false, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .then(() => {}, () => {});
    }
  });
}

/* ── sign-in / account linking ──────────────────────────────────────
 * Two different intentions, and conflating them loses data:
 *
 *   LINK  — "save the profile I already built here." The user is anonymous,
 *           so we attach an identity to the SAME user id and every existing
 *           model_state / events row carries over untouched.
 *
 *   SIGN IN — "I already have a profile, put it on this device." This starts a
 *           new session for the existing account and the app then adopts the
 *           cloud model.
 *
 * Linking fails when that identity already belongs to another account, which is
 * exactly the "second device" case — so we fall back to signing in.
 */

export function availableProviders() {
  if (!cloudEnabled) return { email: false, google: false, apple: false, cornell: false };
  return { email: true, ...providerEnabled };
}

function oauthOptions(provider, { cornell = false } = {}) {
  const options = { redirectTo: authRedirectUrl() };
  if (cornell && provider === "google") {
    // Domain hint so Cornell users land on the right account chooser. This is a
    // hint, not enforcement — see PILOT_LAUNCH.md.
    options.queryParams = { hd: CORNELL_DOMAIN, prompt: "select_account" };
  }
  return options;
}

/**
 * Start a provider flow. Redirects the browser, so nothing after this resolves
 * in the normal case.
 * @param provider "google" | "apple"
 * @param mode     "link" (save current anonymous profile) | "signin"
 */
export async function startProviderAuth(provider, { mode = "link", cornell = false } = {}) {
  if (!cloudEnabled) return { ok: false, error: "Cloud sync is not configured." };
  if (!cloudAllowed()) return { ok: false, error: "Turn on cloud sync first." };

  const options = oauthOptions(provider, { cornell });
  try {
    if (mode === "link") {
      const user = await ensureAuth();
      // Only anonymous users can link; a permanent user is already saved.
      if (user?.is_anonymous) {
        const { error } = await supabase.auth.linkIdentity({ provider, options });
        if (!error) return { ok: true, mode: "link" };
        // Identity belongs to an existing account, or manual linking is off.
        // Signing in is the correct behaviour for a second device.
        console.warn("[auth] link failed, falling back to sign-in:", error.message);
      }
    }
    const { error } = await supabase.auth.signInWithOAuth({ provider, options });
    if (error) return { ok: false, error: error.message };
    return { ok: true, mode: "signin" };
  } catch (error) {
    return { ok: false, error: error?.message || "Sign-in could not start." };
  }
}

/**
 * Email link. For an anonymous user this attaches the address to the current
 * profile (data carries over). Otherwise it sends a normal sign-in link.
 */
export async function sendEmailLink(email, { mode = "link" } = {}) {
  if (!cloudEnabled) return { ok: false, error: "Cloud sync is not configured." };
  if (!cloudAllowed()) return { ok: false, error: "Turn on cloud sync first." };
  const address = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  try {
    if (mode === "link") {
      const user = await ensureAuth();
      if (user?.is_anonymous) {
        const { error } = await supabase.auth.updateUser(
          { email: address },
          { emailRedirectTo: authRedirectUrl() },
        );
        if (!error) return { ok: true, mode: "link" };
        console.warn("[auth] email link failed, falling back to sign-in:", error.message);
      }
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, mode: "signin" };
  } catch (error) {
    return { ok: false, error: error?.message || "Could not send the link." };
  }
}

/**
 * Sign out and immediately return to an anonymous profile so the app keeps
 * working. Local calibration is untouched; the cloud copy stays on the account.
 */
export async function signOutCloud() {
  if (!cloudEnabled) return { ok: true };
  try {
    flushPendingModel();
    await supabase.auth.signOut();
    authPromise = null;
    if (cloudAllowed()) await ensureAuth(); // fresh anonymous identity
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || "Could not sign out." };
  }
}

/** Legacy name kept so older call sites keep working. */
export async function upgradeWithEmail(email) {
  return sendEmailLink(email, { mode: "link" });
}
