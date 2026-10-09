// Supabase sign-in is optional: with no VITE_SUPABASE_* values the app runs as before (no login page,
// browser-only history). The publishable key is safe in the browser: every table has row-level security.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabaseEnabled = !!(url && key);
export const supabase: SupabaseClient | null = supabaseEnabled ? createClient(url!, key!) : null;
