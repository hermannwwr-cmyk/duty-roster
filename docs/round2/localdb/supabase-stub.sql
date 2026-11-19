-- A minimal stand-in for what a Supabase project provides before the app's migrations run, so the
-- real files in supabase/ can be loaded into a plain local Postgres 16 and tested. Roles are
-- cluster-wide, so load.sh creates them once and skips the "create role" lines here.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
-- auth.uid() as Supabase defines it: PostgREST puts the JWT's sub in request.jwt.claim.sub (older)
-- or request.jwt.claims (newer).
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Older Supabase projects grant everything in public to the API roles and let RLS decide. Projects
-- created after Supabase's 2026-05-30 change don't; run the grants query in PLAN.md on the live
-- project to know which applies, and drop these three lines to test the other case.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
