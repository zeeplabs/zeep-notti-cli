import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProcessRunner } from '../src/ota/bundle.js';

export interface FixtureProject {
  dependencies?: Record<string, string>;
  installed?: Record<string, string>;
  files?: Record<string, string>;
}

export async function writeProject(
  root: string,
  project: FixtureProject
): Promise<string> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'app', dependencies: project.dependencies ?? {} })
  );
  for (const [name, version] of Object.entries(project.installed ?? {})) {
    const dir = join(root, 'node_modules', name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name, version })
    );
  }
  for (const [path, content] of Object.entries(project.files ?? {})) {
    await writeFile(join(root, path), content);
  }
  return root;
}

export const hbcDir = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'hbc'
);

export async function writeRnProject(
  root: string,
  kind: 'bare' | 'expo'
): Promise<string> {
  const installed: Record<string, string> = {
    'react-native': '0.83.0',
    'hermes-compiler': '0.14.0',
  };
  if (kind === 'expo') {
    installed.expo = '55.0.0';
  } else {
    installed['@react-native-community/cli'] = '20.0.0';
  }
  await writeProject(root, {
    dependencies: kind === 'expo' ? { expo: '~55.0.0' } : {},
    installed,
  });
  for (const bin of ['osx-bin/hermesc', 'linux64-bin/hermesc']) {
    const path = join(root, 'node_modules', 'hermes-compiler', 'hermesc', bin);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '');
  }
  return root;
}

export interface RunnerCall {
  command: string;
  args: string[];
  cwd: string;
}

/**
 * Stands in for npx and hermesc: the bundler step writes the JS bundle and
 * one asset, the hermesc step writes a Hermes header fixture to -out.
 */
export function stubRunner(
  hbcVersion = 96,
  exitCodes: number[] = []
): { runner: ProcessRunner; calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const runner: ProcessRunner = {
    run: async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      const code = exitCodes[calls.length - 1] ?? 0;
      if (code !== 0) {
        return code;
      }
      const out = args[args.indexOf('-out') + 1];
      if (args.includes('-out') && out) {
        await copyFile(join(hbcDir, `v${hbcVersion}.hbc`), out);
      }
      const jsBundle = args[args.indexOf('--bundle-output') + 1];
      const assets = args[args.indexOf('--assets-dest') + 1];
      if (args.includes('--bundle-output') && jsBundle && assets) {
        await writeFile(jsBundle, 'var app = 1;');
        await mkdir(join(assets, 'drawable-mdpi'), { recursive: true });
        await writeFile(join(assets, 'drawable-mdpi', 'logo.png'), 'png');
      }
      return code;
    },
  };
  return { runner, calls };
}
