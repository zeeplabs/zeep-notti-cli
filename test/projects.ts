import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
