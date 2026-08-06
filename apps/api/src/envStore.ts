import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFilePath = fileURLToPath(new URL('../.env', import.meta.url));
const envNamePattern = /^[A-Z_][A-Z0-9_]*$/;

export function isEnvConfigured(envName: string): boolean {
  assertEnvName(envName);
  const value = process.env[envName];
  return Boolean(value && value.trim().length > 0);
}

export async function setLocalEnvValue(envName: string, value: string): Promise<void> {
  assertEnvName(envName);
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error('API Key 不能为空');
  }

  const lines = await readEnvLines();
  const nextLines = upsertEnvLine(lines, envName, trimmedValue);
  await writeEnvLines(nextLines);
  process.env[envName] = trimmedValue;
}

export async function clearLocalEnvValue(envName: string): Promise<void> {
  assertEnvName(envName);
  const lines = await readEnvLines();
  const nextLines = lines.filter((line) => parseEnvName(line) !== envName);
  await writeEnvLines(nextLines);
  delete process.env[envName];
}

async function readEnvLines(): Promise<string[]> {
  try {
    const raw = await readFile(envFilePath, 'utf8');
    return raw.replace(/\r\n/g, '\n').split('\n').filter((line, index, lines) => index < lines.length - 1 || line.length > 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeEnvLines(lines: string[]): Promise<void> {
  if (!lines.length) {
    await unlink(envFilePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
    return;
  }

  const tmpPath = `${envFilePath}.tmp`;
  await mkdir(dirname(envFilePath), { recursive: true });
  await writeFile(tmpPath, `${lines.join('\n')}\n`, 'utf8');
  await rename(tmpPath, envFilePath);
}

function upsertEnvLine(lines: string[], envName: string, value: string): string[] {
  const serializedLine = `${envName}=${serializeEnvValue(value)}`;
  const nextLines: string[] = [];
  let hasWritten = false;

  for (const line of lines) {
    if (parseEnvName(line) !== envName) {
      nextLines.push(line);
      continue;
    }

    if (!hasWritten) {
      nextLines.push(serializedLine);
      hasWritten = true;
    }
  }

  if (!hasWritten) {
    nextLines.push(serializedLine);
  }

  return nextLines;
}

function parseEnvName(line: string): string | null {
  const trimmed = line.trimStart();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  return trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1] ?? null;
}

function serializeEnvValue(value: string): string {
  return /^[A-Za-z0-9_@./:+\-=]+$/.test(value) ? value : JSON.stringify(value);
}

function assertEnvName(envName: string): void {
  if (!envNamePattern.test(envName)) {
    throw new Error(`Invalid env name: ${envName}`);
  }
}
