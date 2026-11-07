-- ResQConnect MVP database schema
-- Run this entire file in Supabase SQL Editor.
-- IMPORTANT: this is a community coordination prototype, not emergency dispatch software.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 70),
  role text not null default 'citizen' check (role in ('citizen','volunteer','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 4 and 90),
  category text not null check (char_length(category) between 2 and 80),
  priority text not null default 'Low' check (priority in ('Low','Medium','High')),
  area text not null check (char_length(area) between 2 and 120),
  description text not null check (char_length(description) between 8 and 700),
  status text not null default 'Open' check (status in ('Open','In progress','Resolved','Cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.volunteer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 70),
  skills text not null check (char_length(skills) between 2 and 140),
  service_area text not null check (char_length(service_area) between 2 and 100),
  availability text not null default 'Unavailable' check (availability in ('Available','Unavailable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incidents_created_at_idx on public.incidents(created_at desc);
create index if not exists incidents_status_idx on public.incidents(status);
create index if not exists volunteer_profiles_created_at_idx on public.volunteer_profiles(created_at desc);

-- Create a profile at signup. The requested role in user metadata is intentionally ignored:
-- users cannot self-assign the admin role during registration.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Community member'),
    case when new.raw_user_meta_data ->> 'requested_role' = 'volunteer' then 'volunteer' else 'citizen' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_resqconnect on auth.users;
create trigger on_auth_user_created_resqconnect
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists incidents_set_updated_at on public.incidents;
create trigger incidents_set_updated_at before update on public.incidents
for each row execute procedure public.set_updated_at();

drop trigger if exists volunteer_profiles_set_updated_at on public.volunteer_profiles;
create trigger volunteer_profiles_set_updated_at before update on public.volunteer_profiles
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.incidents enable row level security;
alter table public.volunteer_profiles enable row level security;

-- Profiles: signed-in users may view basic member names/roles; only their own row is editable.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()) and role in ('citizen','volunteer'));

-- Incidents: signed-in members can view reports. A user can create reports as themselves.
drop policy if exists "incidents_select_authenticated" on public.incidents;
create policy "incidents_select_authenticated" on public.incidents
for select to authenticated using (true);

drop policy if exists "incidents_insert_own" on public.incidents;
create policy "incidents_insert_own" on public.incidents
for insert to authenticated with check (reporter_id = (select auth.uid()));

-- Report owner can update their report; admins can update any report.
drop policy if exists "incidents_update_owner_or_admin" on public.incidents;
create policy "incidents_update_owner_or_admin" on public.incidents
for update to authenticated
using (
  reporter_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
)
with check (
  reporter_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
);

-- Volunteer directory: signed-in users can view opted-in profiles.
drop policy if exists "volunteers_select_authenticated" on public.volunteer_profiles;
create policy "volunteers_select_authenticated" on public.volunteer_profiles
for select to authenticated using (true);

drop policy if exists "volunteers_insert_own" on public.volunteer_profiles;
create policy "volunteers_insert_own" on public.volunteer_profiles
for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "volunteers_update_own" on public.volunteer_profiles;
create policy "volunteers_update_own" on public.volunteer_profiles
for update to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Enable Postgres Changes for the realtime tables.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'incidents'
  ) then
    alter publication supabase_realtime add table public.incidents;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'volunteer_profiles'
  ) then
    alter publication supabase_realtime add table public.volunteer_profiles;
  end if;
end $$;

-- Admin promotion is a manual owner-only database operation, never exposed in the client.
-- After creating your own account, run:
-- update public.profiles set role = 'admin' where id = 'YOUR_AUTH_USER_UUID';
