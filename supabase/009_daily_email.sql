-- Duty Roster update 9: daily 9am email of the 2FA Login summary.
-- Run once in Supabase > SQL Editor, after 006_hardening.sql (and 008 if you had calendar sync). Safe to run again.
--
-- Anyone can ask for the email from the public calendar page. An admin approves each address in
-- Team & settings before anything is sent to it. At 9am Singapore time on working days, every
-- approved address gets that day's roles, with a link to unsubscribe.
--
-- Emails go out through Resend (resend.com). Before emails can send, add your Resend API key and
-- the sender address, as shown at the end of this file.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- Subscriptions ----------

create table if not exists public.email_subscriptions (
  id               bigint generated always as identity primary key,
  email            text not null unique check (email = lower(email) and char_length(email) <= 254),
  approved         boolean not null default false,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  created_at       timestamptz not null default now()
);
alter table public.email_subscriptions enable row level security;

-- Admins see and manage subscriptions. Nobody else reads them, so addresses stay private.
revoke all on public.email_subscriptions from anon, authenticated;
grant select (id, email, approved, created_at), update (approved), delete on public.email_subscriptions to authenticated;
drop policy if exists "admins read subscriptions" on public.email_subscriptions;
create policy "admins read subscriptions" on public.email_subscriptions for select to authenticated using (public.is_admin());
drop policy if exists "admins approve subscriptions" on public.email_subscriptions;
create policy "admins approve subscriptions" on public.email_subscriptions for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins remove subscriptions" on public.email_subscriptions;
create policy "admins remove subscriptions" on public.email_subscriptions for delete to authenticated using (public.is_admin());

