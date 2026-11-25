import {
  createPublicKey,
  generateKeyPairSync,
  verify,
  type KeyObject,
} from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { goVectorDir, withTempDir } from '../../test/fixtures.js';
import { CliError } from '../errors.js';
import { keyIdOf } from './keyId.js';
import {
  type ManifestInput,
  loadSigningKey,
  serializeManifest,
  signManifest,
} from './manifest.js';

const otaFixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'ota'
);

function p256Pem(): { pem: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return {
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey,
  };
}

const sha = (c: string) => c.repeat(64);

const input: ManifestInput = {
  appId: '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
  platform: 'ios',
  channels: ['production'],
  runtimeVersion: '2.0.0',
  hermesBytecodeVersion: 99,
  bundle: 'main.jsbundle',
  archive: { sha256: sha('a'), size: 1234 },
  files: [
    { path: 'assets/logo.png', sha256: sha('b'), size: 10 },
    { path: 'main.jsbundle', sha256: sha('c'), size: 20 },
  ],
};

describe('signManifest', () => {
  it('serializes format v1 once and signs those exact bytes with P-256 / SHA-256 / DER', async () => {
    const { pem, publicKey } = p256Pem();
    const key = await loadSigningKey({ envValue: pem });
    const signed = signManifest(
      { ...input, createdAt: new Date('2026-11-25T12:34:56.789Z') },
      key
    );

    const manifest = JSON.parse(signed.manifestBytes.toString('utf8'));
    expect(Object.keys(manifest)).toEqual([
      'format',
      'release_id',
      'app_id',
      'platform',
      'channels',
      'runtime_version',
      'hermes_bytecode_version',
      'created_at',
      'bundle',
      'archive',
      'files',
    ]);
    expect(manifest).toMatchObject({
      format: 1,
      app_id: input.appId,
      platform: 'ios',
      channels: ['production'],
      runtime_version: '2.0.0',
      hermes_bytecode_version: 99,
      created_at: '2026-11-25T12:34:56Z',
      bundle: 'main.jsbundle',
      archive: { sha256: sha('a'), size: 1234 },
      files: input.files,
    });
    expect(manifest.release_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );

    expect(signed.signature[0]).toBe(0x30);
    expect(
      verify(
        'sha256',
        signed.manifestBytes,
        { key: publicKey, dsaEncoding: 'der' },
        signed.signature
      )
    ).toBe(true);
    expect(signed.keyId).toBe(keyIdOf(publicKey));
  });

  it('gives every release a new release_id', async () => {
    const key = await loadSigningKey({ envValue: p256Pem().pem });
    const a = JSON.parse(signManifest(input, key).manifestBytes.toString());
    const b = JSON.parse(signManifest(input, key).manifestBytes.toString());
    expect(a.release_id).not.toBe(b.release_id);
  });

  it.each([
    [{ appId: 'not-a-uuid' }, 'the app ID must be a lowercase UUID'],
    [{ channels: [] }, 'at least one channel is required'],
    [
      { channels: ['Prod'] },
      'channel "Prod" must be 1 to 32 characters of a-z, 0-9 and -',
    ],
    [{ runtimeVersion: '' }, 'the runtime version must be 1 to 64 characters'],
    [
      { runtimeVersion: 'x'.repeat(65) },
      'the runtime version must be 1 to 64 characters',
    ],
    [
      { bundle: 'index.android.bundle' },
      'the bundle index.android.bundle is not in the archive',
    ],
  ])('refuses %o before signing', (override, message) => {
    expect(() => serializeManifest({ ...input, ...override })).toThrow(
      new CliError(message)
    );
  });
});

