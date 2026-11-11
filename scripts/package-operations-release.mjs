import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit allowlist: no .env, local data, hardware agent, firmware or node_modules.
const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm run deploy:package');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
};
const git = (args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Git metadata is required for a traceable release');
  return result.stdout.trim();
};
const commit = git(['rev-parse', 'HEAD']);
const dirty = Boolean(git(['status', '--porcelain']));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const version = `${stamp}-${commit.slice(0, 8)}${dirty ? '-dirty' : ''}`;
const output = join(root, '.artifacts', 'releases');
const staging = join(output, version);
await mkdir(output, { recursive: true });
await mkdir(staging); // Never overwrite an existing release.

run(process.execPath, [npmCli, 'run', 'typecheck', '-w', '@dongxin/api', '-w', '@dongxin/mqtt-broker', '-w', '@dongxin/operations-console']);
run(process.execPath, [npmCli, 'run', 'build', '-w', '@dongxin/operations-console'], {
  env: { ...process.env, VITE_API_BASE_URL: '' },
});
async function copy(relativePath, filter) {
  const target = join(staging, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, relativePath), target, { recursive: true, filter });
}
for (const file of ['package.json', 'package-lock.json', 'apps/api/tsconfig.json',
  'scripts/hash-operations-password.mjs']) await copy(file);
// npm ci resolves workspace manifests from the original lockfile, even when only API is selected.
for (const parent of ['apps', 'packages']) {
  for (const entry of await readdir(join(root, parent), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = join(parent, entry.name, 'package.json');
    try { await readFile(join(root, manifest)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await copy(manifest);
  }
}
const withoutTests = (source) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(source);
await copy('apps/api/src', withoutTests);
await copy('apps/api/migrations');
await copy('apps/mqtt-broker/src', withoutTests);
await copy('packages/shared/src', withoutTests);
await copy('apps/operations-console/dist');
// API uses this fixed acknowledgment PCM; no firmware build or hardware code is shipped.
await copy('firmware/main/assets/wake_ack_16k_mono.pcm');
await copy('deploy');
await writeFile(join(staging, 'release.json'), JSON.stringify({
  version, gitCommit: commit, dirty, createdAt: new Date().toISOString(),
  purpose: 'single-instance-hardware-pilot', dataFormatVersion: 1,
  nodeMajor: 24, builderNode: process.version,
}, null, 2) + '\n');
const archive = resolve(output, `dongxin-operations-${version}.tgz`);
run('tar', ['-czf', archive, '-C', staging, '.']);
const checksum = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${checksum}  ${archive.split(/[\\/]/).pop()}\n`);
console.log(JSON.stringify({ version, archive, sha256: checksum, dirty }, null, 2));
