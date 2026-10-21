-- Duty Roster update 10: remove the daily email.
-- Run once in Supabase > SQL Editor if you ran 009_daily_email.sql before. New installs don't need it.
-- Safe to run again.
--
-- Deletes every email request and subscription. A Google Apps Script set up for the email stops
-- working; delete it at script.google.com.

do $$ begin
  -- A 9am job left by an early draft of 009, if any.
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'daily-2fa-login-email';
  end if;
end $$;

drop function if exists public.daily_email(uuid, boolean);
drop function if exists public.send_daily_email();
drop function if exists public.request_email_subscription(text);
drop function if exists public.unsubscribe_email(uuid);
drop function if exists public.html_text(text);
drop function if exists public.roster_rows(date, date);
drop table if exists public.email_config;
drop table if exists public.email_subscriptions;
