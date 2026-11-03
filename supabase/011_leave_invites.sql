-- Duty Roster update 11: leave from calendar invites.
-- Run once in Supabase > SQL Editor, after 006_hardening.sql (and 008/010 if you had those features).
-- Safe to run again.
--
-- People invite a shared Google account (for example ourteam.leave@gmail.com) to their all-day
-- out-of-office event in Outlook. A Google Apps Script in that account (scripts/leave-invites.gs)
-- sends the upcoming invites here every 15 minutes with sync_leave_invites(). Each invite is matched
-- to a person by their work email (or sign-in email) and becomes their leave: added when the invite
-- appears, moved when it moves, removed when it's cancelled. Invites from unknown addresses are kept
-- for admins to assign.

-- ---------- Work emails ----------

-- The address people send invites from, when it isn't the one they sign in with. Private like email:
-- not in the column grants, only readable through member_work_emails().
alter table public.profiles add column if not exists work_email text;
create unique index if not exists profiles_work_email_key on public.profiles (lower(work_email)) where work_email is not null;

create or replace function public.member_work_emails()
returns table (id uuid, work_email text)
language sql stable security definer set search_path = public
as $$ select p.id, p.work_email from public.profiles p where p.id = auth.uid() or public.is_admin() $$;

-- Signed-in, approved members set their own work email; admins set anyone's. Nobody else (not the
-- public page, not people waiting for approval) can. An empty value clears it.
create or replace function public.set_work_email(p_user uuid, p_email text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare e text := nullif(lower(trim(p_email)), '');
begin
  if not (public.is_admin() or (p_user = auth.uid() and public.is_member())) then
    raise exception 'You can only change your own work email.';
  end if;
  if e is not null and (char_length(e) > 254 or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Please enter a valid email address.';
  end if;
  if e is not null and exists (select 1 from public.profiles where id <> p_user and (lower(work_email) = e or lower(email) = e)) then
    raise exception 'That email already belongs to someone else on the roster.';
  end if;
  update public.profiles set work_email = e where id = p_user;
  -- Anything already waiting from this address can now be matched on the next sync.
  if e is not null then delete from public.unmatched_invites where lower(organizer) = e; end if;
end;
$$;

-- ---------- Leave that came from an invite ----------

alter table public.leaves add column if not exists invite_uid text;
create unique index if not exists leaves_invite_uid_key on public.leaves (invite_uid) where invite_uid is not null;
-- The app only needs to know that leave came from an invite, not the invite's id.
alter table public.leaves add column if not exists from_invite boolean generated always as (invite_uid is not null) stored;
grant select (from_invite) on public.leaves to authenticated;

-- The address to invite, shown in the app. Set by an admin in Team & settings.
alter table public.settings add column if not exists invite_address text;

-- Invites whose sender matched nobody, for admins to assign.
create table if not exists public.unmatched_invites (
  uid        text primary key,
  organizer  text not null,
  title      text,
  start_date date not null,
  end_date   date not null,
  seen_at    timestamptz not null default now()
);
-- Dismissed invites stay hidden from admins until the invite itself goes away.
alter table public.unmatched_invites add column if not exists dismissed boolean not null default false;
alter table public.unmatched_invites enable row level security;
revoke all on public.unmatched_invites from anon, authenticated;
grant select, delete, update (dismissed) on public.unmatched_invites to authenticated;
drop policy if exists "admins read unmatched invites" on public.unmatched_invites;
create policy "admins read unmatched invites" on public.unmatched_invites for select to authenticated using (public.is_admin());
drop policy if exists "admins dismiss unmatched invites" on public.unmatched_invites;
create policy "admins dismiss unmatched invites" on public.unmatched_invites for delete to authenticated using (public.is_admin());
drop policy if exists "admins hide unmatched invites" on public.unmatched_invites;
create policy "admins hide unmatched invites" on public.unmatched_invites for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- The morning script proves who it is with this secret. See it with: select script_secret from public.invite_config;
create table if not exists public.invite_config (
  id            integer primary key default 1 check (id = 1),
  script_secret uuid not null default gen_random_uuid(),
  last_sync     timestamptz
);
insert into public.invite_config (id) values (1) on conflict (id) do nothing;
alter table public.invite_config enable row level security;
revoke all on public.invite_config from anon, authenticated;

-- ---------- The sync ----------

-- p_events: every leave-like invite the shared calendar has from today on, as
-- [{ "uid": "...", "organizer": "a@b.com", "title": "...", "start": "2026-11-09", "end": "2026-11-10" }]
-- with `end` the last day of leave (inclusive). Anything not in the list has been cancelled.
-- Leave that has already begun keeps its start date and is only ever shortened to end yesterday,
-- the same rule as for leave changed in the app.
create or replace function public.sync_leave_invites(p_secret uuid, p_events json)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  today    date := public.sg_today();
  ev       record;
  who      uuid;
  old      public.leaves%rowtype;
  added    int := 0;
  moved    int := 0;
  removed  int := 0;
  unknown  int := 0;
  uids     text[] := '{}';
begin
  if p_secret is distinct from (select script_secret from public.invite_config where id = 1) then
    raise exception 'Wrong script secret.';
  end if;

  for ev in
    select e->>'uid' as uid, lower(trim(e->>'organizer')) as organizer, left(e->>'title', 120) as title,
           (e->>'start')::date as start_date, (e->>'end')::date as end_date
      from json_array_elements(coalesce(p_events, '[]'::json)) e
  loop
    continue when ev.uid is null or ev.start_date is null or ev.end_date is null or ev.end_date < ev.start_date or ev.end_date < today;
    uids := uids || ev.uid;
    select id into who from public.profiles
      where approved and (lower(email) = ev.organizer or lower(work_email) = ev.organizer) limit 1;
    if who is null then
      insert into public.unmatched_invites (uid, organizer, title, start_date, end_date)
        values (ev.uid, ev.organizer, ev.title, ev.start_date, ev.end_date)
        on conflict (uid) do update set organizer = excluded.organizer, title = excluded.title,
          start_date = excluded.start_date, end_date = excluded.end_date;
      unknown := unknown + 1;
      continue;
    end if;
    delete from public.unmatched_invites where uid = ev.uid;

    select * into old from public.leaves where invite_uid = ev.uid;
    if not found then
      insert into public.leaves (user_id, start_date, end_date, note, invite_uid)
        values (who, greatest(ev.start_date, today), ev.end_date, 'From calendar invite', ev.uid);
      added := added + 1;
    elsif old.start_date < today then
      -- Already begun: the start stays; the end can move, but not before yesterday.
      if old.end_date <> greatest(ev.end_date, today - 1) then
        update public.leaves set end_date = greatest(ev.end_date, today - 1) where id = old.id;
        moved := moved + 1;
      end if;
    elsif (old.start_date, old.end_date, old.user_id) is distinct from (greatest(ev.start_date, today), ev.end_date, who) then
      update public.leaves set user_id = who, start_date = greatest(ev.start_date, today), end_date = ev.end_date where id = old.id;
      moved := moved + 1;
    end if;
  end loop;

  -- Cancelled invites: leave that hasn't begun is removed; leave that has begun ends yesterday.
  with gone as (
    delete from public.leaves where invite_uid is not null and not (invite_uid = any(uids)) and start_date >= today returning 1
  ) select removed + count(*) into removed from gone;
  update public.leaves set end_date = today - 1
    where invite_uid is not null and not (invite_uid = any(uids)) and start_date < today and end_date >= today;
  delete from public.unmatched_invites where not (uid = any(uids));

  update public.invite_config set last_sync = now() where id = 1;
  return json_build_object('added', added, 'moved', moved, 'removed', removed, 'unmatched', unknown);
end;
$$;

revoke execute on function public.member_work_emails(), public.set_work_email(uuid, text) from public, anon;
grant execute on function public.member_work_emails(), public.set_work_email(uuid, text) to authenticated;
revoke execute on function public.sync_leave_invites(uuid, json) from public;
grant execute on function public.sync_leave_invites(uuid, json) to anon;
