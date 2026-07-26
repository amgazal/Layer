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
        persistSession: true,      // keep the anonymous session across reloads
        autoRefreshToken: true,
        detectSessionInUrl: false, // no OAuth redirect handling needed yet
      },
    })
  : null;

export const cloudEnabled = Boolean(supabase);
