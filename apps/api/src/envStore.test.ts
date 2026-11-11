import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { parse } from 'dotenv';
import { clearLocalEnvValue, setLocalEnvValue } from './envStore.js';

test('external configuration survives concurrent saves and is reloaded by a new process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dongxin-env-store-'));
  const previousPath = process.env.DOTENV_CONFIG_PATH;
  const names = ['DX_TEST_KEY_ONE', 'DX_TEST_KEY_TWO'];
  const previousValues = names.map((name) => process.env[name]);
  const envPath = join(directory, 'config', 'api.env');
  process.env.DOTENV_CONFIG_PATH = envPath;
  try {
    await Promise.all([
      setLocalEnvValue(names[0], 'first-test-value'),
      setLocalEnvValue(names[1], 'second-test-value'),
    ]);
    const saved = parse(await readFile(envPath, 'utf8'));
    assert.equal(saved[names[0]], 'first-test-value');
    assert.equal(saved[names[1]], 'second-test-value');
    if (process.platform !== 'win32') assert.equal((await stat(envPath)).mode & 0o777, 0o600);

    const child = spawnSync(process.execPath, ['--import', 'dotenv/config', '--input-type=module', '-e',
      'if (process.env.DX_TEST_KEY_ONE !== "first-test-value" || process.env.DX_TEST_KEY_TWO !== "second-test-value") process.exit(1);'], {
      env: { ...process.env, [names[0]]: '', [names[1]]: '', DOTENV_CONFIG_OVERRIDE: 'true', DOTENV_CONFIG_QUIET: 'true' },
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    await clearLocalEnvValue(names[0]);
    assert.deepEqual(parse(await readFile(envPath, 'utf8')), { [names[1]]: 'second-test-value' });
  } finally {
    if (previousPath === undefined) delete process.env.DOTENV_CONFIG_PATH;
    else process.env.DOTENV_CONFIG_PATH = previousPath;
    names.forEach((name, index) => {
      if (previousValues[index] === undefined) delete process.env[name];
      else process.env[name] = previousValues[index];
    });
    await rm(directory, { recursive: true, force: true });
  }
});
