# วิธีการสร้าง Database บน Supabase สำหรับ UniExam Pro

ระบบนี้ออกแบบมาให้ใช้งานร่วมกับ PostgreSQL บน Supabase เพื่อรองรับ Real-time Dashboard และการเก็บข้อมูลถาวร

## ขั้นตอนการติดตั้ง

1. **สร้าง Project ใหม่**
   - ไปที่ [Supabase.com](https://supabase.com) แล้ว Log in
   - กด "New Project" ตั้งชื่อและรหัสผ่าน Database

2. **รัน SQL Script (สร้างตาราง)**
   - เมื่อ Project สร้างเสร็จแล้ว ให้มองหาเมนู **"SQL Editor"** ทางด้านซ้าย
   - กด **"+ New Query"**
   - Copy โค้ดทั้งหมดจากไฟล์ `supabase_schema.sql` ในโปรเจกต์นี้
   - Paste ลงในช่อง Query Editor
   - กดปุ่ม **"Run"** (ขวาล่าง)

3. **ตั้งค่า Storage (สำหรับอัปโหลดรูปภาพ)**
   - ไปที่เมนู **Storage** (ไอคอนรูปถัง) ทางด้านซ้าย
   - กดปุ่ม **"New Bucket"**
   - ตั้งชื่อ Bucket Name ว่า: `exam-images`
   - **สำคัญ:** เปิดสวิตช์ **"Public bucket"** (เพื่อให้รูปภาพแสดงผลได้โดยไม่ต้อง Login ซ้ำซ้อน)
   - กด **Save**
   - หลังจากสร้างเสร็จ ไปที่แท็บ **Configuration** -> **Policies** ของ Bucket `exam-images`
   - กด **"New Policy"** -> เลือก **"Get started quickly"**
   - เลือกตัวเลือกแรก **"Give users access to all files"** (Select, Insert, Update, Delete) 
   - กด Review -> Save Policy (เพื่อให้แอพสามารถอัปโหลดรูปภาพได้)

4. **ตรวจสอบตาราง (Tables)**
   - ไปที่เมนู **"Table Editor"** ทางด้านซ้าย
   - คุณควรจะเห็นตารางดังนี้: `users`, `exams`, `questions`, `student_progress`
   - ตรวจสอบว่ามีข้อมูลตัวอย่าง (Alice, Bob, Dr. Smith) ถูกเพิ่มเข้าไปแล้ว

5. **การเชื่อมต่อกับโค้ด (Integration)**
   - ในโปรเจกต์ React ให้ลง Library:
     ```bash
     npm install @supabase/supabase-js
     ```
   - เปิดไฟล์ `services/dataService.ts`
   - นำ Comment ในส่วน `Supabase Configuration` ออก
   - ใส่ **Project URL** และ **API Key (anon key)** ของคุณที่ได้จาก Supabase (เมนู Project Settings > API)

## ⚠️ การแก้ปัญหา (Troubleshooting)

### Error: `PGRST204: Could not find the 'started_at' column`
หากคุณเจอ Error นี้ แสดงว่า Database ของคุณถูกสร้างด้วย Schema เก่า และยังไม่มีคอลัมน์ `started_at` ที่เพิ่มมาใหม่
**วิธีแก้ไข:**
1. ไปที่ Supabase > SQL Editor
2. กด New Query
3. Run คำสั่งต่อไปนี้:

```sql
ALTER TABLE public.student_progress 
ADD COLUMN IF NOT EXISTS started_at timestamp with time zone;

-- สั่งให้ API Refresh Cache
NOTIFY pgrst, 'reload schema';
```

### Error: `PGRST204: Could not find the 'language' column` (หรือไม่เห็นตัวเลือกภาษา Python)
หากคุณสร้าง Database ไว้ก่อนที่ระบบจะรองรับ Python 3 ตารางเก่าจะยังไม่มีคอลัมน์ `language` สำหรับโจทย์เขียนโค้ด
**วิธีแก้ไข:**
1. ไปที่ Supabase > SQL Editor
2. กด New Query
3. Run คำสั่งต่อไปนี้:

```sql
ALTER TABLE public.questions 
ADD COLUMN IF NOT EXISTS language text check (language in ('java', 'python3')) default 'java';

ALTER TABLE public.questions 
ADD COLUMN IF NOT EXISTS allow_file_upload boolean default true;

ALTER TABLE public.student_progress 
ADD COLUMN IF NOT EXISTS auto_submitted boolean default false;

-- สั่งให้ API Refresh Cache
NOTIFY pgrst, 'reload schema';
```

### เพิ่งอัปเดต: ย้าย Hidden Test Case ออกจาก `questions.test_cases` (เพื่อความปลอดภัย)
เดิม hidden test case ถูกเก็บปนอยู่ใน column `test_cases` เดียวกับ test case ที่เปิดเผย ซึ่งหลุดไปถึง browser นักเรียนได้ผ่าน network response (แม้ UI จะซ่อนไว้ก็ตาม) ตอนนี้ hidden test case ถูกย้ายไปเก็บในตารางแยก `question_hidden_test_cases` ที่เปิด Row Level Security ไว้แบบไม่มี policy ให้ `anon`/`authenticated` เลย (เข้าถึงได้เฉพาะผ่าน `service_role` key ฝั่ง server เท่านั้น)

**ต้องรัน SQL migration นี้ (ครั้งเดียว) ถ้า Database ของคุณสร้างไว้ก่อนหน้านี้:**

```sql
-- 1. สร้างตารางใหม่ + คอลัมน์นับจำนวน
CREATE TABLE IF NOT EXISTS public.question_hidden_test_cases (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE NOT NULL,
  input text NOT NULL,
  output text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.question_hidden_test_cases ENABLE ROW LEVEL SECURITY;
-- ไม่ต้องเพิ่ม policy ใดๆ — ปล่อยว่างไว้ = anon/authenticated ถูกปฏิเสธทั้งหมดโดย default

ALTER TABLE public.questions
ADD COLUMN IF NOT EXISTS hidden_test_case_count int DEFAULT 0;

-- 2. ย้ายข้อมูล hidden test case เดิม (ถ้ามี) ออกจาก test_cases ไปตารางใหม่
DO $$
DECLARE
  q record;
  hidden_items jsonb;
  visible_items jsonb;
BEGIN
  FOR q IN SELECT id, test_cases FROM public.questions WHERE test_cases IS NOT NULL LOOP
    hidden_items := (
      SELECT jsonb_agg(elem) FROM jsonb_array_elements(q.test_cases) elem
      WHERE (elem->>'hidden')::boolean IS TRUE
    );
    visible_items := (
      SELECT jsonb_agg(elem) FROM jsonb_array_elements(q.test_cases) elem
      WHERE (elem->>'hidden')::boolean IS NOT TRUE
    );

    IF hidden_items IS NOT NULL THEN
      INSERT INTO public.question_hidden_test_cases (question_id, input, output)
      SELECT q.id, elem->>'input', elem->>'output'
      FROM jsonb_array_elements(hidden_items) elem;

      UPDATE public.questions
      SET test_cases = COALESCE(visible_items, '[]'::jsonb),
          hidden_test_case_count = jsonb_array_length(hidden_items)
      WHERE id = q.id;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
```

**และต้องตั้งค่า Environment Variables เพิ่มบน Vercel** (Project Settings > Environment Variables — ห้ามใส่ใน `.env.local`):
- `SUPABASE_URL` = Project URL เดียวกับที่ใช้ใน `services/dataService.ts`
- `SUPABASE_SERVICE_ROLE_KEY` = ไปที่ Supabase Dashboard > Project Settings > API > คัดลอกค่า **`service_role` secret** (คนละตัวกับ `anon` key — ตัวนี้ bypass RLS ได้ทั้งหมด ห้ามใส่ในโค้ด client หรือ `.env.local` เด็ดขาด)

## หมายเหตุ
- ระบบ Dashboard ใช้อาศัยฟีเจอร์ **Realtime** ซึ่งสคริปต์ SQL ได้เปิดใช้งานให้แล้วในบรรทัด `alter publication supabase_realtime...`
- ระบบ Login ปัจจุบันออกแบบมาให้ใช้ `student_id` ในตาราง `users` ในการตรวจสอบสิทธิ์แบบง่าย (เพื่อให้ตรงกับ requirement นำเข้า Excel) โดยไม่ต้องใช้ Supabase Auth (Email/Password) ที่ซับซ้อนเกินไปสำหรับเฟสแรก