import {
  type KeyObject,
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  verify,
} from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { withTempDir } from '../../../test/fixtures.js';
import { captureOutput } from '../../../test/helpers.js';
import { stubRunner, writeRnProject } from '../../../test/projects.js';
import { untar } from '../../../test/untar.js';
import { keyIdOf } from '../../ota/keyId.js';
import { run } from '../../program.js';

const APP_ID = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const API_KEY = 'nk_rest_super_secret_value';
const BASE = 'https://notti.test';
const API = `${BASE}/v1/apps/${APP_ID}/ota`;
const UPLOAD_URL =
  'https://bucket.test/ota/apps/x/upload.tar.gz?X-Amz-Signature=abc';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer | undefined;
}

type Route = (req: Recorded) => Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

function mockServer(routes: Record<string, Route | Error>) {
  const calls: Recorded[] = [];
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const req: Recorded = {
        url: String(input),
        method: init?.method ?? 'GET',
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body:
          init?.body === undefined
            ? undefined
            : Buffer.from(init.body as string | Uint8Array),
      };
      calls.push(req);
      const route = routes[`${req.method} ${req.url}`];
      if (route instanceof Error) {
        throw route;
      }
      if (!route) {
        throw new Error(`unexpected ${req.method} ${req.url}`);
      }
      return route(req);
    }
  );
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function happyRoutes(keyId: string): Record<string, Route> {
  return {
    [`GET ${API}/keys`]: () =>
      json(200, [{ key_id: 'ffffffffffffffff' }, { key_id: keyId }]),
    [`POST ${API}/uploads`]: () =>
      json(201, {
        upload_id: '11111111-2222-4333-8444-555555555555',
        url: UPLOAD_URL,
        method: 'PUT',
        headers: { 'Cache-Control': 'private' },
        max_bytes: 52428800,
        expires_at: '2026-11-25T12:15:00Z',
      }),
    [`PUT ${UPLOAD_URL}`]: () => new Response(null, { status: 200 }),
    [`POST ${API}/releases`]: (req) => {
      const body = JSON.parse(req.body?.toString() ?? '{}');
      const manifest = JSON.parse(
        Buffer.from(body.manifest, 'base64').toString()
      );
      return json(201, {
        id: manifest.release_id,
        platform: manifest.platform,
        channel: body.channel,
        runtime_version: manifest.runtime_version,
        rollout_percent: body.rollout_percent ?? 100,
        mandatory: body.mandatory ?? false,
      });
    },
  };
}

interface Setup {
  dir: string;
  root: string;
  keyPath: string;
  privatePem: string;
  publicKey: KeyObject;
  keyId: string;
}

async function setup(dir: string): Promise<Setup> {
  const root = await writeRnProject(join(dir, 'app'), 'bare');
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const privatePem = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const keyPath = join(dir, 'signing-key-location.pem');
  await writeFile(keyPath, privatePem);
  return {
    dir,
    root,
    keyPath,
    privatePem,
    publicKey,
    keyId: keyIdOf(publicKey),
  };
}

async function release(
  s: Setup,
  fetch: typeof globalThis.fetch,
  extraArgs: string[] = [],
  env: NodeJS.ProcessEnv = {}
) {
  const output = captureOutput();
  const { runner, calls } = stubRunner(98);
  const code = await run(
    [
      'ota',
      'release',
      '--platform',
      'android',
      '--runtime-version',
      '1.4.0',
      '--app-id',
      APP_ID,
      '--base-url',
      BASE,
      '--private-key',
      s.keyPath,
      ...extraArgs,
    ],
    {
      output,
      env: { NOTTI_API_KEY: API_KEY, ...env },
      cwd: s.root,
      fetch,
      runner,
      hostPlatform: 'darwin',
    }
  );
  return { code, output, runnerCalls: calls };
}

function expectNoSecrets(s: Setup, text: string): void {
  expect(text).not.toContain(API_KEY);
  for (const line of s.privatePem.trim().split('\n').slice(1, -1)) {
    expect(text).not.toContain(line);
  }
  expect(text).not.toContain('signing-key-location');
}

