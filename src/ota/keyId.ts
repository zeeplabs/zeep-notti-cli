import { createHash, type KeyObject } from 'node:crypto';

/**
 * Returns the Live updates key_id of a P-256 public key: lowercase hex of the
 * first 8 bytes of SHA-256 over its 65-byte uncompressed SEC1 point. The
 * Notti server and SDKs compute the same value.
 */
export function keyIdOf(publicKey: KeyObject): string {
  return createHash('sha256')
    .update(uncompressedPoint(publicKey))
    .digest('hex')
    .slice(0, 16);
}

function uncompressedPoint(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('not an ECDSA P-256 public key');
  }
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
}
