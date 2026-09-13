// Shared server-side Supabase client. Uses the service_role key, which bypasses
// Row Level Security entirely — only ever import this from files under api/, never
// from client code (services/, pages/, components/).
// Files prefixed with "_" are not treated as routes by Vercel.
import { createClient } from '@supabase/supabase-js';

// Vercel's Supabase integration names the URL var NEXT_PUBLIC_SUPABASE_URL (it also
// exposes it to the client under that name) — fall back to that if a plain
// SUPABASE_URL isn't set, so this works with either naming.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

export const isSupabaseAdminConfigured = () => !!supabaseAdmin;
