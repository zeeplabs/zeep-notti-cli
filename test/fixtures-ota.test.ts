import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../src/ota/archive.js';
import { untar } from './untar.js';

const otaDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'ota'
);

interface FilesJson {
  bundle: string;
  files: Array<{ path: string; sha256: string; size: number }>;
}

async function load(name: string): Promise<Buffer> {
  return readFile(join(otaDir, 'archives', name));
}

describe('exported SDK fixture archives', async () => {
  const index = JSON.parse(
    await readFile(join(otaDir, 'index.json'), 'utf8')
  ) as Record<string, { expect: string; sha256: string; size: number }>;
  const listed = JSON.parse(
    await readFile(join(otaDir, 'files.json'), 'utf8')
  ) as FilesJson;

  it('records the hash and size of every archive', async () => {
    for (const [name, info] of Object.entries(index)) {
      const data = await load(name);
      expect([name, sha256Hex(data), data.length]).toEqual([
        name,
        info.sha256,
        info.size,
      ]);
    }
  });

  it('valid.tar.gz holds exactly the files listed, with matching hashes', async () => {
    const files = untar(await load('valid.tar.gz')).filter(
      (e) => e.type === '0'
    );
    expect(
      files.map((e) => ({
        path: e.name,
        sha256: sha256Hex(e.data),
        size: e.data.length,
      }))
    ).toEqual(listed.files);
    expect(listed.files.map((f) => f.path)).toContain(listed.bundle);
  });

  it('tampered.tar.gz has the same paths but a bundle whose hash does not match', async () => {
    const entries = untar(await load('tampered.tar.gz'));
    const bundle = entries.find((e) => e.name === listed.bundle);
    const expected = listed.files.find((f) => f.path === listed.bundle);
    expect(bundle && sha256Hex(bundle.data)).not.toBe(expected?.sha256);
    expect(bundle?.data.length).toBe(expected?.size);
  });

  it.each([
    ['path-traversal.tar.gz', '../escape.js', '0'],
    ['absolute-path.tar.gz', '/tmp/escape.js', '0'],
    ['symlink.tar.gz', 'assets/link', '2'],
    ['unlisted-file.tar.gz', 'extra.js', '0'],
  ])('%s carries the offending entry %s', async (name, entryName, type) => {
    const entry = untar(await load(name)).find((e) => e.name === entryName);
    expect(entry?.type).toBe(type);
  });
});
