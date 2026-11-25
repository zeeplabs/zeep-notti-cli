import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const goVectorDir = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'go-vector'
);

export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>
): Promise<T> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'notti-cli-test-')));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
