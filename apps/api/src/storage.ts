import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = process.env.DONGXIN_DATA_DIR
  ? resolve(process.env.DONGXIN_DATA_DIR)
  : fileURLToPath(new URL('../../../data/', import.meta.url));

export function getDataPath(fileName: string) {
  return resolve(dataDir, fileName);
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

    // Reads must not initialize files: a missing-file read racing a transaction
    // could otherwise replace its newly committed data with the fallback.
    return structuredClone(fallback);
  }
}

export async function writeJsonFile<T>(fileName: string, value: T): Promise<void> {
  const filePath = getDataPath(fileName);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(tmpPath, filePath);
  } finally {
    await unlink(tmpPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
}

const mutations = new Map<string, Promise<unknown>>();

/** Single-process read/modify/write transaction. All writers of a mutable file must use this entry. */
export function updateJsonFile<T, R>(fileName: string, fallback: T, update: (current: T) => { value: T; result: R } | Promise<{ value: T; result: R }>): Promise<R> {
  const key = getDataPath(fileName);
  const task = (mutations.get(key) ?? Promise.resolve()).then(async () => {
    const next = await update(await readJsonFile(fileName, fallback));
    await writeJsonFile(fileName, next.value);
    return next.result;
  });
  const tail = task.catch(() => undefined);
  mutations.set(key, tail);
  void tail.then(() => { if (mutations.get(key) === tail) mutations.delete(key); });
  return task;
}
