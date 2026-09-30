-- Monarch Healing — client accounts & bookings
-- Run once in the Supabase SQL editor (Project → SQL Editor → New query → paste → Run).
-- Safe to re-run: every object is created with IF NOT EXISTS / OR REPLACE where Postgres allows.
--
-- Security model
--   * Clients sign in with an emailed link (Supabase Auth). Each client sees only their own profile and bookings.
--   * Clients never write the bookings table directly. Every change goes through a function below that
--     checks the rules (open time slot, 12 h lead time, 24 h cancellation window, own bookings only).
--   * Admins (rows in public.admins) can see every booking and confirm, cancel or complete them.
--   * Double booking is impossible at the database level (exclusion constraint on practitioner + time range).

create extension if not exists btree_gist;

-- ───────────────────────── reference data (public, non-personal) ─────────────────────────
create table if not exists public.practitioners (
  id         text primary key,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  id        text primary key,
  name      text not null,
  is_remote boolean not null default false,
  address   text,                       -- sent to clients only in confirmations; not shown publicly
  active    boolean not null default true
);

create table if not exists public.therapies (
  id            text primary key,
  name          text not null,
  minutes       int  not null check (minutes between 10 and 240),
  bookable      boolean not null default true,
  waitlist_only boolean not null default false,
  sort          int not null default 0
);

create table if not exists public.practitioner_therapies (
  practitioner_id text references public.practitioners on delete cascade,
  therapy_id      text references public.therapies on delete cascade,
  primary key (practitioner_id, therapy_id)
);

create table if not exists public.therapy_locations (
  therapy_id  text references public.therapies on delete cascade,
  location_id text references public.locations on delete cascade,
  primary key (therapy_id, location_id)
);

-- Weekly opening slots per practitioner (weekday: 0 = Sunday … 6 = Saturday, Vancouver time)
create table if not exists public.availability (
  practitioner_id text references public.practitioners on delete cascade,
  weekday         int  not null check (weekday between 0 and 6),
  start_time      time not null,
  primary key (practitioner_id, weekday, start_time)
);

