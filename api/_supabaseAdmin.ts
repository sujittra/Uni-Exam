// Shared server-side Supabase REST helper. Talks to PostgREST directly via plain fetch
// (no @supabase/supabase-js) — that SDK was crashing at import time when bundled as a
// Vercel Node function in this project (package.json has "type": "module", which the
// SDK's CJS/ESM interop didn't survive here). Uses the service_role key, which bypasses
// Row Level Security entirely — only ever import this from files under api/, never from
// client code (services/, pages/, components/).
// Files prefixed with "_" are not treated as routes by Vercel.

// Vercel's Supabase integration names the URL var NEXT_PUBLIC_SUPABASE_URL (it also
// exposes it to the client under that name) — fall back to that if a plain
// SUPABASE_URL isn't set, so this works with either naming.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const isSupabaseAdminConfigured = () => !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

interface RestResult<T> {
  data: T | null;
  error: { message: string } | null;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function toResult<T>(res: Response): Promise<RestResult<T>> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    return { data: null, error: { message: typeof body === 'string' ? body : body?.message || `PostgREST error ${res.status}` } };
  }
  return { data: body as T, error: null };
}

// GET with PostgREST filters, e.g. pgSelect('questions', 'id=eq.abc&select=test_cases')
export async function pgSelect<T = any[]>(table: string, query: string): Promise<RestResult<T>> {
  const res = await request(`${table}?${query}`);
  return toResult<T>(res);
}

export async function pgInsert<T = any[]>(table: string, rows: any[]): Promise<RestResult<T>> {
  const res = await request(table, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  return toResult<T>(res);
}

export async function pgDelete(table: string, query: string): Promise<RestResult<null>> {
  const res = await request(`${table}?${query}`, { method: 'DELETE' });
  return toResult<null>(res);
}

export async function pgUpdate(table: string, query: string, patch: any): Promise<RestResult<null>> {
  const res = await request(`${table}?${query}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return toResult<null>(res);
}
