-- Monarch Healing — starting data. Run after schema.sql. Safe to re-run.

insert into public.practitioners (id, name) values
  ('monika', 'Monika Kulaga')
on conflict (id) do update set name = excluded.name;

insert into public.locations (id, name, is_remote) values
  ('nv',       'North Vancouver studio', false),
  ('distance', 'Distance session',       true)
on conflict (id) do update set name = excluded.name, is_remote = excluded.is_remote;

insert into public.therapies (id, name, minutes, bookable, waitlist_only, sort) values
  ('call',   'Free check-in call',         20, true, false, 1),
  ('qlg',    'Quantum Life Guidance',      75, true, false, 2),
  ('acu',    'Jin Shin Do® acupressure',   60, true, false, 3),
  ('reflex', 'Reflexology',                60, true, false, 4),
  ('rmt',    'Registered Massage Therapy', 60, true, true,  5),
  ('stone',  'Hot stone massage',          90, true, true,  6)
on conflict (id) do update set name = excluded.name, minutes = excluded.minutes,
  bookable = excluded.bookable, waitlist_only = excluded.waitlist_only, sort = excluded.sort;

insert into public.practitioner_therapies (practitioner_id, therapy_id)
select 'monika', id from public.therapies
on conflict do nothing;

insert into public.therapy_locations (therapy_id, location_id) values
  ('call','distance'),
  ('qlg','nv'), ('qlg','distance'),
  ('acu','nv'), ('reflex','nv'), ('rmt','nv'), ('stone','nv')
on conflict do nothing;

-- Weekly hours (Vancouver time). 2 = Tue … 6 = Sat
insert into public.availability (practitioner_id, weekday, start_time)
select 'monika', d, t::time from (values
  (2,'10:00'),(2,'11:30'),(2,'13:30'),(2,'15:00'),(2,'16:30'),
  (3,'10:00'),(3,'11:30'),(3,'13:30'),(3,'15:00'),(3,'16:30'),
  (4,'12:00'),(4,'13:30'),(4,'15:00'),(4,'16:30'),(4,'18:00'),
  (5,'10:00'),(5,'11:30'),(5,'13:30'),(5,'15:00'),
  (6,'10:00'),(6,'11:30'),(6,'13:30')
) v(d,t)
on conflict do nothing;

-- Practice admins. Anyone on this list becomes an admin when they first sign in.
-- To change: delete/insert rows here, then run the two statements again.
insert into public.admin_emails (email) values
  ('erthal@gmail.com')
on conflict do nothing;
-- also covers people who already have an account
insert into public.admins (user_id)
select u.id from auth.users u join public.admin_emails a on a.email = lower(u.email)
on conflict do nothing;
