-- Duty Roster update 4: stable history (fixes GitHub issue #7).
-- Run once in Supabase > SQL Editor, after 003_private_data.sql.
--
-- Before: every day was recalculated from the rotation start with today's team, so approving,
-- deactivating or reordering someone, or changing past leave, rewrote past duties.
-- Now: each change to the rotation saves a checkpoint dated today. Days before it keep the
-- rotation they had. Non-admins can only add or change leave from today onwards.

-- Today's date in Singapore, used for every "from today" rule.
create or replace function public.sg_today()
returns date
language sql stable
as $$ select (now() at time zone 'Asia/Singapore')::date $$;

-- ---------- Rotation checkpoints ----------

-- From effective_date the rotation is member_order (profile ids, in order) and the next working day
-- starts with next_primary. The app saves one whenever the team or its order changes.
create table if not exists public.rota_checkpoints (
  effective_date date primary key,
  member_order   uuid[] not null,
  next_primary   uuid,
  created_at     timestamptz not null default now()
);
alter table public.rota_checkpoints enable row level security;

drop policy if exists "members read checkpoints" on public.rota_checkpoints;
create policy "members read checkpoints" on public.rota_checkpoints for select to authenticated using (public.is_member());
drop policy if exists "admins add checkpoints" on public.rota_checkpoints;
create policy "admins add checkpoints" on public.rota_checkpoints for insert to authenticated with check (public.is_admin());
drop policy if exists "admins change checkpoints" on public.rota_checkpoints;
create policy "admins change checkpoints" on public.rota_checkpoints for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete checkpoints" on public.rota_checkpoints;
create policy "admins delete checkpoints" on public.rota_checkpoints for delete to authenticated using (public.is_admin());

-- Start from today's rotation, so every day shown now stays exactly as it is.
insert into public.rota_checkpoints (effective_date, member_order, next_primary)
select s.rota_start,
       coalesce(array_agg(p.id order by p.rota_order, p.created_at, p.id) filter (where p.id is not null), '{}'),
       (array_agg(p.id order by p.rota_order, p.created_at, p.id) filter (where p.id is not null))[1]
from public.settings s
left join public.profiles p on p.active and p.approved
where s.id = 1
group by s.rota_start
on conflict (effective_date) do nothing;

-- ---------- Leave can't be backdated by non-admins ----------

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
  return coalesce(new, old);
end;
$$;
drop trigger if exists enforce_leave_rules on public.leaves;
create trigger enforce_leave_rules
  before insert or update or delete on public.leaves
  for each row execute function public.enforce_leave_rules();

-- ---------- Public calendar follows the checkpoints ----------

create or replace function public.public_calendar(p_from date, p_to date)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  s         public.settings%rowtype;
  cp        public.rota_checkpoints%rowtype;
  first_cp  date;
  ids       uuid[] := '{}';
  names     text[] := '{}';
  people    text[];
  n         int := 0;
  ptr       int := 0;
  d         date;
  win_from  date;
  win_to    date;
  hol       text;
  duties    json[];
  first_pos int;
  pos       int;
  days      json[] := '{}';
begin
  select * into s from public.settings where id = 1;
  if not found or not s.public_calendar then return null; end if;

  win_from := greatest(p_from, public.sg_today() - 90);
  win_to   := least(p_to, public.sg_today() + 180, win_from + 62);

  -- Names for the Highlight list: today's rotation.
  select coalesce(array_agg(p.display_name order by p.rota_order, p.created_at, p.id), '{}') into people
    from public.profiles p where p.active and p.approved;

  select min(effective_date) into first_cp from public.rota_checkpoints;
  if first_cp is null then
    -- No checkpoints yet: today's rotation from the rotation start.
    first_cp := s.rota_start;
    select coalesce(array_agg(p.id order by p.rota_order, p.created_at, p.id), '{}'),
           coalesce(array_agg(p.display_name order by p.rota_order, p.created_at, p.id), '{}')
      into ids, names from public.profiles p where p.active and p.approved;
    n := coalesce(array_length(ids, 1), 0);
  end if;

  d := least(first_cp, win_from);
  while d <= win_to loop
    select * into cp from public.rota_checkpoints where effective_date = d;
    if found then
      select coalesce(array_agg(x.id order by x.ord), '{}'), coalesce(array_agg(p.display_name order by x.ord), '{}')
        into ids, names
        from unnest(cp.member_order) with ordinality as x(id, ord)
        join public.profiles p on p.id = x.id;
      n := coalesce(array_length(ids, 1), 0);
      ptr := greatest(coalesce(array_position(ids, cp.next_primary), 1) - 1, 0);
    end if;

    select h.name into hol from public.holidays h where h.date = d;
    if d < first_cp then
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

  return json_build_object('rota_start', first_cp, 'from', win_from, 'to', win_to,
                           'people', to_json(people), 'days', to_json(days));
end;
$$;

revoke execute on function public.public_calendar(date, date) from public;
grant execute on function public.public_calendar(date, date) to anon, authenticated;
