#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root on the ECS' >&2; exit 1; }
[[ ${1:-} == --apply ]] || { echo 'Usage: migrate-local-postgres.sh --apply' >&2; exit 1; }
[[ -f /etc/dongxin/db-migrator.env ]] || { echo 'Migration credentials are missing' >&2; exit 1; }
[[ $(stat -c %a /etc/dongxin/db-migrator.env) == 600 ]] || { echo 'Migration credential permissions must be 0600' >&2; exit 1; }
systemctl is-active --quiet postgresql-17 || { echo 'PostgreSQL 17 is not running' >&2; exit 1; }
cd /opt/dongxin/current
set -a
# shellcheck source=/dev/null
source /etc/dongxin/db-migrator.env
set +a
/opt/dongxin/node/bin/node --import tsx apps/api/src/cli/migrate.ts --apply
