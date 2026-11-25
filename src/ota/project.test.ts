import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTempDir } from '../../test/fixtures.js';
import { writeProject } from '../../test/projects.js';
import { CliError } from '../errors.js';
import {
  EXPO_UPDATES_CONFLICT,
  describeExpoPublicEnv,
  detectProject,
  expoPublicEnvNames,
} from './project.js';

describe('detectProject', () => {
  it('detects a bare React Native 0.83 project', async () => {
    await withTempDir(async (dir) => {
      const root = await writeProject(dir, {
        dependencies: { 'react-native': '0.83.0' },
        installed: { 'react-native': '0.83.0' },
      });
      const project = await detectProject(root);
      expect(project).toEqual({
        root,
        kind: 'bare',
        reactNativeVersion: '0.83.0',
        reactNativeDir: join(root, 'node_modules', 'react-native'),
      });
    });
  });

  it('refuses a bare React Native 0.82 project', async () => {
    await withTempDir(async (dir) => {
      const root = await writeProject(dir, {
        dependencies: { 'react-native': '0.82.1' },
        installed: { 'react-native': '0.82.1' },
      });
      await expect(detectProject(root)).rejects.toThrow(
        new CliError(
          'Live updates need React Native 0.83 or newer; this project has react-native 0.82.1'
        )
      );
    });
  });

  it('detects an Expo project from expo in dependencies', async () => {
    await withTempDir(async (dir) => {
      const root = await writeProject(dir, {
        dependencies: { 'expo': '~55.0.0', 'react-native': '0.83.2' },
        installed: { 'expo': '55.0.0', 'react-native': '0.83.2' },
      });
      const project = await detectProject(root);
      expect(project.kind).toBe('expo');
      expect(project.reactNativeVersion).toBe('0.83.2');
    });
  });

  it('refuses an Expo project with expo-updates installed, even with updates.enabled false', async () => {
    await withTempDir(async (dir) => {
      const root = await writeProject(dir, {
        dependencies: {
          'expo': '~55.0.0',
          'expo-updates': '~55.0.0',
          'react-native': '0.83.2',
        },
        installed: {
          'expo': '55.0.0',
          'expo-updates': '55.0.0',
          'react-native': '0.83.2',
        },
        files: {
          'app.json': JSON.stringify({ expo: { updates: { enabled: false } } }),
        },
      });
      await expect(detectProject(root)).rejects.toThrow(
        new CliError(EXPO_UPDATES_CONFLICT)
      );
      expect(EXPO_UPDATES_CONFLICT).toContain('mutually exclusive');
      expect(EXPO_UPDATES_CONFLICT).toContain('uninstall it');
    });
  });

  it('refuses expo-updates that resolves from a parent node_modules', async () => {
    await withTempDir(async (dir) => {
      await writeProject(dir, { installed: { 'expo-updates': '55.0.0' } });
      const root = await writeProject(join(dir, 'apps', 'mobile'), {
        dependencies: { 'react-native': '0.83.0' },
        installed: { 'react-native': '0.83.0' },
      });
      await expect(detectProject(root)).rejects.toThrow(EXPO_UPDATES_CONFLICT);
    });
  });
});

describe('EXPO_PUBLIC_* names', () => {
  it('lists the names sorted and never the values', () => {
    const env = {
      EXPO_PUBLIC_API_URL: 'https://secret.example',
      EXPO_PUBLIC_FLAG: 'token-123',
      NOTTI_API_KEY: 'rest-key',
      PATH: '/bin',
    };
    const names = expoPublicEnvNames(env);
    expect(names).toEqual(['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_FLAG']);

    const line = describeExpoPublicEnv(names);
    expect(line).toContain('EXPO_PUBLIC_API_URL, EXPO_PUBLIC_FLAG');
    expect(line).not.toContain('https://secret.example');
    expect(line).not.toContain('token-123');
  });

  it('says when no EXPO_PUBLIC_* variable is set', () => {
    expect(describeExpoPublicEnv(expoPublicEnvNames({ PATH: '/bin' }))).toBe(
      'No EXPO_PUBLIC_* variables are set for this bundle.'
    );
  });
});
