-- 1. Enable UUID extension
create extension if not exists "uuid-ossp";

-- 2. Create Tables

-- USERS: Stores both Teachers and Students
create table public.users (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  name text not null,
  role text not null check (role in ('TEACHER', 'STUDENT')),
  student_id text unique, -- Used for login (e.g., '64001'), null for teachers
  section text, -- Group/Class section (e.g., 'SEC01'), null for teachers
  password text -- Added for Teacher login (Simple text storage for this prototype)
);

-- EXAMS: Stores examination details
create table public.exams (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  title text not null,
  description text,
  duration_minutes int not null default 60,
  is_active boolean default false,
  assigned_sections text[] default '{}'::text[] -- Array of strings e.g. ['SEC01', 'SEC02']
);

-- QUESTIONS: Linked to Exams
create table public.questions (
  id uuid default gen_random_uuid() primary key,
  exam_id uuid references public.exams(id) on delete cascade not null,
  type text not null check (type in ('MCQ', 'JAVA', 'SHORT_ANSWER')), -- Updated Types
  text text not null,
  image_url text, -- Added Image URL support
  score int not null default 0,
  options text[], -- For MCQ: Array of choices
  correct_option_index int, -- For MCQ: Index of correct choice (0-3)
  test_cases jsonb, -- For JAVA: JSON array [{"input": "...", "output": "..."}]
  accepted_answers text[] -- For SHORT_ANSWER: Array of valid answers e.g. ['java', 'Java']
);

-- STUDENT PROGRESS: Real-time tracking of exam attempts
create table public.student_progress (
  id uuid default gen_random_uuid() primary key,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  student_id text references public.users(student_id) on delete cascade not null,
  exam_id uuid references public.exams(id) on delete cascade not null,
  current_question_index int default 0,
  answers jsonb default '{}'::jsonb, -- Stores answers as JSON object { "q_id": "answer" }
  score int default 0,
  status text check (status in ('IDLE', 'IN_PROGRESS', 'COMPLETED')) default 'IDLE',
  started_at timestamp with time zone, -- NEW: To track strict timing
  -- Ensure one active attempt per student per exam
  unique(student_id, exam_id)
);

-- 3. Enable Realtime (Crucial for Teacher Dashboard)
alter publication supabase_realtime add table public.student_progress;

-- 4. Initial Seed Data

-- Teacher (Default password matches the code: admin123)
insert into public.users (name, role, password) values
('Dr. Smith', 'TEACHER', 'admin123');

-- Students
insert into public.users (name, role, student_id, section) values
('Alice Student', 'STUDENT', '64001', 'SEC01'),
('Bob Student', 'STUDENT', '64002', 'SEC02');

-- Sample Exam
DO $$
DECLARE
  v_exam_id uuid;
BEGIN
  insert into public.exams (title, description, duration_minutes, is_active, assigned_sections) 
  values ('CS101 Midterm: Java Basics', 'Fundamental concepts of Java Programming.', 60, true, array['SEC01', 'SEC02'])
  returning id into v_exam_id;

  -- Question 1 (MCQ)
  insert into public.questions (exam_id, type, text, score, options, correct_option_index)
  values (v_exam_id, 'MCQ', 'Which data type is used to create a variable that should store text?', 5, array['String', 'char', 'float', 'boolean'], 0);

  -- Question 2 (Java)
  insert into public.questions (exam_id, type, text, score, test_cases)
  values (v_exam_id, 'JAVA', 'Write a Java method named `sum` that takes two integers and returns their sum.', 20, '[{"input": "1 2", "output": "3"}, {"input": "10 -5", "output": "5"}]'::jsonb);
  
  -- Question 3 (Short Answer with Image)
  insert into public.questions (exam_id, type, text, image_url, score, accepted_answers)
  values (v_exam_id, 'SHORT_ANSWER', 'What is the name of this famous temple in Thailand?', 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Wat_Arun_July_2020.jpg/640px-Wat_Arun_July_2020.jpg', 5, array['Wat Arun', 'Temple of Dawn']);
END $$;