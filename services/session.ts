import { User, UserRole } from '../types';

// Keeps the signed-in user across a page refresh.
//
// sessionStorage, not localStorage, on purpose: it survives F5, Back/Forward and a crashed
// tab, but dies when the tab or the browser closes. On a shared lab machine that means the
// next student can't walk up to someone else's still-open session.
//
// This is convenience, not authentication. The app has no session tokens — teacher and
// student are both anon-key clients told apart by app state — so what's stored here is the
// user record the login already returned, nothing secret.

const SESSION_KEY = 'uniexam_session_user';

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
