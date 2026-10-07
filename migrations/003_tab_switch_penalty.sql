-- ============================================================================
-- 003 — หักเวลาสอบเมื่อนักศึกษาออกจากหน้าสอบบ่อยเกินกำหนด
-- ============================================================================
-- รันใน Supabase Dashboard > SQL Editor
--
-- ระบบนับการออกจากหน้าสอบ (สลับแท็บ/สลับโปรแกรม/ออกจากโหมดเต็มจอ) ไว้ใน
-- student_progress.tab_switch_count อยู่แล้ว แต่เดิมเป็นแค่หลักฐานให้อาจารย์ดู
-- สองคอลัมน์นี้ทำให้มันมีผลจริง:
--
--   tab_switch_limit           ออกได้ฟรีกี่ครั้ง ก่อนเริ่มโดนหักเวลา
--   tab_switch_penalty_minutes หักกี่นาที "ต่อครั้ง" ที่เกินโควตาข้างบน
--
-- ตัวอย่าง limit = 3, penalty = 5 → ครั้งที่ 1-3 ไม่หัก ครั้งที่ 4 หัก 5 นาที
-- ครั้งที่ 5 หักรวมเป็น 10 นาที ไปเรื่อยๆ
--
-- ค่า default 0 ทั้งคู่ = ข้อสอบเดิมทุกชุดไม่มีบทลงโทษ พฤติกรรมไม่เปลี่ยน
-- และการใส่ limit ไว้โดยที่ penalty ยังเป็น 0 ก็ยังไม่หักเวลา
alter table public.exams
  add column if not exists tab_switch_limit int not null default 0,
  add column if not exists tab_switch_penalty_minutes int not null default 0;

-- ตรวจผล: ต้องเห็นสองคอลัมน์ เป็น integer default 0
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'exams'
  and column_name in ('tab_switch_limit', 'tab_switch_penalty_minutes');
