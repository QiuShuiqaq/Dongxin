#!/usr/bin/env bash
# Run with sudo. Installs neither packages nor configuration; switches prepared releases only.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run with sudo' >&2; exit 1; }
version=${1:?Usage: activate-release.sh VERSION}
[[ $version =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$ ]] || { echo 'Invalid version' >&2; exit 1; }
base=/opt/dongxin
target="$base/releases/$version"
[[ -d $target && ! -L $target && $(readlink -f "$target") == "$target" ]] || { echo 'Invalid release directory' >&2; exit 1; }
[[ -f $target/release.json && -f $target/apps/operations-console/dist/index.html && -f /etc/dongxin/api.env ]] || { echo 'Release or configuration incomplete' >&2; exit 1; }
[[ -x $base/node/bin/node && -d $target/node_modules/tsx ]] || { echo 'Install Node and release runtime dependencies first' >&2; exit 1; }
exec 9>/run/lock/dongxin-release.lock
flock -n 9 || { echo 'Another release is running' >&2; exit 1; }
previous=''
if [[ -L $base/current ]]; then
    previous=$(readlink -f "$base/current")
elif [[ -e $base/current ]]; then
    echo 'current must be a symlink, not a directory' >&2; exit 1
fi
[[ $previous != "$target" ]] || { echo 'This release is already active'; exit 0; }
if [[ -n $previous ]]; then
    [[ $previous == "$base/releases/"* && -f $previous/release.json ]] || { echo 'Invalid current release' >&2; exit 1; }
    "$base/node/bin/node" --input-type=module - "$previous/release.json" "$target/release.json" <<'NODE'
import { readFileSync } from 'node:fs';
const [oldVersion, nextVersion] = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
if (oldVersion.dataFormatVersion !== nextVersion.dataFormatVersion) {
  throw new Error('Data format changed: use a reviewed migration and recovery plan before switching');
}
NODE
fi

switch_link() {
    local destination=$1 name=$2
    ln -s "$destination" "$base/.$name.$$"
    mv -Tf "$base/.$name.$$" "$base/$name"
}
recover() {
    trap - ERR
    systemctl stop dongxin-api || true
    if [[ -n $previous ]]; then
        switch_link "$previous" current
        systemctl start dongxin-api || true
        echo "Code restored to $previous; inspect health and logs before retrying" >&2
    elif [[ -L $base/current ]]; then
        unlink "$base/current"
    fi
    echo 'Deployment failed. Persistent data was not restored automatically; inspect the pre-release backup.' >&2
    exit 1
}
trap recover ERR
systemctl stop dongxin-api
# Stop first: JSON files and API-key writes must not change during the backup.
install -d -m 0700 /var/backups/dongxin
backup=$(mktemp "/var/backups/dongxin/$(date -u +%Y%m%dT%H%M%SZ)-pre-$version.XXXXXX.tgz")
tar -czf "$backup" -C / etc/dongxin var/lib/dongxin
switch_link "$target" current
systemctl start dongxin-api
ready=false
for ((attempt=0; attempt<20; attempt++)); do
    if curl --silent --fail --max-time 2 http://127.0.0.1:3077/api/health |
        "$base/node/bin/node" -e 'let b=""; process.stdin.on("data", c => b+=c); process.stdin.on("end", () => { try { if (JSON.parse(b).ok !== true) process.exit(1); } catch { process.exit(1); } });'; then
        ready=true
        break
    fi
    sleep 1
done
if [[ $ready != true ]]; then echo 'Health check failed' >&2; false; fi
if [[ -n $previous ]]; then switch_link "$previous" previous; fi
trap - ERR
echo "Active release: $version"
echo "Pre-release backup: $backup (contains secrets; copy off-server securely)"
