-- Duty Roster update 2: public calendar for people without an account.
-- Run once in Supabase > SQL Editor on a database that already has schema.sql.

-- Admins can switch the public calendar off in Team & settings.
alter table public.settings add column if not exists public_calendar boolean not null default true;

-- Everything the public calendar needs, and nothing more: names and order of active members,
-- leave dates (no notes), holidays and the rotation start. No emails, no admin flags.
-- Returns null when the public calendar is switched off.
create or replace function public.public_roster()
returns json
language sql stable security definer set search_path = public
as $$
  select case when s.public_calendar then json_build_object(
    'members', coalesce((
      select json_agg(json_build_object('id', p.id, 'display_name', p.display_name, 'rota_order', p.rota_order) order by p.rota_order)
      from public.profiles p where p.active), '[]'::json),
    'leaves', coalesce((
      select json_agg(json_build_object('user_id', l.user_id, 'start_date', l.start_date, 'end_date', l.end_date))
      from public.leaves l join public.profiles p on p.id = l.user_id where p.active), '[]'::json),
    'holidays', coalesce((
      select json_agg(json_build_object('date', h.date, 'name', h.name) order by h.date) from public.holidays h), '[]'::json),
    'rota_start', s.rota_start
  ) end
  from public.settings s where s.id = 1
$$;

revoke all on function public.public_roster() from public;
grant execute on function public.public_roster() to anon, authenticated;
