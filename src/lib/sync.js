import { supabase, cloudEnabled } from "./supabase";

/**
 * The sync layer sits ABOVE local storage. The app writes to localStorage
 * immediately (unchanged); these functions mirror to Supabase in the
 * background. Design rules:
 *   1. Never block a render. Auth and network happen off the critical path.
 *   2. Never throw into the UI. Every path swallows its own errors.
 *   3. No account gate. On first load we mint an ANONYMOUS user silently,
 *      so weather works instantly and the study still captures events.
 */

let authPromise = null;

/** Resolve (and cache) the current user, creating an anonymous one if none. */
export function ensureAuth() {
  if (!cloudEnabled) return Promise.resolve(null);
  if (authPromise) return authPromise;

  authPromise = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) return session.user;

      // No session yet → silent anonymous sign-in. Requires "Allow anonymous
      // sign-ins" to be enabled in the Supabase dashboard (Auth → Providers).
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.warn("[sync] anonymous sign-in failed:", error.message);
        return null;
      }
      return data.user;
    } catch (err) {
      console.warn("[sync] auth unavailable:", err?.message || err);
      return null;
    }
  })();

  return authPromise;
}

/** Pull the cloud copy of the calibration model, or null. */
export async function pullModel() {
  if (!cloudEnabled) return null;
  try {
    const user = await ensureAuth();
    if (!user) return null;
    const { data, error } = await supabase
      .from("model_state")
      .select("model, observations, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) return null;
    return data; // { model, observations, updated_at }
  } catch {
    return null;
  }
}

/** Debounced upsert of the model. Coalesces rapid feedback into one write. */
let pushTimer = null;
let pendingModel = null;
export function pushModel(model, observations) {
  if (!cloudEnabled) return;
  pendingModel = { model, observations };
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const snapshot = pendingModel;
    pendingModel = null;
    try {
      const user = await ensureAuth();
      if (!user || !snapshot) return;
      await supabase.from("model_state").upsert(
        {
          user_id: user.id,
          model: snapshot.model,
          observations: snapshot.observations,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    } catch {
      /* offline — localStorage already holds the truth; retry on next commit */
    }
  }, 800);
}

/** Upsert onboarding answers (one row per user). */
export async function pushProfile(profile) {
  if (!cloudEnabled) return;
  try {
    const user = await ensureAuth();
    if (!user) return;
    await supabase.from("profiles").upsert(
      {
        id: user.id,
        climate: profile.climate ?? null,
        tolerance: profile.tolerance ?? null,
        is_anonymous: user.is_anonymous ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
  } catch {
    /* non-critical */
  }
}

/** Append one feedback event — this table IS the research dataset. */
export async function logEvent(event) {
  if (!cloudEnabled) return;
  try {
    const user = await ensureAuth();
    if (!user) return;
    await supabase.from("events").insert({ user_id: user.id, ...event });
  } catch {
    /* a dropped event is acceptable; local history still records it */
  }
}