-- Ask for the daily email. Works without signing in, only while the public calendar is on.
-- It never says whether an address was already there, so it can't be used to look addresses up.
create or replace function public.request_email_subscription(p_email text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare e text := lower(trim(p_email));
begin
  if not coalesce((select public_calendar from public.settings where id = 1), false) then
    raise exception 'Email requests are switched off.';
  end if;
  if e is null or char_length(e) > 254 or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.';
  end if;
  -- A limit on waiting requests, so nobody can flood the admins' list.
  if (select count(*) from public.email_subscriptions where not approved) >= 50 then
    raise exception 'There are too many requests waiting for approval. Please try again later.';
  end if;
  insert into public.email_subscriptions (email) values (e) on conflict (email) do nothing;
end;
$$;
revoke execute on function public.request_email_subscription(text) from public;
grant execute on function public.request_email_subscription(text) to anon, authenticated;

-- The unsubscribe link in every email calls this.
create or replace function public.unsubscribe_email(p_token uuid)
returns boolean
language sql volatile security definer set search_path = public
as $$
  with gone as (delete from public.email_subscriptions where unsubscribe_token = p_token returning 1)
  select exists (select 1 from gone)
$$;
revoke execute on function public.unsubscribe_email(uuid) from public;
grant execute on function public.unsubscribe_email(uuid) to anon, authenticated;

-- ---------- The day's roles ----------

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

-- ---------- Sending ----------

-- Where emails come from and where the links point. Fill in with the statements at the end of this file.
create table if not exists public.email_config (
  id        integer primary key default 1 check (id = 1),
  from_addr text not null,
  site_url  text not null
);
alter table public.email_config enable row level security;
revoke all on public.email_config from anon, authenticated;

create or replace function public.html_text(t text)
returns text
language sql immutable
as $$ select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $$;

-- Sends today's summary to every approved address. Does nothing on weekends, public holidays,
-- before the rotation starts, or when there are no approved addresses. Runs at 9am from pg_cron.
create or replace function public.send_daily_email()
returns int
language plpgsql volatile security definer set search_path = public
as $$
declare
  today   date := public.sg_today();
  cfg     public.email_config%rowtype;
  api_key text;
  when_s  text := trim(to_char(today, 'Dy')) || ', ' || extract(day from today) || ' ' || trim(to_char(today, 'Mon'));
  lines   text;
  rows_h  text;
  primary_name text;
  batch   jsonb := '[]';
  sent    int := 0;
  s       record;
  unsub   text;
begin
  select * into cfg from public.email_config where id = 1;
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  if cfg.from_addr is null or api_key is null then
    raise notice 'Daily email not set up yet: add the Resend API key and email_config row.';
    return 0;
  end if;

  select string_agg(r.role || ': ' || r.name, E'\n' order by r.pos),
         string_agg('<tr><td style="padding:4px 16px 4px 0;color:#5b6775">' || html_text(r.role) || '</td><td style="padding:4px 0'
                    || case when r.pos = 0 then ';font-weight:700' else '' end || '">' || html_text(r.name) || '</td></tr>', '' order by r.pos),
         min(r.name) filter (where r.pos = 0)
    into lines, rows_h, primary_name
    from public.roster_rows(today, today) r;
  if lines is null then
    return 0;  -- not a working day, or nobody on duty
  end if;

  for s in select email, unsubscribe_token from public.email_subscriptions where approved order by id loop
    unsub := cfg.site_url || 'calendar.html?unsubscribe=' || s.unsubscribe_token;
    batch := batch || jsonb_build_object(
      'from', cfg.from_addr,
      'to', jsonb_build_array(s.email),
      'subject', '2FA Login · ' || when_s || ' · Primary: ' || primary_name,
      'text', '2FA Login · ' || when_s || E'\n' || lines || E'\n\nHi ' || primary_name || ' (Primary), may we have OTP login for ...'
              || E'\n\nCalendar: ' || cfg.site_url || 'calendar.html' || E'\nUnsubscribe: ' || unsub,
      'html', '<div style="font-family:system-ui,sans-serif;font-size:15px;color:#18212b">'
              || '<h2 style="font-size:18px;margin:0 0 12px">2FA Login · ' || html_text(when_s) || '</h2>'
              || '<table style="border-collapse:collapse">' || rows_h || '</table>'
              || '<p>Hi ' || html_text(primary_name) || ' (Primary), may we have OTP login for ...</p>'
              || '<p><a href="' || html_text(cfg.site_url) || 'calendar.html">Open the calendar</a></p>'
              || '<p style="font-size:12px;color:#5b6775">You asked for this daily email. <a href="' || html_text(unsub) || '">Unsubscribe</a></p></div>',
      'headers', jsonb_build_object('List-Unsubscribe', '<' || unsub || '>'));
    sent := sent + 1;
    -- Resend takes up to 100 emails per request.
    if jsonb_array_length(batch) = 100 then
      perform net.http_post(url := 'https://api.resend.com/emails/batch', body := batch,
        headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'));
      batch := '[]';
    end if;
  end loop;
  if jsonb_array_length(batch) > 0 then
    perform net.http_post(url := 'https://api.resend.com/emails/batch', body := batch,
      headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'));
  end if;
  return sent;
end;
$$;
revoke execute on function public.send_daily_email() from public, anon, authenticated;

-- 9am Singapore time is 01:00 UTC.
select cron.schedule('daily-2fa-login-email', '0 1 * * *', 'select public.send_daily_email()');

-- ---------- Your details (edit, then run these lines once) ----------
-- 1. Resend > API Keys > Create API key, then paste it here:
--      select vault.create_secret('re_your_key_here', 'resend_api_key');
--    (To change it later: select vault.update_secret(id, 're_new_key') from vault.secrets where name = 'resend_api_key';)
-- 2. The sender, on a domain verified in Resend > Domains, and the address of the app (ending in /):
--      insert into public.email_config (from_addr, site_url)
--      values ('2FA Login <roster@your-domain.com>', 'https://hermannwwr-cmyk.github.io/duty-roster/')
--      on conflict (id) do update set from_addr = excluded.from_addr, site_url = excluded.site_url;
-- 3. Send one now to check it works (approve your own address first):
--      select public.send_daily_email();
