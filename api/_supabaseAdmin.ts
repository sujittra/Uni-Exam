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
// SUPABASE_SERVICE_ROLE_KEY may be locked/managed by the Vercel-Supabase integration
// (pointing at whatever project the integration auto-linked, not necessarily the one
// this app actually uses) — SB_SERVICE_ROLE_KEY is a plain, freely-editable fallback
// for pointing this at the correct project's service_role secret instead.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SB_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

// Uploads a file to a Supabase Storage bucket and returns its public URL. Exam images used
// to be uploaded straight from the browser with the anon key, which let anyone with the
// bundle write into the bucket; now only a teacher's api/db.ts call reaches it.
export async function storageUpload(
  bucket: string,
  path: string,
  body: Buffer,
  contentType: string
): Promise<RestResult<{ publicUrl: string }>> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    body: body as any,
  });
  if (!res.ok) {
    const text = await res.text();
    return { data: null, error: { message: text || `Storage upload error ${res.status}` } };
  }
  return { data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}` }, error: null };
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

// INSERT ... ON CONFLICT DO UPDATE. `onConflict` names the unique column(s) PostgREST
// should match on, e.g. 'student_id,exam_id'.
export async function pgUpsert<T = any[]>(table: string, rows: any[], onConflict: string): Promise<RestResult<T>> {
  const res = await request(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
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
