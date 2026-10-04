-- ============================================================================
-- 002 — คะแนนที่อาจารย์ปรับเอง (อุทธรณ์รายข้อ)
-- ============================================================================
-- รันใน Supabase Dashboard > SQL Editor
--
-- เก็บแยกจาก answers เพื่อให้คำตัดสินของอาจารย์อยู่รอดเมื่อกด Re-grade Scores:
-- การ re-grade คำนวณทุกอย่างใหม่จากคำตอบ แต่ข้อที่มี override จะใช้คะแนนที่อาจารย์
-- ให้ไว้แทน ไม่ถูกคำนวณทับ
--
-- รูปแบบ: { "<question_id>": <คะแนน> } เช่น {"de3b4b33-...": 10}
-- ลบ key ออก = กลับไปใช้คะแนนที่ระบบคำนวณตามปกติ
alter table public.student_progress
  add column if not exists score_overrides jsonb not null default '{}'::jsonb;

-- ตรวจผล: ต้องเห็นคอลัมน์ score_overrides เป็น jsonb
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'student_progress'
  and column_name = 'score_overrides';
