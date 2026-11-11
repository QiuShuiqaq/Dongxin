#!/usr/bin/env bash
# Invoked by update-operations.ps1 after SCP. Does not change Nginx, keys or business configuration.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run with sudo' >&2; exit 1; }
version=${1:?Usage: prepare-release.sh VERSION SHA256 prepare|activate}
expected_hash=${2:?SHA256 required}
mode=${3:?Mode required}
[[ $version =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$ ]] || { echo 'Invalid version' >&2; exit 1; }
[[ $expected_hash =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid SHA256' >&2; exit 1; }
[[ $mode == prepare || $mode == activate ]] || { echo 'Invalid mode' >&2; exit 1; }
base=/opt/dongxin
target="$base/releases/$version"
incoming=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
archive="$incoming/dongxin-operations-$version.tgz"
[[ -L $base/current && -f /etc/dongxin/api.env && -x $base/node/bin/node ]] || { echo 'Complete initial installation first' >&2; exit 1; }
[[ -f $archive && ! -L $archive ]] || { echo 'Archive missing or symlinked' >&2; exit 1; }
actual_hash=$(sha256sum "$archive")
[[ ${actual_hash%% *} == "$expected_hash" ]] || { echo 'Uploaded archive SHA256 mismatch' >&2; exit 1; }
exec 8>/run/lock/dongxin-prepare.lock
flock -n 8 || { echo 'Another release preparation is running' >&2; exit 1; }
if [[ -e $target || -L $target ]]; then
    [[ -d $target && ! -L $target && $(readlink -f "$target") == "$target" && -f $target/.release-archive.sha256 ]] || {
        echo 'Existing release is not a verified prepared release; refusing to overwrite it' >&2; exit 1;
    }
    [[ $(<"$target/.release-archive.sha256") == "$expected_hash" ]] || {
        echo 'Version already exists with a different archive; create a new release' >&2; exit 1;
    }
    echo "Reusing verified prepared release: $version"
else
    install -d -o ecs-assist-user -g ecs-assist-user -m 0755 "$target"
    sudo -u ecs-assist-user tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$target"
    "$base/node/bin/node" --input-type=module - "$target" "$version" <<'NODE'
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const [directory, version] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'));
if (manifest.version !== version || manifest.nodeMajor !== Number(process.versions.node.split('.')[0]) || manifest.dataFormatVersion !== 1) {
  throw new Error('Unsupported release manifest or Node version; review the migration plan');
}
for (const file of ['package-lock.json', 'apps/api/src/index.ts', 'apps/mqtt-broker/src/index.ts', 'apps/operations-console/dist/index.html', 'deploy/activate-release.sh']) {
  if (!statSync(join(directory, file)).isFile()) throw new Error(`Release file missing: ${file}`);
}
NODE
    (
        cd "$target"
        sudo -u ecs-assist-user env PATH="$base/node/bin:/usr/local/bin:/usr/bin:/bin" npm ci --prefer-offline --omit=dev --workspace @dongxin/api --workspace @dongxin/mqtt-broker --workspace @dongxin/shared --include-workspace-root=false --no-audit --no-fund
    )
    [[ -d $target/node_modules/tsx ]] || { echo 'Runtime dependencies incomplete' >&2; exit 1; }
    bash -n "$target/deploy/activate-release.sh"
    chown -R root:root "$target"
    chmod -R a+rX "$target"
    printf '%s\n' "$expected_hash" > "$target/.release-archive.sha256"
    chmod 0644 "$target/.release-archive.sha256"
    echo "Prepared release: $version; active service unchanged"
fi
if [[ $mode == prepare ]]; then
    echo "Activate later: sudo bash $target/deploy/activate-release.sh $version"
    exit 0
fi
bash "$target/deploy/activate-release.sh" "$version"
curl --fail --silent --max-time 10 http://127.0.0.1:8080/api/health |
    "$base/node/bin/node" -e 'let b=""; process.stdin.on("data", c => b+=c); process.stdin.on("end", () => { try { if (JSON.parse(b).ok !== true) process.exit(1); } catch { process.exit(1); } });'
echo 'Nginx/API health check passed. Verify staff login and the required pages.'
