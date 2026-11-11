#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root on the ECS' >&2; exit 1; }
systemctl is-active --quiet postgresql-17 || { echo 'PostgreSQL 17 is not running' >&2; exit 1; }
install -d -m 0700 /var/backups/dongxin
backup=$(mktemp "/var/backups/dongxin/postgres-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX.dump")
trap '[[ -n ${backup:-} && -f $backup ]] && rm -- "$backup"' ERR
runuser -u postgres -- /usr/pgsql-17/bin/pg_dump -Fc -d dongxin > "$backup"
[[ -s $backup ]] || { echo 'Database backup is empty' >&2; exit 1; }
/usr/pgsql-17/bin/pg_restore --list "$backup" > /dev/null
sha256sum "$backup"
trap - ERR
