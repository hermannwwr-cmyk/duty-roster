-- Duty Roster update 8: remove phone calendar sync.
-- Run once in Supabase > SQL Editor if you ran 005_calendar_feed.sql or 007_public_feed.sql before.
-- New installs don't need it. Safe to run again.
--
-- Calendar apps subscribed to these links stop receiving duties. Their already-synced events stay
-- in the calendar until the person removes the subscription.

drop function if exists public.public_duty_calendar(text);
drop function if exists public.duty_calendar(uuid);
drop function if exists public.my_calendar_token();
drop function if exists public.reset_calendar_token();
drop function if exists public.roster_rows(date, date);
drop function if exists public.ics_text(text);
drop domain if exists "*/*";
alter table public.profiles drop column if exists calendar_token;
