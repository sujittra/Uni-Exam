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

## หมายเหตุ
- ระบบ Dashboard ใช้อาศัยฟีเจอร์ **Realtime** ซึ่งสคริปต์ SQL ได้เปิดใช้งานให้แล้วในบรรทัด `alter publication supabase_realtime...`
- ระบบ Login ปัจจุบันออกแบบมาให้ใช้ `student_id` ในตาราง `users` ในการตรวจสอบสิทธิ์แบบง่าย (เพื่อให้ตรงกับ requirement นำเข้า Excel) โดยไม่ต้องใช้ Supabase Auth (Email/Password) ที่ซับซ้อนเกินไปสำหรับเฟสแรก