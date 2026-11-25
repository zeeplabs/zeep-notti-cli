import {
  type KeyObject,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { CliError } from '../errors.js';
import type { ArchiveFile } from './archive.js';
import type { Platform } from './bundle.js';
import { keyIdOf } from './keyId.js';

export const MANIFEST_FORMAT = 1;

const CHANNEL_PATTERN = /^[a-z0-9-]{1,32}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ManifestInput {
  appId: string;
  platform: Platform;
  channels: string[];
  runtimeVersion: string;
  hermesBytecodeVersion: number;
  bundle: string;
  archive: { sha256: string; size: number };
  files: ArchiveFile[];
  releaseId?: string;
  createdAt?: Date;
}

export interface SignedManifest {
  manifestBytes: Buffer;
  signature: Buffer;
  keyId: string;
}

/** Serializes a format v1 manifest once; these exact bytes are what gets signed. */
export function serializeManifest(input: ManifestInput): Buffer {
  if (!UUID_PATTERN.test(input.appId)) {
    throw new CliError('the app ID must be a lowercase UUID');
  }
  if (input.channels.length === 0) {
    throw new CliError('at least one channel is required');
  }
  for (const channel of input.channels) {
    if (!CHANNEL_PATTERN.test(channel)) {
      throw new CliError(
        `channel "${channel}" must be 1 to 32 characters of a-z, 0-9 and -`
      );
    }
  }
  if (input.runtimeVersion.length < 1 || input.runtimeVersion.length > 64) {
    throw new CliError('the runtime version must be 1 to 64 characters');
  }
  if (!input.files.some((file) => file.path === input.bundle)) {
    throw new CliError(`the bundle ${input.bundle} is not in the archive`);
  }

  const createdAt = (input.createdAt ?? new Date())
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
  return Buffer.from(
    JSON.stringify({
      format: MANIFEST_FORMAT,
      release_id: input.releaseId ?? randomUUID(),
      app_id: input.appId,
      platform: input.platform,
      channels: input.channels,
      runtime_version: input.runtimeVersion,
      hermes_bytecode_version: input.hermesBytecodeVersion,
      created_at: createdAt,
      bundle: input.bundle,
      archive: { sha256: input.archive.sha256, size: input.archive.size },
      files: input.files.map(({ path, sha256, size }) => ({
        path,
        sha256,
        size,
      })),
    }),
    'utf8'
  );
}

/** Signs the bytes with ECDSA P-256 / SHA-256, DER encoded. */
export function signManifest(
  input: ManifestInput,
  privateKey: KeyObject
): SignedManifest {
  const manifestBytes = serializeManifest(input);
  return {
    manifestBytes,
    signature: sign('sha256', manifestBytes, {
      key: privateKey,
      dsaEncoding: 'der',
    }),
    keyId: keyIdOf(createPublicKey(privateKey)),
  };
}

export interface SigningKeySource {
  privateKeyPath?: string;
  envValue?: string;
}

/**
 * Loads the PKCS#8 signing key from --private-key (a path) or from
 * NOTTI_OTA_PRIVATE_KEY (a path, or the PEM itself). Errors never include
 * the key or its path.
 */
export async function loadSigningKey(
  source: SigningKeySource
): Promise<KeyObject> {
  let pem: string;
  if (source.privateKeyPath) {
    pem = await readKeyFile(source.privateKeyPath, '--private-key');
  } else if (source.envValue?.trim()) {
    const value = source.envValue.trim();
    pem = value.startsWith('-----BEGIN')
      ? value
      : await readKeyFile(value, 'NOTTI_OTA_PRIVATE_KEY');
  } else {
    throw new CliError(
      'no signing key: pass --private-key <path> or set NOTTI_OTA_PRIVATE_KEY'
    );
  }

  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new CliError('the signing key is not a readable PEM private key');
  }
  if (
    key.asymmetricKeyType !== 'ec' ||
    key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new CliError(
      'the signing key must be an ECDSA P-256 private key (create one with notti ota keys generate)'
    );
  }
  return key;
}

async function readKeyFile(path: string, origin: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new CliError(`cannot read the private key file given by ${origin}`);
  }
}
