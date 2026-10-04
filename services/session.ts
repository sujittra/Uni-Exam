import { User, UserRole } from '../types';

// Keeps the signed-in user across a page refresh.
//
// sessionStorage, not localStorage, on purpose: it survives F5, Back/Forward and a crashed
// tab, but dies when the tab or the browser closes. On a shared lab machine that means the
// next student can't walk up to someone else's still-open session.
//
// The user record here is convenience — it decides which screen to render after a refresh,
// nothing more. The token stored alongside it is the actual credential: api/ rejects any
// request without a valid one, so editing the stored user to say TEACHER changes what this
// browser draws and nothing about what the server will hand over.
//
// It lives in sessionStorage for the same reason the user record does: on a shared lab
// machine, closing the tab must end the session for whoever sits down next.

const SESSION_KEY = 'uniexam_session_user';
const TOKEN_KEY = 'uniexam_session_token';

// Every accessor is guarded: sessionStorage throws in some privacy modes, and the stored
// JSON can be stale or hand-edited. A bad value must land the user on the login page, never
// crash the app.
export const loadSession = (): User | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as User;
    // Only trust a shape the app can actually render.
    if (!user?.id || (user.role !== UserRole.TEACHER && user.role !== UserRole.STUDENT)) return null;
    if (user.role === UserRole.STUDENT && !user.studentId) return null;
    return user;
  } catch {
    return null;
  }
};

export const saveSession = (user: User) => {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } catch {
    // Storage unavailable (private mode, quota) — the app still works, refresh just won't
    // hold the session.
  }
};

export const clearSession = () => {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing to do
  }
};

// The signed token from api/login.ts, presented on every api/ call.
export const loadToken = (): string | null => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const saveToken = (token: string) => {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable (private mode, quota). The token is held only here, so without it
    // the next call is unauthenticated and the user is asked to sign in again.
  }
};

export const clearToken = () => {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing to do
  }
};

// Small helpers for the bits of view state worth restoring alongside the user (which tab
// the teacher was on, which exam they were monitoring). Same tab-scoped lifetime.
export const loadView = <T,>(key: string, isValid: (v: any) => boolean): T | null => {
  try {
    const raw = sessionStorage.getItem(`uniexam_view_${key}`);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    return isValid(value) ? (value as T) : null;
  } catch {
    return null;
  }
};

export const saveView = (key: string, value: unknown) => {
  try {
    sessionStorage.setItem(`uniexam_view_${key}`, JSON.stringify(value));
  } catch {
    // nothing to do
  }
};
