import type { Output } from '../src/output.js';

export interface CapturedOutput extends Output {
  stdout: string[];
  stderr: string[];
  all(): string;
}

export function captureOutput(): CapturedOutput {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    all: () => [...stdout, ...stderr].join('\n'),
  };
}
