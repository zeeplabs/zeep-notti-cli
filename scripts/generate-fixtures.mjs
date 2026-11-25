// Regenerates fixtures/ota from the built CLI (run `pnpm fixtures`). The SDK
// test suites consume these files; the CLI tests check they stay consistent.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gzipDeterministic, packTar, sha256Hex } from '../dist/ota/archive.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'fixtures', 'ota');
const archivesDir = join(outDir, 'archives');

const bundle = await readFile(join(root, 'test', 'fixtures', 'hbc', 'v96.hbc'));
const logo = Buffer.from('fixture-png-bytes');
const font = Buffer.from('fixture-font-bytes');

const validEntries = [
  { type: 'directory', path: 'assets' },
  { type: 'directory', path: 'assets/fonts' },
  { type: 'file', path: 'assets/fonts/inter.ttf', data: font },
  { type: 'directory', path: 'drawable-mdpi' },
  { type: 'file', path: 'drawable-mdpi/assets_logo.png', data: logo },
  { type: 'file', path: 'index.android.bundle', data: bundle },
];

const tamperedBundle = Buffer.from(bundle);
tamperedBundle[tamperedBundle.length - 1] ^= 0xff;

const archives = {
  'valid.tar.gz': {
    expect: 'accept',
    entries: validEntries,
  },
  'tampered.tar.gz': {
    expect:
      'reject: index.android.bundle does not match the sha256 in files.json',
    entries: validEntries.map((e) =>
      e.path === 'index.android.bundle' ? { ...e, data: tamperedBundle } : e
    ),
  },
  'path-traversal.tar.gz': {
    expect: 'reject: entry ../escape.js leaves the extraction directory',
    entries: [
      ...validEntries,
      { type: 'file', path: '../escape.js', data: logo },
    ],
  },
  'absolute-path.tar.gz': {
    expect: 'reject: entry /tmp/escape.js is absolute',
    entries: [
      ...validEntries,
      { type: 'file', path: '/tmp/escape.js', data: logo },
    ],
  },
  'symlink.tar.gz': {
    expect: 'reject: entry assets/link is a symbolic link',
    entries: [
      ...validEntries,
      { type: 'symlink', path: 'assets/link', target: '/etc/passwd' },
    ],
  },
  'unlisted-file.tar.gz': {
    expect: 'reject: entry extra.js is not listed in files.json',
    entries: [...validEntries, { type: 'file', path: 'extra.js', data: logo }],
  },
};

await rm(archivesDir, { recursive: true, force: true });
await mkdir(archivesDir, { recursive: true });

const index = {};
for (const [name, spec] of Object.entries(archives)) {
  const data = gzipDeterministic(packTar(spec.entries));
  await writeFile(join(archivesDir, name), data);
  index[name] = {
    expect: spec.expect,
    sha256: sha256Hex(data),
    size: data.length,
  };
}

const files = validEntries
  .filter((e) => e.type === 'file')
  .map((e) => ({
    path: e.path,
    sha256: sha256Hex(e.data),
    size: e.data.length,
  }));

await writeFile(
  join(outDir, 'files.json'),
  `${JSON.stringify({ bundle: 'index.android.bundle', files }, null, 2)}\n`
);
await writeFile(
  join(outDir, 'index.json'),
  `${JSON.stringify(index, null, 2)}\n`
);
console.log(`wrote ${Object.keys(archives).length} archives to ${archivesDir}`);
