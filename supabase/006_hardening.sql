-- Duty Roster update 6: safer admin rules, limits and reordering (fixes GitHub issues #3, #5 and #9).
-- Run once in Supabase > SQL Editor, after 004_stable_history.sql.
--
-- #3: Two people signing up at the same moment can no longer both become the first admin, and
--     changes made by the project owner in the SQL editor are no longer silently undone.
-- #5: The database limits name and note length, and how much leave a non-admin can book at once.
-- #9: The rotation order is saved in one step, and sign-ups always get their own place at the end.

-- ---------- #3 First admin and owner changes ----------

-- Sign-ups take a lock first, so they're numbered one at a time: no shared rota_order, and only
-- the very first person becomes the admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare first_user boolean;
begin
  perform pg_advisory_xact_lock(hashtext('duty-roster:new-user'));
  first_user := not exists (select 1 from public.profiles);
  insert into public.profiles (id, email, display_name, rota_order, is_admin, approved)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 60),
    coalesce((select max(rota_order) + 1 from public.profiles), 0),
    first_user,
    first_user
  );
  return new;
end;
$$;

-- Non-admins may only change their own display name. The project owner (SQL editor, service role)
-- has no signed-in user, and can change anything.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  new.is_admin   := old.is_admin;
  new.rota_order := old.rota_order;
  new.active     := old.active;
  new.email      := old.email;
  new.approved   := old.approved;
  return new;
end;
$$;

-- Trigger functions aren't for calling directly, and is_admin() is only needed by signed-in users.
revoke execute on function public.is_admin(), public.handle_new_user(), public.protect_profile_fields() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------- #5 Limits ----------

-- "not valid" checks new and changed rows only, so existing data never stops this file from running.
alter table public.profiles drop constraint if exists name_length;
alter table public.profiles add constraint name_length
  check (char_length(trim(display_name)) between 1 and 60) not valid;
alter table public.leaves drop constraint if exists note_length;
alter table public.leaves add constraint note_length
  check (note is null or char_length(note) <= 120) not valid;
alter table public.holidays drop constraint if exists holiday_name_length;
alter table public.holidays add constraint holiday_name_length
  check (char_length(trim(name)) between 1 and 60) not valid;

-- Same rules as 004_stable_history.sql, plus: non-admins book at most 180 days at a time and at most
-- a year ahead, so nobody can leave the rotation for good. Admins can record longer leave.
create or replace function public.enforce_leave_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare today date := public.sg_today();
begin
  -- Admins, and server-side work with no signed-in user (SQL editor, dashboard deletes and their cascades), aren't limited.
  if auth.uid() is null or public.is_admin() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.start_date < today then
    raise exception 'Leave can only be added from today onwards. Ask an admin to record past leave.';
  elsif tg_op = 'UPDATE' then
    if new.start_date <> old.start_date and least(new.start_date, old.start_date) < today then
      raise exception 'The start of leave that has begun can''t be changed. Ask an admin.';
    end if;
    if new.end_date < today - 1 and new.end_date <> old.end_date then
      raise exception 'Leave can only be shortened to end yesterday at the earliest.';
    end if;
  elsif tg_op = 'DELETE' and old.start_date < today then
    raise exception 'Leave that has begun can''t be deleted. End it early instead.';
  end if;
  -- Checked only when leave gets longer or moves, so shortening leave an admin recorded always works.
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date)) then
    if new.end_date - new.start_date >= 180
       and (tg_op = 'INSERT' or new.end_date - new.start_date > old.end_date - old.start_date) then
      raise exception 'Leave can be at most 180 days at a time. Ask an admin to record longer leave.';
    end if;
    if new.start_date > today + 365 and (tg_op = 'INSERT' or new.start_date <> old.start_date) then
      raise exception 'Leave can be booked up to a year ahead.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- ---------- #9 Reordering in one step ----------

-- Puts the given people at positions 0, 1, 2… in that order, all at once. Anyone not listed keeps
-- their relative order after them. Admins only.
create or replace function public.set_rota_order(ids uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the rotation order.';
  end if;
  with listed as (
    select x.id, x.ord from unnest(ids) with ordinality as x(id, ord)
  ), ranked as (
    select p.id, row_number() over (
             order by (l.ord is null), l.ord, p.rota_order, p.created_at, p.id) - 1 as pos
    from public.profiles p left join listed l on l.id = p.id
  )
  update public.profiles p set rota_order = r.pos
  from ranked r where r.id = p.id and p.rota_order is distinct from r.pos;
end;
$$;
revoke execute on function public.set_rota_order(uuid[]) from public, anon;
grant execute on function public.set_rota_order(uuid[]) to authenticated;

-- Untangle any people who already share a place in the order.
with ranked as (
  select id, row_number() over (order by rota_order, created_at, id) - 1 as pos from public.profiles
)
update public.profiles p set rota_order = r.pos from ranked r where r.id = p.id and p.rota_order <> r.pos;
