#!/bin/bash
DIR=${PGDIR:-${TMPDIR:-/tmp}/duty-roster-pg}
unshare --user --map-user=1000 --map-group=1000 /usr/lib/postgresql/16/bin/pg_ctl -D "$DIR/data" stop
