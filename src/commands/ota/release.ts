import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Command, Option } from 'commander';

import { CliError } from '../../errors.js';
import type { Output } from '../../output.js';
import { type FetchFn, LiveUpdatesApi } from '../../ota/api.js';
import { archiveDirectory } from '../../ota/archive.js';
import {
  type Platform,
  type ProcessRunner,
  buildBundle,
} from '../../ota/bundle.js';
import { loadSigningKey, signManifest } from '../../ota/manifest.js';
import {
  describeExpoPublicEnv,
  detectProject,
  expoPublicEnvNames,
} from '../../ota/project.js';

export const DEFAULT_BASE_URL = 'https://app.zeepnotti.app';

export interface ReleaseOptions {
  platform: Platform;
  channel: string;
  runtimeVersion: string;
  rollout?: number;
  mandatory?: boolean;
  privateKey?: string;
  apiKey?: string;
  appId?: string;
  baseUrl: string;
  entryFile?: string;
  dryRun?: boolean;
}

export interface ReleaseDeps {
  output: Output;
  env: NodeJS.ProcessEnv;
  cwd: string;
  fetch: FetchFn;
  runner?: ProcessRunner;
  hostPlatform?: NodeJS.Platform;
}

export async function releaseCommand(
  opts: ReleaseOptions,
  deps: ReleaseDeps
): Promise<void> {
  const { output, env } = deps;
  const appId = (opts.appId ?? env.NOTTI_APP_ID ?? '').toLowerCase();
  if (!appId) {
    throw new CliError('no app ID: pass --app-id <id> or set NOTTI_APP_ID');
  }
  const apiKey = opts.apiKey ?? env.NOTTI_API_KEY;
  if (!apiKey && !opts.dryRun) {
    throw new CliError(
      'no API key: pass --api-key <key> or set NOTTI_API_KEY (the App REST key)'
    );
  }

  const signingKey = await loadSigningKey({
    privateKeyPath: opts.privateKey,
    envValue: env.NOTTI_OTA_PRIVATE_KEY,
  });
  const project = await detectProject(deps.cwd);
  output.out(
    `Building a ${opts.platform} Live update (${project.kind} project, react-native ${project.reactNativeVersion}).`
  );
  output.out(describeExpoPublicEnv(expoPublicEnvNames(env)));

  const workDir = await mkdtemp(join(tmpdir(), 'notti-live-update-'));
  try {
    const bundle = await buildBundle({
      project,
      platform: opts.platform,
      workDir,
      entryFile: opts.entryFile,
      runner: deps.runner,
      hostPlatform: deps.hostPlatform,
    });
    const archive = await archiveDirectory(bundle.stageDir);
    const signed = signManifest(
      {
        appId,
        platform: opts.platform,
        channels: [opts.channel],
        runtimeVersion: opts.runtimeVersion,
        hermesBytecodeVersion: bundle.hermesBytecodeVersion,
        bundle: bundle.bundleName,
        archive: { sha256: archive.sha256, size: archive.size },
        files: archive.files,
      },
      signingKey
    );
    const releaseId = (
      JSON.parse(signed.manifestBytes.toString('utf8')) as {
        release_id: string;
      }
    ).release_id;
    output.out(
      `Signed release ${releaseId} with key ${signed.keyId}: ${archive.files.length} files, ${archive.size} bytes, Hermes bytecode ${bundle.hermesBytecodeVersion}.`
    );

    if (opts.dryRun) {
      output.out('Dry run: nothing was uploaded.');
      return;
    }

    const api = new LiveUpdatesApi({
      baseUrl: opts.baseUrl,
      appId,
      apiKey: apiKey as string,
      fetch: deps.fetch,
    });
    const keys = await api.listKeys();
    if (keys.length === 0) {
      throw new CliError(
        `ota_no_public_key: this app has no Live updates public key; register the public key of ${signed.keyId} first`
      );
    }
    if (!keys.some((key) => key.key_id === signed.keyId)) {
      throw new CliError(
        `ota_unknown_key: key ${signed.keyId} is not registered on this app`
      );
    }

    const ticket = await api.createUpload();
    if (archive.size > ticket.max_bytes) {
      throw new CliError(
        `the archive is ${archive.size} bytes; the server accepts at most ${ticket.max_bytes}`
      );
    }
    await api.uploadArchive(ticket, archive.data);
    const release = await api.createRelease({
      upload_id: ticket.upload_id,
      manifest: signed.manifestBytes.toString('base64'),
      signature: signed.signature.toString('base64'),
      key_id: signed.keyId,
      channel: opts.channel,
      rollout_percent: opts.rollout,
      mandatory: opts.mandatory || undefined,
    });
    output.out(
      `Live update published: release ${release.id} on channel ${release.channel} (${release.platform}, runtime ${release.runtime_version}), rollout ${release.rollout_percent}%${release.mandatory ? ', mandatory' : ''}.`
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function parseRollout(value: string): number {
  const rollout = Number(value);
  if (!Number.isInteger(rollout) || rollout < 1 || rollout > 100) {
    throw new CliError('--rollout must be an integer from 1 to 100');
  }
  return rollout;
}

export function registerReleaseCommand(
  ota: Command,
  deps: Omit<ReleaseDeps, 'env' | 'cwd' | 'fetch'> &
    Partial<Pick<ReleaseDeps, 'env' | 'cwd' | 'fetch'>>
): void {
  ota
    .command('release')
    .description(
      'Bundle, sign and publish a Live update for one platform and channel'
    )
    .addOption(
      new Option('--platform <platform>', 'target platform')
        .choices(['ios', 'android'])
        .makeOptionMandatory()
    )
    .option(
      '--channel <channel>',
      'channel the release is served on',
      'production'
    )
    .requiredOption(
      '--runtime-version <version>',
      'runtime version of the binaries this release is built for'
    )
    .option(
      '--rollout <percent>',
      'share of devices that receive it, 1 to 100 (server default 100)',
      parseRollout
    )
    .option('--mandatory', 'mark the release as mandatory')
    .option(
      '--private-key <path>',
      'ECDSA P-256 signing key, PKCS#8 PEM (or NOTTI_OTA_PRIVATE_KEY)'
    )
    .option('--api-key <key>', 'App REST key (or NOTTI_API_KEY)')
    .option('--app-id <id>', 'App ID (or NOTTI_APP_ID)')
    .option('--base-url <url>', 'Notti server URL', DEFAULT_BASE_URL)
    .option(
      '--entry-file <path>',
      'JS entry file (bare default index.js; Expo resolves its own)'
    )
    .option('--dry-run', 'build and sign without uploading')
    .exitOverride()
    .action((opts: ReleaseOptions) =>
      releaseCommand(opts, {
        ...deps,
        env: deps.env ?? process.env,
        cwd: deps.cwd ?? process.cwd(),
        fetch: deps.fetch ?? globalThis.fetch,
      })
    );
}
