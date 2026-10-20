-- Duty Roster update 3: member approval and private data (fixes GitHub issues #1 and #2).
-- Run once in Supabase > SQL Editor, after schema.sql (which already includes update 2).
--
-- #1: New sign-ups must be approved by an admin before they can see the roster or join the rotation.
--     Emails are visible only to the person and to admins; leave notes only to their owner and admins.
-- #2: The public calendar no longer returns leave rows or account IDs. The database works out the
--     duty list itself and returns only names and roles per day, for a limited window.

-- ---------- #1 Member approval ----------

alter table public.profiles add column if not exists approved boolean not null default false;
-- Everyone already signed up when this runs is treated as an existing team member.
update public.profiles set approved = true where not approved;

-- True when the signed-in user is an approved member.
create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select approved from public.profiles where id = auth.uid()), false) $$;

-- New sign-ups wait for approval. The very first person is approved and becomes the admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare first_user boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, email, display_name, rota_order, is_admin, approved)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    coalesce((select max(rota_order) + 1 from public.profiles), 0),
    first_user,
    first_user
  );
  return new;
end;
$$;

-- Non-admins may only change their own display name.
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
    new.approved   := old.approved;
  end if;
  return new;
end;
$$;

-- Only approved members can read the team and leave. Everyone can still read their own profile,
-- so someone waiting for approval can see that they're waiting.
drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_member());
drop policy if exists "read leaves" on public.leaves;
create policy "read leaves" on public.leaves for select to authenticated
  using (public.is_member());
drop policy if exists "add own leave" on public.leaves;
create policy "add own leave" on public.leaves for insert to authenticated
  with check ((user_id = auth.uid() and public.is_member()) or public.is_admin());

-- Emails and leave notes are not readable through the normal table API at all...
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, rota_order, active, is_admin, approved, created_at) on public.profiles to authenticated;
revoke select on public.leaves from anon, authenticated;
grant select (id, user_id, start_date, end_date, created_at) on public.leaves to authenticated;

-- ...only through these, which return your own and, for admins, everyone's.
create or replace function public.member_emails()
returns table (id uuid, email text)
language sql stable security definer set search_path = public
as $$ select p.id, p.email from public.profiles p where p.id = auth.uid() or public.is_admin() $$;

create or replace function public.leave_notes()
returns table (id bigint, note text)
language sql stable security definer set search_path = public
as $$ select l.id, l.note from public.leaves l
      where l.note is not null and (l.user_id = auth.uid() or public.is_admin()) $$;

revoke execute on function public.is_member(), public.member_emails(), public.leave_notes() from public, anon;
grant execute on function public.is_member(), public.member_emails(), public.leave_notes() to authenticated;

-- ---------- #2 Public calendar without leave data ----------

-- New installs start with the public calendar off. An existing setting is left as it is.
alter table public.settings alter column public_calendar set default false;

drop function if exists public.public_roster();

-- The duty list for each day from p_from to p_to, worked out with the same rules as src/schedule.js:
-- active, approved members in rota order; Monday to Friday minus holidays; people on leave are skipped,
-- and the next working day starts with the person after today's Primary.
-- Returns only names and roles. The window is limited to 90 days back and 180 days ahead, 62 days at most.
-- Returns null when the public calendar is switched off.
create or replace function public.public_calendar(p_from date, p_to date)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  s        public.settings%rowtype;
  ids      uuid[];
  names    text[];
  n        int;
  ptr      int := 0;
  d        date;
  win_from date;
  win_to   date;
  hol      text;
  duties   json[];
  first_pos int;
  pos      int;
  days     json[] := '{}';
begin
  select * into s from public.settings where id = 1;
  if not found or not s.public_calendar then return null; end if;

  win_from := greatest(p_from, current_date - 90);
  win_to   := least(p_to, current_date + 180, win_from + 62);

  select array_agg(p.id order by p.rota_order, p.created_at, p.id),
         array_agg(p.display_name order by p.rota_order, p.created_at, p.id)
    into ids, names
    from public.profiles p where p.active and p.approved;
  n := coalesce(array_length(ids, 1), 0);

  d := least(s.rota_start, win_from);
  while d <= win_to loop
    select h.name into hol from public.holidays h where h.date = d;
    if d < s.rota_start then
      if d >= win_from then days := days || json_build_object('date', d, 'kind', 'before-start'); end if;
    elsif extract(isodow from d) >= 6 then
      if d >= win_from then days := days || json_build_object('date', d, 'kind', 'weekend'); end if;
    elsif hol is not null then
      if d >= win_from then days := days || json_build_object('date', d, 'kind', 'holiday', 'holiday', hol); end if;
    else
      duties := '{}';
      first_pos := -1;
      for i in 0 .. n - 1 loop
        pos := (ptr + i) % n;
        continue when exists (select 1 from public.leaves l
                              where l.user_id = ids[pos + 1] and d between l.start_date and l.end_date);
        if first_pos < 0 then first_pos := pos; end if;
        duties := duties || json_build_object(
          'role', case when coalesce(array_length(duties, 1), 0) = 0 then 'Primary'
                       else 'Secondary ' || array_length(duties, 1) end,
          'name', names[pos + 1]);
      end loop;
      if first_pos >= 0 then ptr := (first_pos + 1) % n; end if;
      if d >= win_from then days := days || json_build_object('date', d, 'kind', 'work', 'duties', to_json(duties)); end if;
    end if;
    d := d + 1;
  end loop;

  return json_build_object('rota_start', s.rota_start, 'from', win_from, 'to', win_to,
                           'people', to_json(coalesce(names, '{}')), 'days', to_json(days));
end;
$$;

revoke execute on function public.public_calendar(date, date) from public;
grant execute on function public.public_calendar(date, date) to anon, authenticated;
