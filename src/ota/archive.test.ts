import { randomBytes } from 'node:crypto';
import { mkdir, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTempDir } from '../../test/fixtures.js';
import { untar } from '../../test/untar.js';
import { CliError } from '../errors.js';
import {
  MAX_ARCHIVE_BYTES,
  archiveDirectory,
  buildArchive,
  sha256Hex,
} from './archive.js';

async function writeStage(root: string): Promise<void> {
  await mkdir(join(root, 'drawable-mdpi'), { recursive: true });
  await mkdir(join(root, 'assets', 'fonts'), { recursive: true });
  await writeFile(join(root, 'index.android.bundle'), 'bytecode');
  await writeFile(join(root, 'drawable-mdpi', 'assets_logo.png'), 'png');
  await writeFile(join(root, 'assets', 'fonts', 'inter.ttf'), 'font');
}

describe('archiveDirectory', () => {
  it('is deterministic: the same files give the same SHA-256 whatever their mtimes', async () => {
    await withTempDir(async (dir) => {
      await writeStage(dir);
      const first = await archiveDirectory(dir);
      await utimes(join(dir, 'index.android.bundle'), 1000, 1000);
      await utimes(join(dir, 'assets'), 2000, 2000);
      const second = await archiveDirectory(dir);

      expect(second.sha256).toBe(first.sha256);
      expect(second.data.equals(first.data)).toBe(true);
      expect(first.sha256).toBe(sha256Hex(first.data));
      expect(first.size).toBe(first.data.length);
    });
  });

  it('writes sorted ustar entries with normalized metadata and lists every file with its hash and size', async () => {
    await withTempDir(async (dir) => {
      await writeStage(dir);
      const archive = await archiveDirectory(dir);
      const entries = untar(archive.data);

      expect(entries.map((e) => [e.name, e.type])).toEqual([
        ['assets/', '5'],
        ['assets/fonts/', '5'],
        ['assets/fonts/inter.ttf', '0'],
        ['drawable-mdpi/', '5'],
        ['drawable-mdpi/assets_logo.png', '0'],
        ['index.android.bundle', '0'],
      ]);
      for (const entry of entries) {
        expect(entry.magic).toBe('ustar');
        expect(entry.mtime).toBe(0);
        expect([entry.uid, entry.gid]).toEqual([0, 0]);
        expect(entry.mode).toBe(entry.type === '5' ? 0o755 : 0o644);
      }
      expect(archive.files).toEqual([
        {
          path: 'assets/fonts/inter.ttf',
          sha256: sha256Hex(Buffer.from('font')),
          size: 4,
        },
        {
          path: 'drawable-mdpi/assets_logo.png',
          sha256: sha256Hex(Buffer.from('png')),
          size: 3,
        },
        {
          path: 'index.android.bundle',
          sha256: sha256Hex(Buffer.from('bytecode')),
          size: 8,
        },
      ]);
      expect(
        entries.find((e) => e.name === 'index.android.bundle')?.data.toString()
      ).toBe('bytecode');
    });
  });

  it('stores a path longer than 100 bytes with the ustar prefix field', async () => {
    await withTempDir(async (dir) => {
      const deep = `assets/${'d'.repeat(60)}/${'e'.repeat(30)}`;
      await mkdir(join(dir, deep), { recursive: true });
      const file = `${deep}/${'f'.repeat(40)}.png`;
      await writeFile(join(dir, file), 'png');
      const entries = untar((await archiveDirectory(dir)).data);
      expect(entries.map((e) => e.name)).toContain(file);
    });
  });

  it('refuses a symbolic link', async () => {
    await withTempDir(async (dir) => {
      await writeStage(dir);
      await symlink('/etc/hosts', join(dir, 'drawable-mdpi', 'link.png'));
      await expect(archiveDirectory(dir)).rejects.toThrow(
        new CliError(
          'drawable-mdpi/link.png is not a regular file or directory (symbolic links are refused)'
        )
      );
    });
  });

  it('refuses an empty file, which a release manifest cannot list', async () => {
    await withTempDir(async (dir) => {
      await writeStage(dir);
      await writeFile(join(dir, 'empty.png'), '');
      await expect(archiveDirectory(dir)).rejects.toThrow(
        'empty.png is empty; archives cannot hold empty files'
      );
    });
  });

  it('refuses an archive over 50 MiB', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, 'index.android.bundle'),
        randomBytes(MAX_ARCHIVE_BYTES + 1024)
      );
      expect(MAX_ARCHIVE_BYTES).toBe(52428800);
      await expect(archiveDirectory(dir)).rejects.toThrow(
        /bytes; Live updates archives are limited to 52428800 bytes \(50 MiB\)$/
      );
    });
  }, 30_000);
});

describe('buildArchive', () => {
  it.each([
    '../outside.js',
    'assets/../../outside.js',
    '/etc/hosts',
    './index.js',
    'a\\b.js',
  ])('refuses the unsafe path %s', async (path) => {
    await withTempDir(async (dir) => {
      await writeStage(dir);
      await expect(
        buildArchive(dir, ['index.android.bundle', path])
      ).rejects.toThrow(
        new CliError(
          `${path}: archive paths must be relative POSIX paths without . or .. segments`
        )
      );
    });
  });
});
