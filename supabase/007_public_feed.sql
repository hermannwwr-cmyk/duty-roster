-- Duty Roster update 7: phone calendar subscription without an account.
-- Run once in Supabase > SQL Editor, after 006_hardening.sql. Safe to run again.
--
-- The public calendar page offers a link that calendar apps (Google Calendar, Apple Calendar,
-- Samsung Calendar, Outlook) can subscribe to, for one person's duties or everyone's. It shares
-- only what the public calendar already shows: names and roles. When an admin switches the public
-- calendar off, these links return an empty calendar.

-- The calendar for `person` (a name as shown on the public calendar), or for everyone when no name
-- is given: duty days from 30 days ago to 120 days ahead, each an all-day event.
create or replace function public.public_duty_calendar(person text default null)
returns "*/*"
language plpgsql stable security definer set search_path = public
as $$
declare
  today date := public.sg_today();
  who   text := nullif(trim(person), '');
  ics   text;
  r     record;
begin
  ics := E'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Duty Roster//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n'
      || 'X-WR-CALNAME:' || public.ics_text(coalesce('Duties: ' || who, 'Duty roster')) || E'\r\n'
      || E'X-WR-TIMEZONE:Asia/Singapore\r\nREFRESH-INTERVAL;VALUE=DURATION:PT3H\r\nX-PUBLISHED-TTL:PT3H\r\n';
  if (select public_calendar from public.settings where id = 1) then
    for r in
      with rr as (select * from public.roster_rows(today - 30, today + 120)),
      days as (
        select rr.day,
               string_agg(rr.role || ': ' || rr.name, E'\n' order by rr.pos) as everyone,
               string_agg(case when rr.pos = 0 then 'P' else 'S' || rr.pos end || ' ' || rr.name, ', ' order by rr.pos) as short,
               min(rr.role) filter (where rr.name = who) as role
          from rr group by rr.day
      )
      select * from days where who is null or role is not null order by day
    loop
      ics := ics || E'BEGIN:VEVENT\r\n'
        || 'UID:duty-' || to_char(r.day, 'YYYYMMDD') || '-' || coalesce(md5(who), 'all') || E'@duty-roster-public\r\n'
        || 'DTSTAMP:' || to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
        || 'DTSTART;VALUE=DATE:' || to_char(r.day, 'YYYYMMDD') || E'\r\n'
        || 'DTEND;VALUE=DATE:' || to_char(r.day + 1, 'YYYYMMDD') || E'\r\n'
        || 'SUMMARY:' || public.ics_text(case when who is null then 'Duty: ' || r.short else 'Duty: ' || r.role end) || E'\r\n'
        || 'DESCRIPTION:' || public.ics_text(r.everyone) || E'\r\n'
        || E'TRANSP:TRANSPARENT\r\n'
        -- Only a personal calendar reminds you, at 8am on the day.
        || case when who is null then '' else
             E'BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:' || public.ics_text('Duty today: ' || r.role) || E'\r\nTRIGGER:PT8H\r\nEND:VALARM\r\n' end
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
revoke execute on function public.public_duty_calendar(text) from public;
grant execute on function public.public_duty_calendar(text) to anon, authenticated;