describe('checked-in signature vectors', () => {
  it('the CLI-signed vector verifies with its public key and key_id (the Go verifier accepts the same files)', async () => {
    const manifest = await readFile(join(otaFixtures, 'manifest.json'));
    const signature = await readFile(join(otaFixtures, 'manifest.sig'));
    const publicKey = createPublicKey(
      await readFile(join(otaFixtures, 'public_key.pem'))
    );
    const keyId = await readFile(join(otaFixtures, 'key_id.txt'), 'utf8');

    expect(
      verify(
        'sha256',
        manifest,
        { key: publicKey, dsaEncoding: 'der' },
        signature
      )
    ).toBe(true);
    expect(keyIdOf(publicKey)).toBe(keyId);

    const parsed = JSON.parse(manifest.toString());
    const index = JSON.parse(
      await readFile(join(otaFixtures, 'index.json'), 'utf8')
    );
    const files = JSON.parse(
      await readFile(join(otaFixtures, 'files.json'), 'utf8')
    );
    expect(parsed.archive).toEqual({
      sha256: index['valid.tar.gz'].sha256,
      size: index['valid.tar.gz'].size,
    });
    expect(parsed.files).toEqual(files.files);
  });

  it('the Go server fixture, signed with Node, verifies with the same primitive the CLI signs with', async () => {
    const manifest = await readFile(join(goVectorDir, 'manifest.json'));
    const signature = await readFile(join(goVectorDir, 'manifest.sig'));
    const publicKey = createPublicKey(
      await readFile(join(goVectorDir, 'public_key.pem'))
    );
    expect(
      verify(
        'sha256',
        manifest,
        { key: publicKey, dsaEncoding: 'der' },
        signature
      )
    ).toBe(true);
  });
});

describe('loadSigningKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails with exit code 1 when no key is given', async () => {
    const err = await loadSigningKey({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toBe(
      'no signing key: pass --private-key <path> or set NOTTI_OTA_PRIVATE_KEY'
    );
    expect((err as CliError).exitCode).toBe(1);
  });

  it('reads the key from --private-key, or from NOTTI_OTA_PRIVATE_KEY as a path or as PEM', async () => {
    await withTempDir(async (dir) => {
      const { pem, publicKey } = p256Pem();
      const path = join(dir, 'key.pem');
      await writeFile(path, pem);
      const expected = keyIdOf(publicKey);
      for (const source of [
        { privateKeyPath: path },
        { envValue: path },
        { envValue: pem },
      ]) {
        const key = await loadSigningKey(source);
        expect(keyIdOf(createPublicKey(key))).toBe(expected);
      }
    });
  });

  it.each([
    ['Ed25519', () => generateKeyPairSync('ed25519').privateKey],
    [
      'P-384',
      () => generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey,
    ],
  ])('refuses a %s key', async (_name, make) => {
    const pem = make().export({ type: 'pkcs8', format: 'pem' }).toString();
    await expect(loadSigningKey({ envValue: pem })).rejects.toThrow(
      new CliError(
        'the signing key must be an ECDSA P-256 private key (create one with notti ota keys generate)'
      )
    );
  });

  it('never logs the key, its contents or its path, even on errors', async () => {
    await withTempDir(async (dir) => {
      const writes: string[] = [];
      const capture = (chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      };
      vi.spyOn(process.stdout, 'write').mockImplementation(capture);
      vi.spyOn(process.stderr, 'write').mockImplementation(capture);
      for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, level).mockImplementation((...args) => {
          writes.push(args.join(' '));
        });
      }

      const { pem } = p256Pem();
      const secretLine = pem.split('\n')[1] as string;
      const path = join(dir, 'secret-key-path.pem');
      await writeFile(path, pem);
      signManifest(input, await loadSigningKey({ privateKeyPath: path }));

      const broken = pem.replace(secretLine, `${secretLine.slice(0, 10)}!!`);
      const errors = await Promise.all([
        loadSigningKey({ envValue: broken }).catch((e: Error) => e.message),
        loadSigningKey({ privateKeyPath: `${path}.missing` }).catch(
          (e: Error) => e.message
        ),
      ]);

      const everything = [...writes, ...errors].join('\n');
      expect(everything).not.toContain(secretLine);
      expect(everything).not.toContain(secretLine.slice(0, 10));
      expect(everything).not.toContain('secret-key-path');
      expect(errors).toEqual([
        'the signing key is not a readable PEM private key',
        'cannot read the private key file given by --private-key',
      ]);
    });
  });
});
