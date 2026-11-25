import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { gzipSync } from 'node:zlib';

import { CliError } from '../errors.js';

export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

export interface ArchiveFile {
  path: string;
  sha256: string;
  size: number;
}

export interface BuiltArchive {
  data: Buffer;
  sha256: string;
  size: number;
  files: ArchiveFile[];
}

export type TarEntry =
  | { type: 'file'; path: string; data: Buffer }
  | { type: 'directory'; path: string }
  | { type: 'symlink'; path: string; target: string };

/** Archives every regular file and directory under root. */
export async function archiveDirectory(root: string): Promise<BuiltArchive> {
  return buildArchive(root, await walk(root, ''));
}

/**
 * Builds a deterministic ustar tar.gz of the given paths under root: sorted
 * paths, zeroed mtimes and owners, fixed modes. Only regular non-empty files
 * and directories are accepted.
 */
export async function buildArchive(
  root: string,
  paths: string[]
): Promise<BuiltArchive> {
  const entries: TarEntry[] = [];
  const files: ArchiveFile[] = [];
  for (const path of [...new Set(paths)].sort()) {
    if (!isSafeRelativePath(path)) {
      throw new CliError(
        `${path}: archive paths must be relative POSIX paths without . or .. segments`
      );
    }
    const info = await lstat(join(root, ...path.split('/')));
    if (info.isDirectory()) {
      entries.push({ type: 'directory', path });
    } else if (info.isFile()) {
      if (info.size === 0) {
        throw new CliError(
          `${path} is empty; archives cannot hold empty files`
        );
      }
      const data = await readFile(join(root, ...path.split('/')));
      entries.push({ type: 'file', path, data });
      files.push({ path, sha256: sha256Hex(data), size: data.length });
    } else {
      throw new CliError(
        `${path} is not a regular file or directory (symbolic links are refused)`
      );
    }
  }
  if (files.length === 0) {
    throw new CliError('nothing to archive: no files were produced');
  }

  const data = gzipDeterministic(packTar(entries));
  if (data.length > MAX_ARCHIVE_BYTES) {
    throw new CliError(
      `the archive is ${data.length} bytes; Live updates archives are limited to ${MAX_ARCHIVE_BYTES} bytes (50 MiB)`
    );
  }
  return { data, sha256: sha256Hex(data), size: data.length, files };
}

export function isSafeRelativePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || /[\\\0]/.test(path)) {
    return false;
  }
  if (posix.normalize(path) !== path) {
    return false;
  }
  return path !== '.' && path !== '..' && !path.startsWith('../');
}

async function walk(root: string, relative: string): Promise<string[]> {
  const dirents = await readdir(join(root, relative), { withFileTypes: true });
  const paths: string[] = [];
  for (const dirent of dirents) {
    const path = relative ? `${relative}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) {
      paths.push(path, ...(await walk(root, path)));
    } else if (dirent.isFile()) {
      paths.push(path);
    } else {
      throw new CliError(
        `${path} is not a regular file or directory (symbolic links are refused)`
      );
    }
  }
  return paths;
}

const BLOCK = 512;

/** Writes entries as a ustar stream exactly as given, without validation. */
export function packTar(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const size = entry.type === 'file' ? entry.data.length : 0;
    blocks.push(tarHeader(entry, size));
    if (entry.type === 'file') {
      blocks.push(entry.data, Buffer.alloc(padding(size)));
    }
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(blocks);
}

function tarHeader(entry: TarEntry, size: number): Buffer {
  const header = Buffer.alloc(BLOCK);
  const fullName = entry.type === 'directory' ? `${entry.path}/` : entry.path;
  const [prefix, name] = splitName(fullName);
  header.write(name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, entry.type === 'directory' ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  const typeflag = { file: '0', directory: '5', symlink: '2' }[entry.type];
  header.write(typeflag, 156, 1, 'ascii');
  if (entry.type === 'symlink') {
    header.write(entry.target, 157, 100, 'utf8');
  }
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix, 345, 155, 'utf8');

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

function splitName(fullName: string): [string, string] {
  if (Buffer.byteLength(fullName) <= 100) {
    return ['', fullName];
  }
  const trailing = fullName.endsWith('/') ? 1 : 0;
  for (
    let i = fullName.lastIndexOf('/', fullName.length - 1 - trailing);
    i > 0;
    i = fullName.lastIndexOf('/', i - 1)
  ) {
    const prefix = fullName.slice(0, i);
    const name = fullName.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return [prefix, name];
    }
  }
  throw new CliError(`${fullName}: path is too long for a ustar archive`);
}

function writeOctal(
  header: Buffer,
  offset: number,
  length: number,
  value: number
): void {
  header.write(
    `${value.toString(8).padStart(length - 1, '0')}\0`,
    offset,
    length,
    'ascii'
  );
}

function padding(size: number): number {
  return (BLOCK - (size % BLOCK)) % BLOCK;
}

const GZIP_OS_BYTE = 9;
const GZIP_OS_UNIX = 3;

/** gzip with a fixed header (mtime 0, OS unix) so output does not depend on the host. */
export function gzipDeterministic(data: Buffer): Buffer {
  const gz = gzipSync(data, { level: 9 });
  gz[GZIP_OS_BYTE] = GZIP_OS_UNIX;
  return gz;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
