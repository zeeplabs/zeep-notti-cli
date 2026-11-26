import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { CliError } from '../errors.js';

export type ProjectKind = 'bare' | 'expo';

export interface Project {
  root: string;
  kind: ProjectKind;
  reactNativeVersion: string;
  reactNativeDir: string;
}

const MIN_REACT_NATIVE_MINOR = 83;

export const EXPO_UPDATES_CONFLICT =
  'expo-updates is installed in this project. Notti Live updates and expo-updates are mutually exclusive: ' +
  'disabling expo-updates (updates.enabled: false) is not enough, uninstall it and rebuild the app.';

export async function detectProject(root: string): Promise<Project> {
  const pkg = await readPackageJson(root);
  const kind: ProjectKind = pkg.dependencies?.expo ? 'expo' : 'bare';

  if (await findPackageDir(root, 'expo-updates')) {
    throw new CliError(EXPO_UPDATES_CONFLICT);
  }

  const reactNativeDir = await findPackageDir(root, 'react-native');
  if (!reactNativeDir) {
    throw new CliError(
      `react-native is not installed in ${root}; install the project dependencies first`
    );
  }
  const { version } = JSON.parse(
    await readFile(join(reactNativeDir, 'package.json'), 'utf8')
  ) as { version?: string };
  if (!version || !isSupportedReactNative(version)) {
    throw new CliError(
      `Live updates need React Native 0.${MIN_REACT_NATIVE_MINOR} or newer; this project has react-native ${version ?? 'unknown'}`
    );
  }

  return { root, kind, reactNativeVersion: version, reactNativeDir };
}

export function expoPublicEnvNames(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((name) => name.startsWith('EXPO_PUBLIC_'))
    .sort();
}

export function describeExpoPublicEnv(names: string[]): string {
  if (names.length === 0) {
    return 'No EXPO_PUBLIC_* variables are set for this bundle.';
  }
  return `EXPO_PUBLIC_* variables inlined in this bundle (compare them with your binary build): ${names.join(', ')}`;
}

function isSupportedReactNative(version: string): boolean {
  const match = /^(\d+)\.(\d+)\./.exec(version);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || minor >= MIN_REACT_NATIVE_MINOR;
}

interface PackageJson {
  dependencies?: Record<string, string>;
}

async function readPackageJson(root: string): Promise<PackageJson> {
  let raw: string;
  try {
    raw = await readFile(join(root, 'package.json'), 'utf8');
  } catch {
    throw new CliError(
      `no package.json in ${root}; run notti from your React Native project root`
    );
  }
  try {
    return JSON.parse(raw) as PackageJson;
  } catch {
    throw new CliError(`${join(root, 'package.json')} is not valid JSON`);
  }
}

/**
 * Finds an installed package the way Node resolves it from `from`: the first
 * node_modules/<name> with a package.json, walking up to the filesystem root.
 */
export async function findPackageDir(
  from: string,
  name: string
): Promise<string | undefined> {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    try {
      await access(join(candidate, 'package.json'));
      return candidate;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) {
        return undefined;
      }
      dir = parent;
    }
  }
}
