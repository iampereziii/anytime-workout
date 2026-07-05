import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client (service role).
 * ALL DB access is server-side in v1 — no client-side Supabase queries
 * (project spec, NFR). The service role key must never reach the client.
 */
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
