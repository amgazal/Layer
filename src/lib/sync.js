import { supabase, cloudEnabled } from "./supabase";

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

function lsGet(key) {
  try { return window.localStorage?.getItem(key) ?? null; } catch { return null; }
}
function lsSet(key, value) {
  try { window.localStorage?.setItem(key, value); } catch {}
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

export function pushModel(model, observations) {
  if (!cloudEnabled || !cloudAllowed()) return;
  pendingModel = { model, observations };
  clearTimeout(pushTimer);

  pushTimer = setTimeout(async () => {
    pushTimer = null;
    if (!cloudAllowed()) {
      pendingModel = null;
      return;
    }

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
    }
  }, 800);
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
export async function flushOutbox() {
  if (!cloudEnabled || !cloudAllowed() || flushing) return;
  const batch = readOutbox();
  if (batch.length === 0) return;

  flushing = true;
  let uploaded = false;
  try {
    const user = await ensureAuth();
    if (!user || !cloudAllowed()) return;

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
    markNet("active");
  } catch (error) {
    console.warn("[sync] event upload failed:", error?.message || error);
    markNet("unavailable");
  } finally {
    flushing = false;
    if (uploaded && cloudAllowed() && readOutbox().length > 0) {
      setTimeout(() => flushOutbox(), 0);
    }
  }
}

/* ── account upgrade (kept behind a feature flag in Layer.jsx) ─────── */
let authInfo = { status: "none", email: null };
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
  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    if (!user) {
      authPromise = null;
      setAuth({ status: "none", email: null });
      return;
    }

    const permanent = user.is_anonymous === false;
    setAuth({
      status: permanent ? "permanent" : "anonymous",
      email: user.email ?? null,
    });

    if (permanent) {
      supabase.from("profiles")
        .update({ is_anonymous: false, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .then(() => {}, () => {});
    }
  });
}

/**
 * Links an email identity to the current anonymous user. Supabase requires
 * manual identity linking to be enabled in the project before using this.
 * Cross-device sign-in/merge UI is intentionally not exposed yet.
 */
export async function upgradeWithEmail(email) {
  if (!cloudEnabled || !cloudAllowed()) {
    return { ok: false, error: "Cloud backup is turned off." };
  }
  try {
    const user = await ensureAuth();
    if (!user) return { ok: false, error: "Not signed in yet — try again in a moment." };
    const { error } = await supabase.auth.updateUser({ email });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || "Something went wrong." };
  }
}
