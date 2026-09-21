-- Non-destructive baseline for the schema used by the server.
-- Existing installations already have these tables; CREATE IF NOT EXISTS is intentional.
create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(), username text not null unique,
  password_hash text not null, role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(), code text not null, name text not null, customer text not null,
  end_user text, description text, pm_hours numeric, senior_hours numeric, engineer_hours numeric,
  created_at timestamptz not null default now()
);
create table if not exists public.engineers (
  id uuid primary key default gen_random_uuid(), employee_id text, name text not null, surname text not null,
  role text not null default 'Engineer', sub_system text, created_at timestamptz not null default now()
);
create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(), date date not null unique, description text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  created_by_user_id uuid not null references public.users(id) on delete cascade,
  engineer_id uuid, project_id uuid, work_date date not null,
  start_time text, end_time text, lunch numeric, expected numeric,
  travel numeric, mileage numeric, stay_hotel boolean not null default false,
  activities text, worked numeric, normal numeric, ot numeric, premium numeric, day_type text,
  created_at timestamptz not null default now()
);
create index if not exists timesheet_entries_created_by_user_id_idx on public.timesheet_entries(created_by_user_id);
