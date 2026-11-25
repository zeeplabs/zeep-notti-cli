import { createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { goVectorDir } from '../../test/fixtures.js';
import { keyIdOf } from './keyId.js';

describe('keyIdOf', () => {
  it('matches the key_id the Go server computes for its fixture key', async () => {
    const pem = await readFile(join(goVectorDir, 'public_key.pem'));
    const expected = (
      await readFile(join(goVectorDir, 'key_id.txt'), 'utf8')
    ).trim();
    expect(expected).toBe('00cdc54757854bed');
    expect(keyIdOf(createPublicKey(pem))).toBe(expected);
  });
});
