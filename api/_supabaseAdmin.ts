// Shared server-side Supabase client. Uses the service_role key, which bypasses
// Row Level Security entirely — only ever import this from files under api/, never
// from client code (services/, pages/, components/).
// Files prefixed with "_" are not treated as routes by Vercel.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

export const isSupabaseAdminConfigured = () => !!supabaseAdmin;
