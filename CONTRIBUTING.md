# Contributing

Contributions are always welcome, no matter how large or small!

We want this community to be friendly and respectful to each other. Please follow it in all your interactions with the project. Before contributing, please read the [code of conduct](./CODE_OF_CONDUCT.md).

## Development workflow

`@notti/cli` is a Node.js command line written in TypeScript, managed with [pnpm](https://pnpm.io/installation) and tested with [Vitest](https://vitest.dev/). Use the Node.js version in [`.nvmrc`](./.nvmrc) (the package supports Node.js 20 and newer, and CI runs on 20 and 22).

Install dependencies:

```sh
pnpm install
```

> The project uses a pnpm lockfile, so don't use `npm`/`yarn` for development.

Build and run the CLI locally:

```sh
pnpm build
node dist/cli.js --version
```

Make sure your code passes TypeScript:

```sh
pnpm typecheck
```

To check for linting and formatting errors (ESLint with Prettier), run:

```sh
pnpm lint
```

Run the unit tests, and add tests for your change if possible:

```sh
pnpm test
```

`pnpm fixtures` regenerates `fixtures/ota/` (signed manifest and archive vectors consumed by the SDK test suites). Only run it when your change affects the signing or archive format, and include the regenerated files in the PR.

### Full sanity gate

Before opening a PR, all of the following should pass. This mirrors the [`Checks`](./.github/workflows/checks.yml) workflow:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build && node dist/cli.js --version
```

### Security and credentials

Never commit signing private keys, REST API keys or real app IDs, and redact them from logs and output pasted in issues and PRs. Report vulnerabilities privately, as described in [SECURITY.md](./SECURITY.md).

### Clean-room rule

No code from CodePush, hot-updater, expo-updates or Revopush (including their CLIs) may be copied, adapted or added as a dependency. Every line here is written from scratch. See the README for details.

### Commit message convention

We follow the [Conventional Commits specification](https://www.conventionalcommits.org/en) for our commit messages. The release tooling derives the next version and the changelog from them:

- `fix`: bug fixes, e.g. fix a crash when the entry file is missing.
- `feat`: new features, e.g. add a new option to `notti ota release`.
- `refactor`: code refactor with no behavior change.
- `docs`: changes to documentation.
- `test`: adding or updating tests.
- `chore`: tooling changes, e.g. change CI config.

### Releases

Maintainers publish releases. The process is described in [RELEASING.md](./RELEASING.md). Please don't bump the version or edit `CHANGELOG.md` in your PR.

### Sending a pull request

- Prefer small pull requests focused on one change.
- Verify that typecheck, lint, tests and build are passing.
- Update the README if you change commands, options or behavior.
- Follow the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md) when opening a pull request.
- For pull requests that change the command surface or architecture, discuss with maintainers first by opening an issue.
