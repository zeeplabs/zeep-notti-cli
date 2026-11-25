import { describe, expect, it } from 'vitest';

import { captureOutput } from '../test/helpers.js';
import { run } from './program.js';
import { CLI_VERSION } from './version.js';

describe('notti command tree', () => {
  it('prints the package version for --version', async () => {
    const output = captureOutput();
    const code = await run(['--version'], { output });
    expect(code).toBe(0);
    expect(output.stdout).toEqual([CLI_VERSION]);
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('lists the ota group as Live updates in the help', async () => {
    const output = captureOutput();
    const code = await run(['--help'], { output });
    expect(code).toBe(0);
    expect(output.all()).toMatch(/ota\s+Live updates: /);
  });

  it('exits non-zero on an unknown command', async () => {
    const output = captureOutput();
    const code = await run(['nope'], { output });
    expect(code).not.toBe(0);
    expect(output.stderr.join('\n')).toContain("unknown command 'nope'");
  });
});
