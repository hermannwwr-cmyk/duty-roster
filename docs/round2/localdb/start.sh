#!/bin/bash
# Starts a throwaway Postgres 16 for testing the supabase/ files (initialising it the first time).
#   docs/round2/localdb/start.sh            # data in ${TMPDIR:-/tmp}/duty-roster-pg, port 54330
#   PGPORT=54331 PGDIR=/some/folder docs/round2/localdb/start.sh
# Postgres refuses to run as root, so it runs in a user namespace where root appears as uid 1000;
# nothing outside the data folder needs new permissions. Stop it with stop.sh.
set -euo pipefail
BIN=/usr/lib/postgresql/16/bin
DIR=${PGDIR:-${TMPDIR:-/tmp}/duty-roster-pg}; PORT=${PGPORT:-54330}
NS="unshare --user --map-user=1000 --map-group=1000"
mkdir -p "$DIR"
[ -d "$DIR/data" ] || $NS $BIN/initdb -D "$DIR/data" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
$NS $BIN/pg_ctl -D "$DIR/data" -l "$DIR/server.log" -w \
  -o "-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -c timezone=UTC" start
echo "Postgres on 127.0.0.1:$PORT (data in $DIR)"
