#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root on the ECS' >&2; exit 1; }
backup=${1:?Usage: verify-local-postgres-restore.sh /var/backups/dongxin/postgres-*.dump}
[[ $backup == /var/backups/dongxin/postgres-*.dump && -f $backup && ! -L $backup ]] || {
  echo 'Backup must be a regular PostgreSQL dump inside /var/backups/dongxin' >&2; exit 1;
}
test_db="dongxin_restore_$(date +%s)_$$"
created=false
cleanup() {
  if [[ $created == true ]]; then
    runuser -u postgres -- /usr/pgsql-17/bin/dropdb --if-exists "$test_db"
  fi
}
trap cleanup EXIT
runuser -u postgres -- /usr/pgsql-17/bin/createdb "$test_db"
created=true
runuser -u postgres -- /usr/pgsql-17/bin/pg_restore --exit-on-error -d "$test_db" < "$backup"
result=$(runuser -u postgres -- /usr/pgsql-17/bin/psql -X -A -t -d "$test_db" <<'SQL'
SELECT count(*) FROM dongxin.schema_migrations;
SQL
)
[[ $result == 3 ]] || { echo 'Restored migration catalog is incomplete' >&2; exit 1; }
echo 'Isolated restore succeeded: three migration records present; temporary database will be removed.'
