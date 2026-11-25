import { spawn } from 'node:child_process';
import { access, mkdir, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { CliError } from '../errors.js';
import { type Project, findPackageDir } from './project.js';

export type Platform = 'ios' | 'android';

export interface ProcessRunner {
  run(command: string, args: string[], cwd: string): Promise<number>;
}

export const spawnRunner: ProcessRunner = {
  run: (command, args, cwd) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'inherit', 'inherit'],
        shell: process.platform === 'win32',
      });
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    }),
};

export interface BundleOptions {
  project: Project;
  platform: Platform;
  workDir: string;
  entryFile?: string;
  runner?: ProcessRunner;
  hostPlatform?: NodeJS.Platform;
}

export interface BundleResult {
  stageDir: string;
  bundleName: string;
  hermesBytecodeVersion: number;
}

export function bundleFileName(platform: Platform): string {
  return platform === 'android' ? 'index.android.bundle' : 'main.jsbundle';
}

/**
 * Bundles the project in release mode, then compiles the bundle to Hermes
 * bytecode. stageDir holds exactly what goes into the archive: the bytecode
 * bundle and the assets.
 */
export async function buildBundle(opts: BundleOptions): Promise<BundleResult> {
  const { project, platform, workDir } = opts;
  const runner = opts.runner ?? spawnRunner;
  const bundleName = bundleFileName(platform);
  const jsDir = join(workDir, 'js');
  const stageDir = join(workDir, 'stage');
  const jsBundle = join(jsDir, `${bundleName}.js`);
  await mkdir(jsDir, { recursive: true });
  await mkdir(stageDir, { recursive: true });

  const hermesc = await hermescPath(project, opts.hostPlatform);
  const bundler = await bundlerCommand(project, opts.entryFile);

  const bundleArgs = [
    '--no-install',
    ...bundler.args,
    '--platform',
    platform,
    '--dev',
    'false',
    '--minify',
    'false',
    ...bundler.entryArgs,
    '--bundle-output',
    jsBundle,
    '--assets-dest',
    stageDir,
  ];
  await runStep(runner, 'npx', bundleArgs, project.root, bundler.label);

  const bytecode = join(stageDir, bundleName);
  await runStep(
    runner,
    hermesc,
    ['-O', '-emit-binary', '-out', bytecode, jsBundle],
    project.root,
    'hermesc'
  );

  return {
    stageDir,
    bundleName,
    hermesBytecodeVersion: await readHermesBytecodeVersion(bytecode),
  };
}

async function bundlerCommand(
  project: Project,
  entryFile: string | undefined
): Promise<{ label: string; args: string[]; entryArgs: string[] }> {
  if (project.kind === 'expo') {
    if (!(await findPackageDir(project.root, 'expo'))) {
      throw new CliError(
        'expo is not installed; install the project dependencies first'
      );
    }
    return {
      label: 'expo export:embed',
      args: ['expo', 'export:embed'],
      entryArgs: entryFile ? ['--entry-file', entryFile] : [],
    };
  }
  if (!(await findPackageDir(project.root, '@react-native-community/cli'))) {
    throw new CliError(
      '@react-native-community/cli is not installed; react-native bundle needs it'
    );
  }
  return {
    label: 'react-native bundle',
    args: ['react-native', 'bundle'],
    entryArgs: ['--entry-file', entryFile ?? 'index.js'],
  };
}

const HERMESC_BINARIES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: join('osx-bin', 'hermesc'),
  linux: join('linux64-bin', 'hermesc'),
  win32: join('win64-bin', 'hermesc.exe'),
};

async function hermescPath(
  project: Project,
  hostPlatform: NodeJS.Platform = process.platform
): Promise<string> {
  const binary = HERMESC_BINARIES[hostPlatform];
  if (!binary) {
    throw new CliError(`hermesc has no build for ${hostPlatform}`);
  }
  const compilerDir = await findPackageDir(
    await realpath(project.reactNativeDir),
    'hermes-compiler'
  );
  const path = compilerDir && join(compilerDir, 'hermesc', binary);
  if (!path || !(await exists(path))) {
    throw new CliError(
      'hermesc not found: Live updates need the Hermes compiler that ships with react-native (package hermes-compiler)'
    );
  }
  return path;
}

async function runStep(
  runner: ProcessRunner,
  command: string,
  args: string[],
  cwd: string,
  label: string
): Promise<void> {
  let code: number;
  try {
    code = await runner.run(command, args, cwd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(`${label}: ${command} was not found`);
    }
    throw err;
  }
  if (code !== 0) {
    throw new CliError(`${label} failed with exit code ${code}`);
  }
}

/** Hermes bytecode magic: bytes 0 to 7, the little-endian uint64 0x1F1903C103BC1FC6. */
const HERMES_MAGIC = Buffer.from([
  0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f,
]);
const HERMES_HEADER_BYTES = 12;

/**
 * Checks the Hermes magic, then reads the bytecode version: a little-endian
 * uint32 at bytes 8 to 11.
 */
export async function readHermesBytecodeVersion(path: string): Promise<number> {
  const header = Buffer.alloc(HERMES_HEADER_BYTES);
  const file = await open(path, 'r');
  let bytesRead: number;
  try {
    ({ bytesRead } = await file.read(header, 0, HERMES_HEADER_BYTES, 0));
  } finally {
    await file.close();
  }
  if (bytesRead < HERMES_HEADER_BYTES) {
    throw new CliError(
      `${path} is not a Hermes bytecode bundle: the file is shorter than the ${HERMES_HEADER_BYTES}-byte header`
    );
  }
  if (!header.subarray(0, HERMES_MAGIC.length).equals(HERMES_MAGIC)) {
    throw new CliError(
      `${path} is not a Hermes bytecode bundle: the header magic is ${header.subarray(0, 8).toString('hex')}, expected ${HERMES_MAGIC.toString('hex')}`
    );
  }
  const version = header.readUInt32LE(8);
  if (version === 0) {
    throw new CliError(
      `${path} is not a Hermes bytecode bundle: bytecode version 0`
    );
  }
  return version;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
