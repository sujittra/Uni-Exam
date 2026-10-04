-- ============================================================================
-- 001 — ปิดการเข้าถึงฐานข้อมูลจากเบราว์เซอร์ (anon key lockdown)
-- ============================================================================
-- รันไฟล์นี้ใน Supabase Dashboard > SQL Editor ทั้งไฟล์ในครั้งเดียว
--
-- ต้อง deploy โค้ดชุดใหม่ขึ้น Vercel ให้เรียบร้อย "ก่อน" รันไฟล์นี้ เพราะเว็บเวอร์ชันเก่า
-- คุยกับฐานข้อมูลด้วย anon key โดยตรง พอเปิด RLS แล้วเวอร์ชันเก่าจะใช้งานไม่ได้ทันที
-- (เวอร์ชันใหม่คุยผ่าน api/ ซึ่งใช้ service_role key จึงไม่ถูก RLS ปิดกั้น)
--
-- ที่มา: anon key ฝังอยู่ในไฟล์ JavaScript ที่ส่งให้ทุกคนที่เปิดเว็บ ใครก็ตามที่เปิด
-- DevTools ก็หยิบไปใช้ยิง PostgREST ตรง ๆ ได้ ซึ่งที่ผ่านมาแปลว่าอ่านเฉลย MCQ ได้ทุกข้อ
-- อ่านรหัสผ่านอาจารย์ (เก็บเป็น plaintext) ได้ทุกบัญชี แก้/ลบข้อสอบได้ และแก้คะแนนตัวเองได้

-- ----------------------------------------------------------------------------
-- 1. ตารางเก็บผลตัดสินของ judge
-- ----------------------------------------------------------------------------
-- คะแนนข้อเขียนโค้ดต้องมาจากผลตรวจจริง ไม่ใช่จาก flag `passed` ที่เบราว์เซอร์ส่งกลับมา
-- พร้อมคำตอบ (นักศึกษาแก้ค่านั้นเป็น true เองได้) api/judge.ts เขียนแถวนี้หลังตรวจเสร็จ
-- และ api/db.ts ใช้แถวนี้เป็นตัวตัดสินคะแนน
--
-- code_fingerprint ผูกผลตัดสินไว้กับโค้ดชุดที่ถูกตรวจจริง ๆ แก้โค้ดหลังจากผ่านแล้ว
-- fingerprint จะไม่ตรงและคะแนนหายไปพร้อมโค้ดชุดเดิม
create table if not exists public.judge_results (
  student_id text not null,
  question_id uuid not null references public.questions(id) on delete cascade,
  code_fingerprint text not null,
  passed boolean not null default false,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (student_id, question_id)
);

alter table public.judge_results enable row level security;
-- ไม่มี policy ให้ anon/authenticated = ปฏิเสธทุกแถวโดยปริยาย อ่านเขียนได้เฉพาะ service_role

-- ----------------------------------------------------------------------------
-- 2. เปิด RLS กับทุกตารางที่เหลือ
-- ----------------------------------------------------------------------------
-- RLS เปิดแล้วไม่มี policy = ปฏิเสธทุกแถวสำหรับ anon และ authenticated
-- service_role (ที่อยู่ใน Vercel function เท่านั้น) ข้าม RLS ได้ตามปกติ
alter table public.users enable row level security;
alter table public.exams enable row level security;
alter table public.questions enable row level security;
alter table public.student_progress enable row level security;

-- question_hidden_test_cases เปิด RLS ไว้อยู่แล้วตั้งแต่ตอนสร้าง แต่สั่งซ้ำไม่เสียหาย
alter table public.question_hidden_test_cases enable row level security;

-- ลบ policy ที่อาจเคยเปิดช่องไว้ ถ้าไม่มีอยู่แล้วคำสั่งนี้จะไม่ทำอะไร
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('users', 'exams', 'questions', 'student_progress',
                        'question_hidden_test_cases', 'judge_results')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    raise notice 'dropped policy % on %.%', p.policyname, p.schemaname, p.tablename;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. ถอน GRANT ระดับตาราง
-- ----------------------------------------------------------------------------
-- RLS อย่างเดียวพอสำหรับปิดแถว แต่ถอน grant ด้วยเป็นชั้นที่สอง: ถ้าวันหลังมีใครเผลอ
-- เพิ่ม policy แบบ `using (true)` ให้ anon ตารางเหล่านี้ก็ยังไม่เปิดออกมา
revoke all on public.users from anon, authenticated;
revoke all on public.exams from anon, authenticated;
revoke all on public.questions from anon, authenticated;
revoke all on public.student_progress from anon, authenticated;
revoke all on public.question_hidden_test_cases from anon, authenticated;
revoke all on public.judge_results from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. ตรวจผล
-- ----------------------------------------------------------------------------
-- ทุกตารางต้องขึ้น rowsecurity = true และ policies = 0
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('users', 'exams', 'questions', 'student_progress',
                    'question_hidden_test_cases', 'judge_results')
order by c.relname;

-- ----------------------------------------------------------------------------
-- 5. ที่ต้องทำต่อในหน้า Dashboard (SQL ทำให้ไม่ได้)
-- ----------------------------------------------------------------------------
-- Storage > exam-images > Policies: ลบ policy ที่ให้ anon/public ทำ INSERT/UPDATE/DELETE
-- ออกให้หมด เหลือไว้แค่ SELECT (นักศึกษาต้องโหลดรูปในโจทย์ได้) การอัปโหลดรูปตอนนี้
-- ไปผ่าน api/db.ts ซึ่งใช้ service_role จึงไม่ต้องพึ่ง policy ใด ๆ
