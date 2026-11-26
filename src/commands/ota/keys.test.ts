import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withTempDir } from '../../../test/fixtures.js';
import { captureOutput } from '../../../test/helpers.js';
import { keyIdOf } from '../../ota/keyId.js';
import { run } from '../../program.js';

describe('notti ota keys generate', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes a P-256 PKCS#8 private key with mode 0600 and prints the public key and key_id', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'signing.pem');
      const output = captureOutput();

      const code = await run(['ota', 'keys', 'generate', '--out', out], {
        output,
      });

      expect(code).toBe(0);
      expect((await stat(out)).mode & 0o777).toBe(0o600);

      const privatePem = await readFile(out, 'utf8');
      expect(privatePem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
      const privateKey = createPrivateKey(privatePem);
      expect(privateKey.asymmetricKeyType).toBe('ec');
      expect(privateKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');

      const publicKey = createPublicKey(privateKey);
      const printed = output.stdout.join('\n');
      expect(printed).toContain(`key_id: ${keyIdOf(publicKey)}`);
      expect(printed).toContain(
        publicKey.export({ type: 'spki', format: 'pem' }).toString().trimEnd()
      );
      expect(output.all()).not.toContain(privatePem.split('\n')[1]);
    });
  });

  it('refuses to overwrite an existing file and leaves it untouched', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'signing.pem');
      await writeFile(out, 'existing key');
      const output = captureOutput();

      const code = await run(['ota', 'keys', 'generate', '--out', out], {
        output,
      });

      expect(code).toBe(1);
      expect(output.stderr.join('\n')).toContain(
        'already exists; refusing to overwrite'
      );
      expect(await readFile(out, 'utf8')).toBe('existing key');
    });
  });

  it('sends nothing over the network', async () => {
    await withTempDir(async (dir) => {
      const output = captureOutput();
      await run(['ota', 'keys', 'generate', '--out', join(dir, 'k.pem')], {
        output,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
