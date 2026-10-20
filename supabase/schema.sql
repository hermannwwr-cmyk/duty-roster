-- Duty Roster: database setup for Supabase.
-- Paste this whole file into Supabase > SQL Editor > New query, then Run. Safe to run once on a new project.

-- ---------- Tables ----------

-- One row per person. Created automatically when someone signs up.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null,
  rota_order   integer not null default 0,     -- position in the rotation circle
  active       boolean not null default true,  -- inactive people are left out of the roster
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Leave: an inclusive date range for one person.
create table public.leaves (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  start_date date not null,
  end_date   date not null,
  note       text,
  created_at timestamptz not null default now(),
  constraint leave_dates_in_order check (end_date >= start_date)
);
create index leaves_user_idx on public.leaves (user_id);
create index leaves_dates_idx on public.leaves (start_date, end_date);

-- Public holidays: no duty on these days.
create table public.holidays (
  date date primary key,
  name text not null
);

-- App settings: a single row.
create table public.settings (
  id         integer primary key default 1,
  rota_start date not null default current_date,  -- the rotation counts working days from here
  constraint single_row check (id = 1)
);
insert into public.settings (id) values (1);

-- ---------- Helpers and triggers ----------

-- True when the signed-in user is an admin.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;

-- Create a profile for every new sign-up. The very first person becomes the admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, rota_order, is_admin)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    coalesce((select max(rota_order) + 1 from public.profiles), 0),
    not exists (select 1 from public.profiles)
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Non-admins may edit their own display name only, not their admin flag, order or active status.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    new.is_admin   := old.is_admin;
    new.rota_order := old.rota_order;
    new.active     := old.active;
    new.email      := old.email;
  end if;
  return new;
end;
$$;
create trigger protect_profile_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ---------- Row level security ----------

alter table public.profiles enable row level security;
alter table public.leaves   enable row level security;
alter table public.holidays enable row level security;
alter table public.settings enable row level security;

-- Everyone signed in can see the team, everyone's leave, holidays and settings (the roster needs them).
create policy "read profiles" on public.profiles for select to authenticated using (true);
create policy "read leaves"   on public.leaves   for select to authenticated using (true);
create policy "read holidays" on public.holidays for select to authenticated using (true);
create policy "read settings" on public.settings for select to authenticated using (true);

-- People update their own profile; admins update anyone's.
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "admins delete profiles" on public.profiles for delete to authenticated using (public.is_admin());

-- People manage their own leave; admins manage anyone's.
create policy "add own leave" on public.leaves for insert to authenticated
  with check (user_id = auth.uid() or public.is_admin());
create policy "change own leave" on public.leaves for update to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "delete own leave" on public.leaves for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Only admins change holidays and settings.
create policy "admins add holidays"    on public.holidays for insert to authenticated with check (public.is_admin());
create policy "admins change holidays" on public.holidays for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete holidays" on public.holidays for delete to authenticated using (public.is_admin());
create policy "admins change settings" on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Singapore public holidays ----------
-- From the Ministry of Manpower dataset on data.gov.sg (collection 691), fetched 20 Oct 2026.
-- Admins can add later years in the app's Team tab.
insert into public.holidays (date, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-02-17', 'Chinese New Year'),
  ('2026-02-18', 'Chinese New Year'),
  ('2026-03-21', 'Hari Raya Puasa'),
  ('2026-04-03', 'Good Friday'),
  ('2026-05-01', 'Labour Day'),
  ('2026-05-27', 'Hari Raya Haji'),
  ('2026-05-31', 'Vesak Day'),
  ('2026-06-01', 'Vesak Day (Observed)'),
  ('2026-08-09', 'National Day'),
  ('2026-08-10', 'National Day (Observed)'),
  ('2026-11-08', 'Deepavali'),
  ('2026-11-09', 'Deepavali (Observed)'),
  ('2026-12-25', 'Christmas Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-02-06', 'Chinese New Year'),
  ('2027-02-07', 'Chinese New Year'),
  ('2027-02-08', 'Chinese New Year (Observed)'),
  ('2027-03-10', 'Hari Raya Puasa'),
  ('2027-03-26', 'Good Friday'),
  ('2027-05-01', 'Labour Day'),
  ('2027-05-17', 'Hari Raya Haji'),
  ('2027-05-20', 'Vesak Day'),
  ('2027-08-09', 'National Day'),
  ('2027-10-28', 'Deepavali'),
  ('2027-12-25', 'Christmas Day');