-- ───────────────────────── people ─────────────────────────
create table if not exists public.admins (
  user_id    uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

-- Emails that become admins automatically when they first sign in (edit this list to change who runs the practice)
create table if not exists public.admin_emails (
  email text primary key check (email = lower(email))
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text,
  full_name  text check (char_length(full_name) <= 120),
  phone      text check (char_length(phone) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (new.id, new.email,
          left(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 120),
          left(nullif(trim(new.raw_user_meta_data->>'phone'), ''), 40))
  on conflict (id) do nothing;
  if exists (select 1 from public.admin_emails where email = lower(new.email)) then
    insert into public.admins (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── bookings ─────────────────────────
do $$ begin
  create type public.booking_status as enum ('requested','confirmed','waitlist','cancelled','completed','no_show');
exception when duplicate_object then null; end $$;

create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references auth.users on delete cascade,
  therapy_id      text not null references public.therapies,
  practitioner_id text not null references public.practitioners,
  location_id     text not null references public.locations,
  format          text not null default 'Individual' check (format in ('Individual','Couples','Group','Walking')),
  starts_at       timestamptz,
  ends_at         timestamptz,
  status          public.booking_status not null,
  notes           text check (char_length(notes) <= 1000),
  first_visit     boolean not null default false,
  cancelled_at    timestamptz,
  cancelled_by    text check (cancelled_by in ('client','practice')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint time_needed check (status = 'waitlist' or status = 'cancelled' or starts_at is not null),
  constraint time_order  check (starts_at is null or ends_at > starts_at),
  constraint no_double_booking exclude using gist (
    practitioner_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('requested','confirmed'))
);

create index if not exists bookings_client_idx on public.bookings (client_id, starts_at);
create index if not exists bookings_time_idx   on public.bookings (practitioner_id, starts_at);

-- ───────────────────────── row level security ─────────────────────────
alter table public.practitioners          enable row level security;
alter table public.locations              enable row level security;
alter table public.therapies              enable row level security;
alter table public.practitioner_therapies enable row level security;
alter table public.therapy_locations      enable row level security;
alter table public.availability           enable row level security;
alter table public.admins                 enable row level security;
alter table public.admin_emails           enable row level security;
alter table public.profiles               enable row level security;
alter table public.bookings               enable row level security;

-- reference data: anyone may read, only admins may change
do $$
declare t text;
begin
  foreach t in array array['practitioners','locations','therapies','practitioner_therapies','therapy_locations','availability'] loop
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
    execute format('drop policy if exists "admin write" on public.%I', t);
    execute format('create policy "admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- locations: hide the street address from the public API (clients get it in their confirmation)
revoke select on public.locations from anon, authenticated;
grant  select (id, name, is_remote, active) on public.locations to anon, authenticated;

-- profiles: own row, admins see all
drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile read"   on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant  update (full_name, phone) on public.profiles to authenticated;

-- bookings: read own (admins read all); all writes go through the functions below
drop policy if exists "own bookings read" on public.bookings;
create policy "own bookings read" on public.bookings for select to authenticated using (client_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.bookings from anon, authenticated;
revoke all on public.admins from anon, authenticated;
revoke all on public.admin_emails from anon, authenticated;

-- ───────────────────────── booking rules (functions) ─────────────────────────
-- Lead time and cancellation window, in one place
create or replace function public.booking_rules()
returns table (lead_hours int, cancel_hours int, horizon_days int, max_open_requests int)
language sql immutable as $$ select 12, 24, 60, 5 $$;

-- Free start times for a practitioner + therapy over the next p_days days (Vancouver local date/time)
create or replace function public.available_slots(p_practitioner text, p_therapy text, p_from date default null, p_days int default 21)
returns table (slot_date date, slot_time time)
language sql stable security definer set search_path = '' as $$
  with r as (select * from public.booking_rules()),
  t as (select minutes from public.therapies
        where id = p_therapy and bookable and not waitlist_only),
  d as (select generate_series(coalesce(p_from, (now() at time zone 'America/Vancouver')::date),
                               coalesce(p_from, (now() at time zone 'America/Vancouver')::date) + least(greatest(p_days,1),60) - 1,
                               interval '1 day')::date as day),
  c as (select d.day, a.start_time,
               ((d.day + a.start_time) at time zone 'America/Vancouver') as s,
               ((d.day + a.start_time) at time zone 'America/Vancouver') + make_interval(mins => t.minutes) as e
        from d
        join public.availability a on a.practitioner_id = p_practitioner and a.weekday = extract(dow from d.day)
        cross join t
        where exists (select 1 from public.practitioner_therapies pt join public.practitioners p on p.id = pt.practitioner_id
                      where pt.practitioner_id = p_practitioner and pt.therapy_id = p_therapy and p.active))
  select c.day, c.start_time from c, r
  where c.s >= now() + make_interval(hours => r.lead_hours)
    and c.s <  now() + make_interval(days  => r.horizon_days)
    and not exists (select 1 from public.bookings b
                    where b.practitioner_id = p_practitioner
                      and b.status in ('requested','confirmed')
                      and tstzrange(b.starts_at, b.ends_at) && tstzrange(c.s, c.e))
  order by 1, 2;
$$;

-- internal: validate a requested slot and return its start/end
create or replace function public._check_slot(p_practitioner text, p_therapy text, p_date date, p_time time, p_ignore uuid default null)
returns table (s timestamptz, e timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare r record; m int; st timestamptz;
begin
  select * into r from public.booking_rules();
  select minutes into m from public.therapies where id = p_therapy;
  if p_date is null or p_time is null then raise exception 'choose_time' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.availability
                 where practitioner_id = p_practitioner and weekday = extract(dow from p_date) and start_time = p_time) then
    raise exception 'not_open' using errcode = 'P0001';
  end if;
  st := (p_date + p_time) at time zone 'America/Vancouver';
  if st < now() + make_interval(hours => r.lead_hours) then raise exception 'too_soon' using errcode = 'P0001'; end if;
  if st > now() + make_interval(days => r.horizon_days) then raise exception 'too_far' using errcode = 'P0001'; end if;
  if exists (select 1 from public.bookings b
             where b.practitioner_id = p_practitioner and b.status in ('requested','confirmed')
               and (p_ignore is null or b.id <> p_ignore)
               and tstzrange(b.starts_at, b.ends_at) && tstzrange(st, st + make_interval(mins => m))) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;
  return query select st, st + make_interval(mins => m);
end $$;

-- Client: request a session (or join a waitlist for therapies not open yet)
create or replace function public.request_booking(
  p_therapy text, p_practitioner text, p_location text,
  p_format text default 'Individual', p_date date default null, p_time time default null,
  p_notes text default null, p_first_visit boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); th record; slot record; new_id uuid; r record;
begin
  if uid is null then raise exception 'sign_in_required' using errcode = 'P0001'; end if;
  select * into r from public.booking_rules();
  select * into th from public.therapies where id = p_therapy and bookable;
  if not found then raise exception 'unknown_therapy' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.practitioner_therapies pt join public.practitioners p on p.id = pt.practitioner_id
                 where pt.practitioner_id = p_practitioner and pt.therapy_id = p_therapy and p.active) then
    raise exception 'practitioner_unavailable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.therapy_locations tl join public.locations l on l.id = tl.location_id
                 where tl.therapy_id = p_therapy and tl.location_id = p_location and l.active) then
    raise exception 'location_unavailable' using errcode = 'P0001';
  end if;

  if th.waitlist_only then
    if exists (select 1 from public.bookings where client_id = uid and therapy_id = p_therapy and status = 'waitlist') then
      raise exception 'already_waitlisted' using errcode = 'P0001';
    end if;
    insert into public.bookings (client_id, therapy_id, practitioner_id, location_id, format, status, notes, first_visit)
    values (uid, p_therapy, p_practitioner, p_location, 'Individual', 'waitlist', left(p_notes, 1000), coalesce(p_first_visit,false))
    returning id into new_id;
    return new_id;
  end if;

  if (select count(*) from public.bookings where client_id = uid and status = 'requested' and starts_at > now()) >= r.max_open_requests then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;

  select * into slot from public._check_slot(p_practitioner, p_therapy, p_date, p_time);
  begin
    insert into public.bookings (client_id, therapy_id, practitioner_id, location_id, format, starts_at, ends_at, status, notes, first_visit)
    values (uid, p_therapy, p_practitioner, p_location,
            case when p_format in ('Individual','Couples','Group','Walking') then p_format else 'Individual' end,
            slot.s, slot.e, 'requested', left(p_notes, 1000), coalesce(p_first_visit,false))
    returning id into new_id;
  exception when exclusion_violation then
    raise exception 'slot_taken' using errcode = 'P0001';
  end;
  return new_id;
end $$;

-- Client: cancel own booking (not within the cancellation window)
create or replace function public.cancel_booking(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b record; r record;
begin
  select * into r from public.booking_rules();
  select * into b from public.bookings where id = p_id and client_id = auth.uid() for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if b.status not in ('requested','confirmed','waitlist') then raise exception 'not_active' using errcode = 'P0001'; end if;
  if b.starts_at is not null and b.status = 'confirmed' and b.starts_at < now() + make_interval(hours => r.cancel_hours) then
    raise exception 'late_cancel' using errcode = 'P0001';
  end if;
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'client', updated_at = now() where id = p_id;
end $$;

-- Client: move own booking to another open time (goes back to "requested" for Monika to confirm)
create or replace function public.reschedule_booking(p_id uuid, p_date date, p_time time)
returns void language plpgsql security definer set search_path = '' as $$
declare b record; r record; slot record;
begin
  select * into r from public.booking_rules();
  select * into b from public.bookings where id = p_id and client_id = auth.uid() for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if b.status not in ('requested','confirmed') then raise exception 'not_active' using errcode = 'P0001'; end if;
  if b.status = 'confirmed' and b.starts_at < now() + make_interval(hours => r.cancel_hours) then
    raise exception 'late_change' using errcode = 'P0001';
  end if;
  select * into slot from public._check_slot(b.practitioner_id, b.therapy_id, p_date, p_time, p_id);
  begin
    update public.bookings set starts_at = slot.s, ends_at = slot.e, status = 'requested', updated_at = now() where id = p_id;
  exception when exclusion_violation then
    raise exception 'slot_taken' using errcode = 'P0001';
  end;
end $$;

-- Admin: change status of any booking
create or replace function public.admin_set_status(p_id uuid, p_status public.booking_status)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admins_only' using errcode = 'P0001'; end if;
  if p_status not in ('confirmed','cancelled','completed','no_show','requested') then raise exception 'bad_status' using errcode = 'P0001'; end if;
  begin
    update public.bookings
       set status = p_status, updated_at = now(),
           cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
           cancelled_by = case when p_status = 'cancelled' then 'practice' else cancelled_by end
     where id = p_id;
  exception when exclusion_violation then
    raise exception 'slot_taken' using errcode = 'P0001';
  end;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
end $$;

-- Location address for a client's own confirmed in-person booking
create or replace function public.booking_address(p_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select l.address from public.bookings b join public.locations l on l.id = b.location_id
  where b.id = p_id and (b.client_id = auth.uid() or public.is_admin()) and b.status = 'confirmed';
$$;

revoke all on function public._check_slot(text,text,date,time,uuid) from public, anon, authenticated;
revoke all on function public.request_booking(text,text,text,text,date,time,text,boolean) from public, anon;
revoke all on function public.cancel_booking(uuid) from public, anon;
revoke all on function public.reschedule_booking(uuid,date,time) from public, anon;
revoke all on function public.admin_set_status(uuid,public.booking_status) from public, anon;
revoke all on function public.booking_address(uuid) from public, anon;
grant execute on function public.available_slots(text,text,date,int) to anon, authenticated;
grant execute on function public.request_booking(text,text,text,text,date,time,text,boolean) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.reschedule_booking(uuid,date,time) to authenticated;
grant execute on function public.admin_set_status(uuid,public.booking_status) to authenticated;
grant execute on function public.booking_address(uuid) to authenticated;
grant execute on function public.booking_rules() to anon, authenticated;