describe('notti ota release', () => {
  it('bundles, signs, uploads with Cache-Control private, then creates the release', async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const server = mockServer(happyRoutes(s.keyId));

      const { code, output } = await release(
        s,
        server.fetch,
        ['--channel', 'staging', '--rollout', '25', '--mandatory'],
        { EXPO_PUBLIC_API_URL: 'https://hidden.example' }
      );

      expect(output.stderr).toEqual([]);
      expect(code).toBe(0);
      expect(server.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
        `GET ${API}/keys`,
        `POST ${API}/uploads`,
        `PUT ${UPLOAD_URL}`,
        `POST ${API}/releases`,
      ]);
      for (const call of [server.calls[0], server.calls[1], server.calls[3]]) {
        expect(call?.headers.authorization).toBe(`Bearer ${API_KEY}`);
      }

      const put = server.calls[2] as Recorded;
      expect(put.headers['cache-control']).toBe('private');
      expect(put.headers.authorization).toBeUndefined();
      const archive = put.body as Buffer;

      const body = JSON.parse(server.calls[3]?.body?.toString() ?? '{}');
      const manifestBytes = Buffer.from(body.manifest, 'base64');
      const manifest = JSON.parse(manifestBytes.toString());
      expect(body).toMatchObject({
        upload_id: '11111111-2222-4333-8444-555555555555',
        key_id: s.keyId,
        channel: 'staging',
        rollout_percent: 25,
        mandatory: true,
      });
      expect(
        verify(
          'sha256',
          manifestBytes,
          { key: s.publicKey, dsaEncoding: 'der' },
          Buffer.from(body.signature, 'base64')
        )
      ).toBe(true);
      expect(manifest).toMatchObject({
        format: 1,
        app_id: APP_ID,
        platform: 'android',
        channels: ['staging'],
        runtime_version: '1.4.0',
        hermes_bytecode_version: 98,
        bundle: 'index.android.bundle',
        archive: {
          sha256: createHash('sha256').update(archive).digest('hex'),
          size: archive.length,
        },
      });
      expect(
        untar(archive)
          .filter((e) => e.type === '0')
          .map((e) => e.name)
      ).toEqual(manifest.files.map((f: { path: string }) => f.path));
      expect(manifest.files.map((f: { path: string }) => f.path)).toEqual([
        'drawable-mdpi/logo.png',
        'index.android.bundle',
      ]);

      const printed = output.all();
      expect(printed).toContain(
        `Live update published: release ${manifest.release_id} on channel staging`
      );
      expect(printed).toContain('EXPO_PUBLIC_API_URL');
      expect(printed).not.toContain('https://hidden.example');
      expect(
        JSON.stringify(server.calls.map((c) => c.body?.toString()))
      ).not.toContain(s.privatePem.split('\n')[1]);
      expectNoSecrets(s, printed);
    });
  });

  it('sends exactly these requests, with no private key, key path or key contents anywhere', async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const server = mockServer(happyRoutes(s.keyId));

      const { code } = await release(s, server.fetch, [
        '--channel',
        'staging',
        '--rollout',
        '25',
        '--mandatory',
      ]);

      expect(code).toBe(0);
      expect(server.calls).toHaveLength(4);
      const [keys, upload, put, create] = server.calls as [
        Recorded,
        Recorded,
        Recorded,
        Recorded,
      ];
      const managementHeaders = {
        authorization: `Bearer ${API_KEY}`,
        accept: 'application/json',
      };

      expect(keys).toEqual({
        url: `${API}/keys`,
        method: 'GET',
        headers: managementHeaders,
        body: undefined,
      });
      expect(upload).toEqual({
        url: `${API}/uploads`,
        method: 'POST',
        headers: managementHeaders,
        body: undefined,
      });
      expect(put.url).toBe(UPLOAD_URL);
      expect(put.method).toBe('PUT');
      expect(put.headers).toEqual({ 'cache-control': 'private' });
      expect(create.url).toBe(`${API}/releases`);
      expect(create.method).toBe('POST');
      expect(create.headers).toEqual({
        ...managementHeaders,
        'content-type': 'application/json',
      });

      const archive = put.body as Buffer;
      const body = JSON.parse(create.body?.toString() ?? '{}');
      const manifestBytes = Buffer.from(body.manifest, 'base64');
      const manifest = JSON.parse(manifestBytes.toString());
      expect(body).toEqual({
        upload_id: '11111111-2222-4333-8444-555555555555',
        manifest: manifestBytes.toString('base64'),
        signature: body.signature,
        key_id: s.keyId,
        channel: 'staging',
        rollout_percent: 25,
        mandatory: true,
      });
      expect(
        verify(
          'sha256',
          manifestBytes,
          { key: s.publicKey, dsaEncoding: 'der' },
          Buffer.from(body.signature, 'base64')
        )
      ).toBe(true);
      expect(Object.keys(manifest).sort()).toEqual([
        'app_id',
        'archive',
        'bundle',
        'channels',
        'created_at',
        'files',
        'format',
        'hermes_bytecode_version',
        'platform',
        'release_id',
        'runtime_version',
      ]);
      expect(manifest.archive).toEqual({
        sha256: createHash('sha256').update(archive).digest('hex'),
        size: archive.length,
      });

      const privateKey = createPrivateKey(s.privatePem);
      const der = privateKey.export({ type: 'pkcs8', format: 'der' });
      const scalar = Buffer.from(
        privateKey.export({ format: 'jwk' }).d as string,
        'base64url'
      );
      const secrets: Array<[string, Buffer]> = [
        ['PEM', Buffer.from(s.privatePem)],
        [
          'PEM body',
          Buffer.from(s.privatePem.split('\n').slice(1, -2).join('')),
        ],
        ['PKCS#8 DER', der],
        ['DER base64', Buffer.from(der.toString('base64'))],
        ['private scalar', scalar],
        ['private scalar hex', Buffer.from(scalar.toString('hex'))],
        ['private scalar base64url', Buffer.from(scalar.toString('base64url'))],
        ['key path', Buffer.from(s.keyPath)],
        ['key file name', Buffer.from('signing-key-location')],
      ];
      const haystacks: Array<[string, Buffer]> = [
        ...server.calls.map((call): [string, Buffer] => [
          `${call.method} ${call.url}`,
          Buffer.concat([
            Buffer.from(call.url),
            Buffer.from(JSON.stringify(call.headers)),
            call.body ?? Buffer.alloc(0),
          ]),
        ]),
        ['the decoded manifest', manifestBytes],
        ['the uncompressed archive', gunzipSync(archive)],
      ];
      for (const [where, haystack] of haystacks) {
        for (const [name, secret] of secrets) {
          expect(haystack.includes(secret), `${name} in ${where}`).toBe(false);
        }
      }
    });
  });

  it.each([
    [
      'uploads',
      402,
      errorBody(
        'ota_not_in_plan',
        "this company's plan does not include OTA updates",
        {
          reason: 'ota_not_in_plan',
        }
      ),
      "ota_not_in_plan: this company's plan does not include OTA updates",
    ],
    [
      'releases',
      402,
      errorBody(
        'ota_release_limit_reached',
        'this app already published 10 OTA releases this month',
        {
          reason: 'ota_release_limit_reached',
          limit: 10,
          resets_at: '2026-12-01T00:00:00Z',
        }
      ),
      'ota_release_limit_reached: this app already published 10 OTA releases this month (limit 10, resets at 2026-12-01T00:00:00Z)',
    ],
    [
      'uploads',
      409,
      errorBody(
        'ota_storage_not_configured',
        'object storage is not configured for OTA updates'
      ),
      'ota_storage_not_configured: object storage is not configured for OTA updates',
    ],
    [
      'releases',
      409,
      errorBody(
        'ota_release_exists',
        'a release with this release_id already exists'
      ),
      'ota_release_exists: a release with this release_id already exists',
    ],
    [
      'releases',
      422,
      errorBody(
        'ota_invalid_signature',
        'the signature does not verify over the manifest with this key'
      ),
      'ota_invalid_signature: the signature does not verify over the manifest with this key',
    ],
    [
      'releases',
      502,
      errorBody(
        'ota_storage_error',
        'the uploaded archive could not be read, try again'
      ),
      'ota_storage_error: the uploaded archive could not be read, try again',
    ],
  ])(
    'prints the server error on %s %i as code: message and exits non-zero',
    async (path, status, body, line) => {
      await withTempDir(async (dir) => {
        const s = await setup(dir);
        const routes: Record<string, Route> = happyRoutes(s.keyId);
        routes[`POST ${API}/${path}`] = () => json(status, body);
        const server = mockServer(routes);

        const { code, output } = await release(s, server.fetch);

        expect(code).toBe(1);
        expect(output.stderr).toEqual([`error: ${line}`]);
        if (path === 'uploads') {
          expect(server.calls.some((c) => c.method === 'PUT')).toBe(false);
        }
        expectNoSecrets(s, output.all());
      });
    }
  );

  it('reports a network error and exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const server = mockServer({
        [`GET ${API}/keys`]: new TypeError('fetch failed'),
      });

      const { code, output } = await release(s, server.fetch);

      expect(code).toBe(1);
      expect(output.stderr).toEqual([
        `error: network_error: could not reach ${BASE}: fetch failed`,
      ]);
      expectNoSecrets(s, output.all());
    });
  });

  it('does not create the release when the archive upload fails', async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const routes: Record<string, Route> = happyRoutes(s.keyId);
      routes[`PUT ${UPLOAD_URL}`] = () =>
        new Response('denied', { status: 403 });
      const server = mockServer(routes);

      const { code, output } = await release(s, server.fetch);

      expect(code).toBe(1);
      expect(output.stderr).toEqual([
        'error: upload_failed: storage answered HTTP 403 to the archive upload',
      ]);
      expect(server.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'PUT']);
      expect(output.all()).not.toContain('X-Amz-Signature');
    });
  });

  it.each([
    [[], 'ota_no_public_key: this app has no Live updates public key'],
    [[{ key_id: 'ffffffffffffffff' }], 'ota_unknown_key: key '],
  ])(
    'uploads nothing when the signing key is not registered (%j)',
    async (keys, message) => {
      await withTempDir(async (dir) => {
        const s = await setup(dir);
        const server = mockServer({
          [`GET ${API}/keys`]: () => json(200, keys),
        });

        const { code, output } = await release(s, server.fetch);

        expect(code).toBe(1);
        expect(output.stderr[0]).toContain(`error: ${message}`);
        expect(output.stderr[0]).toContain(s.keyId);
        expect(server.calls.map((c) => c.method)).toEqual(['GET']);
      });
    }
  );

  it('fails before bundling or any network call when no signing key is given', async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const server = mockServer({});
      const output = captureOutput();
      const { runner, calls } = stubRunner();

      const code = await run(
        [
          'ota',
          'release',
          '--platform',
          'ios',
          '--runtime-version',
          '1',
          '--app-id',
          APP_ID,
        ],
        {
          output,
          env: { NOTTI_API_KEY: API_KEY },
          cwd: s.root,
          fetch: server.fetch,
          runner,
          hostPlatform: 'darwin',
        }
      );

      expect(code).toBe(1);
      expect(output.stderr).toEqual([
        'error: no signing key: pass --private-key <path> or set NOTTI_OTA_PRIVATE_KEY',
      ]);
      expect(calls).toEqual([]);
      expect(server.calls).toEqual([]);
    });
  });

  it('builds and signs without uploading on --dry-run', async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const server = mockServer({});

      const { code, output, runnerCalls } = await release(
        s,
        server.fetch,
        ['--dry-run'],
        {
          NOTTI_API_KEY: undefined,
        }
      );

      expect(code).toBe(0);
      expect(runnerCalls).toHaveLength(2);
      expect(server.calls).toEqual([]);
      expect(output.stdout.join('\n')).toContain(`with key ${s.keyId}`);
      expect(output.stdout.at(-1)).toBe('Dry run: nothing was uploaded.');
    });
  });

  it('refuses a rollout outside 1 to 100', async () => {
    await withTempDir(async (dir) => {
      const s = await setup(dir);
      const server = mockServer({});
      const { code, output } = await release(s, server.fetch, [
        '--rollout',
        '0',
      ]);
      expect(code).toBe(1);
      expect(output.stderr).toEqual([
        'error: --rollout must be an integer from 1 to 100',
      ]);
      expect(server.calls).toEqual([]);
    });
  });
});
