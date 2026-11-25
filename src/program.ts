import { Command, CommanderError } from 'commander';

import { registerKeysCommand } from './commands/ota/keys.js';
import { CliError } from './errors.js';
import { type Output, processOutput } from './output.js';
import { CLI_VERSION } from './version.js';

export interface ProgramDeps {
  output: Output;
}

export function buildProgram(deps: ProgramDeps): Command {
  const program = new Command('notti')
    .description('Notti command line')
    .version(CLI_VERSION)
    .configureOutput({
      writeOut: (text) => deps.output.out(text.trimEnd()),
      writeErr: (text) => deps.output.err(text.trimEnd()),
    })
    .exitOverride();

  const ota = program
    .command('ota')
    .description(
      'Live updates: publish signed JS bundles to your React Native apps'
    )
    .exitOverride();
  registerKeysCommand(ota, deps.output);

  return program;
}

export async function run(
  argv: string[],
  deps: ProgramDeps = { output: processOutput }
): Promise<number> {
  const program = buildProgram(deps);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      return err.exitCode;
    }
    if (err instanceof CliError) {
      deps.output.err(`error: ${err.message}`);
      return err.exitCode;
    }
    throw err;
  }
}
