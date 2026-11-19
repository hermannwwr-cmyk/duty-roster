-- Checks the Round 2 invite fixes (items 1-4) on a local database loaded with a draft 012:
--   PGPORT=54330 docs/round2/localdb/load.sh fixed docs/round2/draft-012.sql.txt
--   psql -h 127.0.0.1 -p 54330 -U postgres -d fixed -v ON_ERROR_STOP=1 -f docs/round2/localdb/sync-cases.sql
-- Each sync runs as the anon role (as the Google script does) with the real secret, and sends the complete
-- list of current invites (missing ones count as cancelled). It stops at the first failed check; on the
-- database as it is today (no 012) the item 1-4 checks fail, which shows they test something.
\set ON_ERROR_STOP 1
\set QUIET 1
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'ben@example.com');
update public.profiles set approved = true;
select script_secret as secret from public.invite_config where id = 1 \gset

-- Item 1: Ben's leave Mon 16 - Fri 20; on Wed 18 he moves the rest to Wed 25 - Fri 27.
begin; set local test.today = '2026-11-16'; set local role anon;
select public.sync_leave_invites(:'secret', '[{"uid":"u1","organizer":"ben@example.com","start":"2026-11-16","end":"2026-11-20"}]');
commit;
begin; set local test.today = '2026-11-18'; set local role anon;
select public.sync_leave_invites(:'secret', '[{"uid":"u1","organizer":"ben@example.com","start":"2026-11-25","end":"2026-11-27"}]');
commit;
do $$ begin
  if (select string_agg(start_date || '..' || end_date || ':' || coalesce(invite_uid, '-'), ' ' order by start_date) from public.leaves)
     is distinct from '2026-11-16..2026-11-17:- 2026-11-25..2026-11-27:u1'
  then raise exception 'item 1: a moved invite should split (16-17 kept, 25-27 new), got %',
    (select string_agg(start_date || '..' || end_date || ':' || coalesce(invite_uid, '-'), ' ' order by start_date) from public.leaves); end if;
end $$;

-- Item 3: an invite with an impossible date (31 November) is skipped; the valid one beside it still arrives.
begin; set local test.today = '2026-11-18'; set local role anon;
select public.sync_leave_invites(:'secret', '[{"uid":"u1","organizer":"ben@example.com","start":"2026-11-25","end":"2026-11-27"},
  {"uid":"bad","organizer":"ben@example.com","start":"2026-11-31","end":"2026-12-02"},
  {"uid":"u2","organizer":"ben@example.com","start":"2026-12-07","end":"2026-12-08"}]') ->> 'skipped' as skipped \gset
commit;
do $$ begin
  if not exists (select 1 from public.leaves where invite_uid = 'u2') then raise exception 'item 3: a bad invite stopped the batch'; end if;
end $$;
\if :{?skipped}
\else
  \echo 'item 3: the sync should report skipped invites' \quit
\endif

-- Item 2 (database backstop): the same invite id arriving "from" someone else doesn't move the leave.
begin; set local test.today = '2026-11-18'; set local role anon;
select public.sync_leave_invites(:'secret', '[{"uid":"u1","organizer":"ben@example.com","start":"2026-11-25","end":"2026-11-27"},
  {"uid":"u2","organizer":"alice@example.com","start":"2026-12-07","end":"2026-12-08"}]');
commit;
do $$ begin
  if (select p.email from public.leaves l join public.profiles p on p.id = l.user_id where l.invite_uid = 'u2') <> 'ben@example.com'
  then raise exception 'item 2: an invite''s leave moved to a different person'; end if;
end $$;

-- Item 2: a null secret is refused.
do $$ begin
  begin
    perform public.sync_leave_invites(null, '[]');
    raise exception 'item 2: a null secret was accepted';
  exception when raise_exception then
    if sqlerrm like 'item 2:%' then raise; end if;
  end;
end $$;

-- Item 4: invite leave is shortened to at most a year (here from 1 Dec 2026, so to 1 Dec 2027).
begin; set local test.today = '2026-11-18'; set local role anon;
select public.sync_leave_invites(:'secret', '[{"uid":"u1","organizer":"ben@example.com","start":"2026-11-25","end":"2026-11-27"},
  {"uid":"u2","organizer":"ben@example.com","start":"2026-12-07","end":"2026-12-08"},
  {"uid":"long","organizer":"ben@example.com","start":"2026-12-01","end":"2099-12-31"}]');
commit;
do $$ begin
  if (select end_date from public.leaves where invite_uid = 'long') is distinct from date '2027-12-01'
  then raise exception 'item 4: long invite leave should end 2027-12-01, got %', (select end_date from public.leaves where invite_uid = 'long'); end if;
end $$;

\echo 'All Round 2 sync checks passed.'
