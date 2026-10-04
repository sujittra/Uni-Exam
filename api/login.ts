// Vercel serverless function — the only place credentials are checked.
//
// The browser used to do this itself: it asked PostgREST for the row where name = ? and
// password = ?, with the anon key, against a table anyone could read. Every teacher
// password was therefore readable by anyone who opened the site. Now the password column
// never leaves this function, and what the browser gets back is a signed session token it
// must present on every later api/ call.
//
// POST { mode: 'student',  studentId }           -> { user, token }
// POST { mode: 'teacher',  name, password }      -> { user, token }
// POST { mode: 'register', name, password, code} -> { user, token }
import { pgSelect, pgInsert, pgUpdate, isSupabaseAdminConfigured } from './_supabaseAdmin.js';
import { issueToken, isSessionConfigured, verifyPassword, isHashed, hashPassword } from './_session.js';

const mapUser = (u: any) => ({
  id: u.id,
  name: u.name,
  role: u.role,
  studentId: u.student_id || undefined,
  section: u.section || undefined,
  major: u.major || undefined,
  createdBy: u.created_by || undefined,
});

// Teacher names are matched here rather than in the query. PostgREST's `ilike` treats %, _
// and * in the value as wildcards with no way to escape them, so a name of "%" would match
// every teacher and turn a login into a guess at any one of their passwords. The teacher
// list is a handful of rows; comparing them in this process is both safer and simpler.
const sameName = (a: string, b: string) => a.trim().toLowerCase() === String(b || '').trim().toLowerCase();

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    if (!isSupabaseAdminConfigured() || !isSessionConfigured()) {
      res.status(500).json({ error: 'Server is not configured (SUPABASE_URL / service role key / SESSION_SECRET).' });
      return;
    }

    const { mode, studentId, name, password, code } = (req.body || {}) as Record<string, string>;

    // ---- STUDENT: the id alone is the credential, as it always was. -------------------
    if (mode === 'student') {
      const cleanId = String(studentId || '').trim();
      if (!cleanId) {
        res.status(400).json({ error: 'Student id is required.' });
        return;
      }
      const { data } = await pgSelect<any[]>('users', `student_id=eq.${encodeURIComponent(cleanId)}&role=eq.STUDENT&select=*`);
      const user = data?.[0];
      if (!user) {
        res.status(401).json({ error: 'ไม่พบรหัสนักศึกษานี้ในระบบ' });
        return;
      }
      res.status(200).json({
        user: mapUser(user),
        token: issueToken({ sub: user.id, role: 'STUDENT', name: user.name, studentId: user.student_id }),
      });
      return;
    }

    // ---- TEACHER ---------------------------------------------------------------------
    if (mode === 'teacher') {
      const cleanName = String(name || '').trim();
      if (!cleanName || !password) {
        res.status(400).json({ error: 'Name and password are required.' });
        return;
      }
      // The name match stays case-insensitive, as it always was, and the password is
      // compared here, in this process — never in the query, against a column no longer
      // readable from anywhere else.
      const { data } = await pgSelect<any[]>('users', 'role=eq.TEACHER&select=*');
      const user = (data || []).find((u: any) => sameName(cleanName, u.name) && verifyPassword(password, u.password));
      if (!user) {
        res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        return;
      }

      // Every password in this database was stored in plain text. The first successful
      // login after this deploy replaces that row's value with a hash of the same password,
      // so nobody has to change their password for the plain text to stop existing. A
      // failure here must not block the login that already succeeded.
      if (!isHashed(user.password)) {
        await pgUpdate('users', `id=eq.${user.id}`, { password: hashPassword(password) }).catch(() => {});
      }

      res.status(200).json({
        user: mapUser(user),
        token: issueToken({ sub: user.id, role: 'TEACHER', name: user.name }),
      });
      return;
    }

    // ---- REGISTER --------------------------------------------------------------------
    // Teacher sign-up used to be open to anyone who loaded the page, which made the whole
    // teacher side — every exam, every answer key, every student's score — one form
    // submission away. It now needs TEACHER_SIGNUP_CODE, and if that env var is unset there
    // is no way to create a teacher from the web at all.
    if (mode === 'register') {
      const signupCode = process.env.TEACHER_SIGNUP_CODE || '';
      if (!signupCode) {
        res.status(403).json({ error: 'การสมัครบัญชีอาจารย์ถูกปิดอยู่ ติดต่อผู้ดูแลระบบเพื่อเปิด (ตั้งค่า TEACHER_SIGNUP_CODE)' });
        return;
      }
      if (String(code || '') !== signupCode) {
        res.status(403).json({ error: 'รหัสเชิญไม่ถูกต้อง' });
        return;
      }
      const cleanName = String(name || '').trim();
      if (!cleanName || !password) {
        res.status(400).json({ error: 'Name and password are required.' });
        return;
      }
      const { data: existing } = await pgSelect<any[]>('users', 'role=eq.TEACHER&select=id,name');
      if ((existing || []).some((u: any) => sameName(cleanName, u.name))) {
        res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' });
        return;
      }

      const { data: created, error } = await pgInsert<any[]>('users', [
        { name: cleanName, password: hashPassword(password), role: 'TEACHER' },
      ]);
      const user = created?.[0];
      if (error || !user) {
        res.status(500).json({ error: error?.message || 'Could not create the account.' });
        return;
      }
      res.status(200).json({
        user: mapUser(user),
        token: issueToken({ sub: user.id, role: 'TEACHER', name: user.name }),
      });
      return;
    }

    res.status(400).json({ error: 'Unknown login mode.' });
  } catch (e: any) {
    try {
      res.status(500).json({ error: e?.message || String(e) });
    } catch {
      // response already sent
    }
  }
}
