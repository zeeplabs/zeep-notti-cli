import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { withTempDir } from '../../test/fixtures.js';
import { writeProject } from '../../test/projects.js';
import { CliError } from '../errors.js';
import {
  type Platform,
  type ProcessRunner,
  buildBundle,
  readHermesBytecodeVersion,
} from './bundle.js';
import { type Project, detectProject } from './project.js';

const hbcDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'test',
  'fixtures',
  'hbc'
);

interface Call {
  command: string;
  args: string[];
  cwd: string;
}

function stubRunner(
  hbcVersion = 96,
  exitCodes: number[] = []
): {
  runner: ProcessRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const runner: ProcessRunner = {
    run: async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      const code = exitCodes[calls.length - 1] ?? 0;
      const outIndex = args.indexOf('-out');
      if (code === 0 && outIndex >= 0) {
        await copyFile(
          join(hbcDir, `v${hbcVersion}.hbc`),
          args[outIndex + 1] as string
        );
      }
      return code;
    },
  };
  return { runner, calls };
}

async function fixtureProject(
  root: string,
  kind: 'bare' | 'expo'
): Promise<Project> {
  const installed: Record<string, string> = { 'react-native': '0.83.0' };
  if (kind === 'expo') {
    installed.expo = '55.0.0';
  } else {
    installed['@react-native-community/cli'] = '20.0.0';
  }
  installed['hermes-compiler'] = '0.14.0';
  await writeProject(root, {
    dependencies: kind === 'expo' ? { expo: '~55.0.0' } : {},
    installed,
  });
  for (const bin of ['osx-bin/hermesc', 'linux64-bin/hermesc']) {
    const path = join(root, 'node_modules', 'hermes-compiler', 'hermesc', bin);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '');
  }
  return detectProject(root);
}

describe('buildBundle', () => {
  const cases: Array<{ kind: 'bare' | 'expo'; platform: Platform }> = [
    { kind: 'bare', platform: 'android' },
    { kind: 'bare', platform: 'ios' },
    { kind: 'expo', platform: 'android' },
    { kind: 'expo', platform: 'ios' },
  ];

  it.each(cases)(
    'runs the exact release commands for $kind $platform',
    async ({ kind, platform }) => {
      await withTempDir(async (dir) => {
        const root = join(dir, 'app');
        const workDir = join(dir, 'work');
        const project = await fixtureProject(root, kind);
        const { runner, calls } = stubRunner(98);

        const result = await buildBundle({
          project,
          platform,
          workDir,
          runner,
          hostPlatform: 'darwin',
        });

        const bundleName =
          platform === 'android' ? 'index.android.bundle' : 'main.jsbundle';
        const jsBundle = join(workDir, 'js', `${bundleName}.js`);
        const stageDir = join(workDir, 'stage');
        const bundler =
          kind === 'expo'
            ? ['expo', 'export:embed']
            : ['react-native', 'bundle'];
        const entry = kind === 'expo' ? [] : ['--entry-file', 'index.js'];

        expect(calls).toEqual([
          {
            command: 'npx',
            args: [
              '--no-install',
              ...bundler,
              '--platform',
              platform,
              '--dev',
              'false',
              '--minify',
              'false',
              ...entry,
              '--bundle-output',
              jsBundle,
              '--assets-dest',
              stageDir,
            ],
            cwd: root,
          },
          {
            command: join(
              root,
              'node_modules',
              'hermes-compiler',
              'hermesc',
              'osx-bin',
              'hermesc'
            ),
            args: [
              '-O',
              '-emit-binary',
              '-out',
              join(stageDir, bundleName),
              jsBundle,
            ],
            cwd: root,
          },
        ]);
        expect(result).toEqual({
          stageDir,
          bundleName,
          hermesBytecodeVersion: 98,
        });
      });
    }
  );

  it('passes a custom entry file to expo export:embed', async () => {
    await withTempDir(async (dir) => {
      const project = await fixtureProject(join(dir, 'app'), 'expo');
      const { runner, calls } = stubRunner();
      await buildBundle({
        project,
        platform: 'ios',
        workDir: join(dir, 'work'),
        entryFile: 'src/main.ts',
        runner,
        hostPlatform: 'linux',
      });
      expect(calls[0]?.args).toContain('--entry-file');
      expect(calls[0]?.args[calls[0].args.indexOf('--entry-file') + 1]).toBe(
        'src/main.ts'
      );
      expect(calls[1]?.command).toContain(join('linux64-bin', 'hermesc'));
    });
  });

  it('fails clearly when hermesc is missing', async () => {
    await withTempDir(async (dir) => {
      const root = join(dir, 'app');
      await writeProject(root, {
        installed: {
          'react-native': '0.83.0',
          '@react-native-community/cli': '20.0.0',
        },
      });
      const { runner, calls } = stubRunner();
      await expect(
        buildBundle({
          project: await detectProject(root),
          platform: 'android',
          workDir: join(dir, 'work'),
          runner,
          hostPlatform: 'darwin',
        })
      ).rejects.toThrow(
        new CliError(
          'hermesc not found: Live updates need the Hermes compiler that ships with react-native (package hermes-compiler)'
        )
      );
      expect(calls).toEqual([]);
    });
  });

  it('fails clearly when the React Native CLI is missing in a bare project', async () => {
    await withTempDir(async (dir) => {
      const root = join(dir, 'app');
      await writeProject(root, {
        installed: { 'react-native': '0.83.0', 'hermes-compiler': '0.14.0' },
      });
      const path = join(
        root,
        'node_modules',
        'hermes-compiler',
        'hermesc',
        'osx-bin',
        'hermesc'
      );
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, '');
      await expect(
        buildBundle({
          project: await detectProject(root),
          platform: 'android',
          workDir: join(dir, 'work'),
          runner: stubRunner().runner,
          hostPlatform: 'darwin',
        })
      ).rejects.toThrow(
        '@react-native-community/cli is not installed; react-native bundle needs it'
      );
    });
  });

  it('fails clearly when the bundler exits non-zero, without running hermesc', async () => {
    await withTempDir(async (dir) => {
      const project = await fixtureProject(join(dir, 'app'), 'bare');
      const { runner, calls } = stubRunner(96, [1]);
      await expect(
        buildBundle({
          project,
          platform: 'android',
          workDir: join(dir, 'work'),
          runner,
          hostPlatform: 'darwin',
        })
      ).rejects.toThrow(
        new CliError('react-native bundle failed with exit code 1')
      );
      expect(calls).toHaveLength(1);
    });
  });

  it('fails clearly when npx itself is missing', async () => {
    await withTempDir(async (dir) => {
      const project = await fixtureProject(join(dir, 'app'), 'expo');
      const runner: ProcessRunner = {
        run: async () => {
          throw Object.assign(new Error('spawn npx ENOENT'), {
            code: 'ENOENT',
          });
        },
      };
      await expect(
        buildBundle({
          project,
          platform: 'ios',
          workDir: join(dir, 'work'),
          runner,
          hostPlatform: 'darwin',
        })
      ).rejects.toThrow(new CliError('expo export:embed: npx was not found'));
    });
  });
});

describe('readHermesBytecodeVersion', () => {
  it.each([96, 98, 99])('reads version %i from the header', async (v) => {
    expect(await readHermesBytecodeVersion(join(hbcDir, `v${v}.hbc`))).toBe(v);
  });

  it('refuses a file that is not Hermes bytecode', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'plain.js');
      await writeFile(path, 'var a');
      await expect(readHermesBytecodeVersion(path)).rejects.toThrow(
        'is not a Hermes bytecode bundle'
      );
    });
  });
});
