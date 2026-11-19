#!/bin/bash
# Recreates database <name> and loads the supabase/ files in the README's setup order, on top of
# supabase-stub.sql, then any extra files given (e.g. a draft 012):
#   docs/round2/localdb/load.sh roster                       # as a new install has today
#   docs/round2/localdb/load.sh fixed path/to/012.sql        # plus the migration being tested
# sg_today() is replaced by a version that reads the setting test.today when set (same body otherwise),
# so tests can pin the date:  set test.today = '2026-11-18';
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../.." && pwd)
PORT=${PGPORT:-54330}; DB=${1:?database name}; shift
PSQL="psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d postgres -tAc "select 1 from pg_roles where rolname = 'anon'" | grep -q 1 ||
  $PSQL -d postgres -c "create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls;"
sed '/^create role/d' "$HERE/supabase-stub.sql" | $PSQL -d "$DB"
for f in schema.sql 003_private_data.sql 004_stable_history.sql 006_hardening.sql 011_leave_invites.sql; do
  $PSQL -d "$DB" -f "$REPO/supabase/$f"
done
$PSQL -d "$DB" -c "create or replace function public.sg_today() returns date language sql stable as \$\$ select coalesce(nullif(current_setting('test.today', true), '')::date, (now() at time zone 'Asia/Singapore')::date) \$\$"
for extra in "$@"; do $PSQL -d "$DB" -f "$extra"; done
echo "loaded $DB"
