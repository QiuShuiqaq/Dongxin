import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));

export function getDataPath(fileName: string) {
  return fileURLToPath(new URL(`../../../data/${fileName}`, import.meta.url));
}

export async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  const filePath = getDataPath(fileName);

  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }

    await mkdir(dataDir, { recursive: true });
    await writeJsonFile(fileName, fallback);
    return fallback;
  }
}

export async function writeJsonFile<T>(fileName: string, value: T): Promise<void> {
  const filePath = getDataPath(fileName);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmpPath, filePath);
}
