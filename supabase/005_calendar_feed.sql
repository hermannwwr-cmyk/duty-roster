-- Duty Roster update 5: personal calendar feed for phone calendars.
-- Run once in Supabase > SQL Editor, after 004_stable_history.sql.
--
-- Each person gets a secret link that calendar apps (Google Calendar, Apple Calendar, Samsung
-- Calendar, Outlook) can subscribe to. It lists that person's duty days as all-day events.
-- Anyone with the link can read that person's duties, so it can be reset from the app.

-- ---------- Secret link per person ----------

alter table public.profiles add column if not exists calendar_token uuid not null default gen_random_uuid();
-- calendar_token is not in the column grants from 003_private_data.sql, so nobody can read others' tokens.

create or replace function public.my_calendar_token()
returns uuid
language sql stable security definer set search_path = public
as $$ select calendar_token from public.profiles where id = auth.uid() $$;

create or replace function public.reset_calendar_token()
returns uuid
language sql volatile security definer set search_path = public
as $$ update public.profiles set calendar_token = gen_random_uuid() where id = auth.uid() returning calendar_token $$;

revoke execute on function public.my_calendar_token(), public.reset_calendar_token() from public, anon;
grant execute on function public.my_calendar_token(), public.reset_calendar_token() to authenticated;

-- ---------- The roster as rows ----------

-- Every working day's duties from p_from to p_to, one row per person on duty, with the same rules as
-- public_calendar() and src/schedule.js (checkpoints, leave, weekends, holidays). Internal: not callable
-- through the API.
create or replace function public.roster_rows(p_from date, p_to date)
returns table (day date, pos int, role text, user_id uuid, name text)
language plpgsql stable security definer set search_path = public
as $$
declare
  s         public.settings%rowtype;
  cp        public.rota_checkpoints%rowtype;
  first_cp  date;
  ids       uuid[] := '{}';
  names     text[] := '{}';
  n         int := 0;
  ptr       int := 0;
  d         date;
  k         int;
  first_pos int;
  p         int;
begin
  select * into s from public.settings where id = 1;
  select min(effective_date) into first_cp from public.rota_checkpoints;
  if first_cp is null then
    first_cp := s.rota_start;
    select coalesce(array_agg(pr.id order by pr.rota_order, pr.created_at, pr.id), '{}'),
           coalesce(array_agg(pr.display_name order by pr.rota_order, pr.created_at, pr.id), '{}')
      into ids, names from public.profiles pr where pr.active and pr.approved;
    n := coalesce(array_length(ids, 1), 0);
  end if;

  d := first_cp;
  while d <= p_to loop
    select * into cp from public.rota_checkpoints where effective_date = d;
    if found then
      select coalesce(array_agg(x.id order by x.ord), '{}'), coalesce(array_agg(pr.display_name order by x.ord), '{}')
        into ids, names
        from unnest(cp.member_order) with ordinality as x(id, ord)
        join public.profiles pr on pr.id = x.id;
      n := coalesce(array_length(ids, 1), 0);
      ptr := greatest(coalesce(array_position(ids, cp.next_primary), 1) - 1, 0);
    end if;

    if extract(isodow from d) < 6 and not exists (select 1 from public.holidays h where h.date = d) then
      k := 0;
      first_pos := -1;
      for i in 0 .. n - 1 loop
        p := (ptr + i) % n;
        continue when exists (select 1 from public.leaves l
                              where l.user_id = ids[p + 1] and d between l.start_date and l.end_date);
        if first_pos < 0 then first_pos := p; end if;
        if d >= p_from then
          day := d; pos := k; role := case when k = 0 then 'Primary' else 'Secondary ' || k end;
          user_id := ids[p + 1]; name := names[p + 1];
          return next;
        end if;
        k := k + 1;
      end loop;
      if first_pos >= 0 then ptr := (first_pos + 1) % n; end if;
    end if;
    d := d + 1;
  end loop;
end;
$$;
revoke execute on function public.roster_rows(date, date) from public, anon, authenticated;

-- ---------- The calendar file ----------

-- Calendar apps don't ask for a particular file type, so the feed returns the API's catch-all "*/*"
-- type and sets its own Content-Type: text/calendar header. Safe to run this file again.
do $$ begin
  create domain "*/*" as bytea;
exception when duplicate_object then null;
end $$;
drop function if exists public.duty_calendar(uuid);
drop domain if exists "text/calendar";

-- Text escaping for calendar files.
create or replace function public.ics_text(t text)
returns text
language sql immutable
as $$ select replace(replace(replace(replace(coalesce(t, ''), '\', '\\'), ';', '\;'), ',', '\,'), E'\n', '\n') $$;

-- The calendar for the person whose secret link this is: their duty days from 30 days ago to
-- 120 days ahead, each an all-day event with everyone's roles that day in the notes.
create or replace function public.duty_calendar(token uuid)
returns "*/*"
language plpgsql stable security definer set search_path = public
as $$
declare
  me    public.profiles%rowtype;
  today date := public.sg_today();
  ics   text;
  r     record;
begin
  ics := E'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Duty Roster//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n'
      || E'X-WR-CALNAME:My duties\r\nX-WR-TIMEZONE:Asia/Singapore\r\nREFRESH-INTERVAL;VALUE=DURATION:PT3H\r\nX-PUBLISHED-TTL:PT3H\r\n';
  select * into me from public.profiles where calendar_token = token and approved;
  if found then
    for r in
      with rr as (select * from public.roster_rows(today - 30, today + 120))
      select mine.day, mine.role,
             (select string_agg(o.role || ': ' || o.name, E'\n' order by o.pos) from rr o where o.day = mine.day) as everyone
        from rr mine where mine.user_id = me.id order by mine.day
    loop
      ics := ics || E'BEGIN:VEVENT\r\n'
        || 'UID:duty-' || to_char(r.day, 'YYYYMMDD') || '-' || me.id || E'@duty-roster\r\n'
        || 'DTSTAMP:' || to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
        || 'DTSTART;VALUE=DATE:' || to_char(r.day, 'YYYYMMDD') || E'\r\n'
        || 'DTEND;VALUE=DATE:' || to_char(r.day + 1, 'YYYYMMDD') || E'\r\n'
        || 'SUMMARY:' || public.ics_text('Duty: ' || r.role) || E'\r\n'
        || 'DESCRIPTION:' || public.ics_text(r.everyone) || E'\r\n'
        || E'TRANSP:TRANSPARENT\r\n'
        || E'BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:' || public.ics_text('Duty today: ' || r.role) || E'\r\nTRIGGER:PT8H\r\nEND:VALARM\r\n'
        || E'END:VEVENT\r\n';
    end loop;
  end if;
  perform set_config('response.headers',
    json_build_array(json_build_object('Content-Type', 'text/calendar; charset=utf-8'),
                     json_build_object('Content-Disposition', 'inline; filename="duties.ics"'),
                     json_build_object('Cache-Control', 'max-age=900'))::text, true);
  return convert_to(ics || E'END:VCALENDAR\r\n', 'UTF8');
end;
$$;
revoke execute on function public.duty_calendar(uuid) from public;
grant execute on function public.duty_calendar(uuid) to anon, authenticated;
