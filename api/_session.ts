// Signed session tokens — the app's only proof of who is calling an api/ route.
//
// Why this exists: every table used to be reachable from the browser with the anon key,
// which ships inside the JS bundle. Anyone who opened the site could read the MCQ answer
// keys and the teachers' passwords, rewrite questions, and set their own score. RLS is now
// closed on every table and the service_role key lives only in these functions, so the
// browser can no longer talk to PostgREST at all — it calls api/ instead, and api/ needs a
// way to tell a student from a teacher from a stranger. That is this file.
//
// The token is <base64url(payload)>.<base64url(HMAC-SHA256(payload))>. It is not encrypted
// and is not meant to be: the payload is the same user record the login already returned.
// The signature is what matters — a client cannot mint one, so it cannot promote itself to
// TEACHER or claim another student's id.
//
// Password hashing lives here too, next to the thing that verifies it.
import { createHmac, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto';

// SESSION_SECRET is the proper home for this. Falling back to the service_role key means an
// existing deployment keeps working without adding an env var first — it is already secret,
// already server-only, and never leaves these functions. Set SESSION_SECRET to rotate every
// session without touching the database key.
const SECRET =
  process.env.SESSION_SECRET ||
  process.env.SB_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // one working day — long enough for any exam

export type Role = 'TEACHER' | 'STUDENT';

export interface SessionPayload {
  sub: string; // users.id
  role: Role;
  name: string;
  studentId?: string; // students only — the key student_progress rows hang off
  exp: number;
}

export const isSessionConfigured = () => !!SECRET;

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

const signature = (body: string) => createHmac('sha256', SECRET).update(body).digest('base64url');

export const issueToken = (payload: Omit<SessionPayload, 'exp'>): string => {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS }));
  return `${body}.${signature(body)}`;
};

// Returns null for anything that isn't a token this server signed and that hasn't expired.
// Every failure mode lands in the same place on purpose: the caller only ever learns
// "not a valid session", never which part was wrong.
export const verifyToken = (token: string | undefined | null): SessionPayload | null => {
  if (!SECRET || !token) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;

  const expected = signature(body);
  // Both sides are base64url of a 32-byte digest, so the lengths match whenever the
  // signature is well-formed; timingSafeEqual throws on a mismatch, hence the guard.
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload?.sub || (payload.role !== 'TEACHER' && payload.role !== 'STUDENT')) return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    if (payload.role === 'STUDENT' && !payload.studentId) return null;
    return payload;
  } catch {
    return null;
  }
};

// Reads the token off a request. Authorization: Bearer <token> is the only accepted place —
// not a cookie, so a cross-site request can't carry it implicitly.
export const sessionFromRequest = (req: any): SessionPayload | null => {
  const header = String(req?.headers?.authorization || '');
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? verifyToken(match[1]) : null;
};

// ==========================================
// PASSWORD HASHING (teachers only — students log in with their id alone)
// ==========================================
// scrypt from node:crypto, so there is no dependency to add. Stored as
// scrypt$<salt base64url>$<hash base64url>.
const SCRYPT_KEYLEN = 32;

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
};

export const isHashed = (stored: string | null | undefined) => String(stored || '').startsWith('scrypt$');

// Accepts both shapes. Every password in this database was stored in plain text, so a
// legacy row still has to be able to log in — api/login.ts re-saves it as a hash the first
// time its owner signs in, and `verifyPassword` is what tells it which shape it just read.
export const verifyPassword = (password: string, stored: string | null | undefined): boolean => {
  const value = String(stored ?? '');
  if (!value) return false;

  if (!isHashed(value)) {
    // Legacy plain text. Constant-time compare anyway so this path leaks no more than the
    // hashed one does.
    const a = Buffer.from(password);
    const b = Buffer.from(value);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  const [, saltPart, hashPart] = value.split('$');
  if (!saltPart || !hashPart) return false;
  try {
    const expected = Buffer.from(hashPart, 'base64url');
    const actual = scryptSync(password, Buffer.from(saltPart, 'base64url'), expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};
