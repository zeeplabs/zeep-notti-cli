import { generateKeyPairSync } from 'node:crypto';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Command } from 'commander';

import { CliError } from '../../errors.js';
import type { Output } from '../../output.js';
import { keyIdOf } from '../../ota/keyId.js';

export const DEFAULT_PRIVATE_KEY_PATH = 'notti-live-updates.private.pem';

export interface GeneratedKey {
  privateKeyPath: string;
  publicKeyPem: string;
  keyId: string;
}

export async function generateSigningKey(
  outPath: string
): Promise<GeneratedKey> {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  let file;
  try {
    file = await open(outPath, 'wx', 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CliError(
        `${outPath} already exists; refusing to overwrite a signing key`
      );
    }
    throw err;
  }
  try {
    await file.writeFile(privatePem);
    await file.chmod(0o600);
  } finally {
    await file.close();
  }

  return {
    privateKeyPath: outPath,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: keyIdOf(publicKey),
  };
}

export function registerKeysCommand(ota: Command, output: Output): void {
  const keys = ota
    .command('keys')
    .description('Manage Live updates signing keys')
    .exitOverride();

  keys
    .command('generate')
    .description(
      'Generate an ECDSA P-256 key pair for signing Live updates; nothing is sent over the network'
    )
    .option(
      '--out <path>',
      'where to write the private key (PKCS#8 PEM, mode 0600)',
      DEFAULT_PRIVATE_KEY_PATH
    )
    .exitOverride()
    .action(async (opts: { out: string }) => {
      const key = await generateSigningKey(resolve(opts.out));
      output.out(`Private key written to ${key.privateKeyPath} (mode 0600).`);
      output.out(
        'Keep it secret and out of version control. Notti never needs it.'
      );
      output.out('');
      output.out(`key_id: ${key.keyId}`);
      output.out('');
      output.out(
        'Public key (register it in the Notti dashboard and embed it in your app):'
      );
      output.out(key.publicKeyPem.trimEnd());
    });
}
