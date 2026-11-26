import { gunzipSync } from 'node:zlib';

export interface UntarEntry {
  name: string;
  type: string;
  mode: number;
  mtime: number;
  uid: number;
  gid: number;
  linkname: string;
  magic: string;
  data: Buffer;
}

function field(block: Buffer, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('utf8');
}

function octal(block: Buffer, offset: number, length: number): number {
  return parseInt(field(block, offset, length).trim() || '0', 8);
}

/** Minimal ustar reader used only to inspect archives in tests. */
export function untar(gz: Buffer): UntarEntry[] {
  const tar = gunzipSync(gz);
  const entries: UntarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every((b) => b === 0)) {
      break;
    }
    const stored = octal(block, 148, 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) {
      sum += i >= 148 && i < 156 ? 0x20 : (block[i] as number);
    }
    if (sum !== stored) {
      throw new Error(`bad checksum at offset ${offset}`);
    }
    const prefix = field(block, 345, 155);
    const name = field(block, 0, 100);
    const size = octal(block, 124, 12);
    entries.push({
      name: prefix ? `${prefix}/${name}` : name,
      type: field(block, 156, 1),
      mode: octal(block, 100, 8),
      uid: octal(block, 108, 8),
      gid: octal(block, 116, 8),
      mtime: octal(block, 136, 12),
      linkname: field(block, 157, 100),
      magic: field(block, 257, 6),
      data: Buffer.from(tar.subarray(offset + 512, offset + 512 + size)),
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
