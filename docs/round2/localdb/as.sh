#!/bin/bash
# Runs SQL as one Supabase user, the way the browser's requests reach the database, inside a
# transaction that is rolled back, so the database is unchanged afterwards:
#   docs/round2/localdb/as.sh <db> anon "select public_calendar(...)"
#   docs/round2/localdb/as.sh <db> <user uuid> "update leaves set ... returning *"
# Create users with:  insert into auth.users (id, email) values ('<uuid>', 'a@example.com');
# (the schema's trigger makes their profile; the first one becomes the admin).
db=${1:?db}; who=${2:?anon or a user uuid}; sql=${3:?sql}
if [ "$who" = anon ]; then role="set local role anon;"
else role="set local role authenticated; set local request.jwt.claims = '{\"sub\":\"$who\",\"role\":\"authenticated\"}';"; fi
psql -h 127.0.0.1 -p "${PGPORT:-54330}" -U postgres -d "$db" -qAt -v ON_ERROR_STOP=1 -c "begin; $role $sql; rollback;"
