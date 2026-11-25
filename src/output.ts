export interface Output {
  out(line: string): void;
  err(line: string): void;
}

export const processOutput: Output = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};
