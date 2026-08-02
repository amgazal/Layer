import { createClient } from "@supabase/supabase-js";

/**
 * Cloud is strictly optional. If the two env vars aren't present at build
 * time, `supabase` is null and every sync call becomes a no-op — the app
 * behaves exactly as it did before any backend existed (local-first only).
 *
 * The anon key is designed to live in frontend code. It is safe to expose
 * *because* Row Level Security (see supabase/schema.sql) restricts every
 * user to their own rows. Never put the service_role key here.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,     // keep the session across reloads
        autoRefreshToken: true,
        // Required for OAuth: Supabase returns the session in the URL after a
        // provider redirect, and the client must consume it.
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;

export const cloudEnabled = Boolean(supabase);

/**
 * Where a provider sends the user back to. Must exactly match an entry in
 * Supabase -> Authentication -> URL Configuration -> Redirect URLs.
 * BASE_URL keeps this correct under a GitHub Pages subpath (e.g. /weather/).
 */
export function authRedirectUrl() {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}${import.meta.env.BASE_URL || "/"}`;
}

/**
 * Only show sign-in buttons for providers actually configured in the Supabase
 * dashboard, so testers never meet a button that errors. Set at build time:
 *   VITE_AUTH_PROVIDERS=google,apple,cornell
 * Email links work whenever cloud is enabled and need no extra setup.
 */
const configured = String(import.meta.env.VITE_AUTH_PROVIDERS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const providerEnabled = {
  google: configured.includes("google"),
  apple: configured.includes("apple"),
  // "Cornell" is Google Workspace under the hood: the same Google provider with
  // a cornell.edu domain hint. It needs no separate Supabase provider.
  cornell: configured.includes("google") && configured.includes("cornell"),
};

export const CORNELL_DOMAIN = "cornell.edu";
