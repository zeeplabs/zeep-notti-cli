# Releasing notti-cli

Releases follow the same flow as `react-native-notti`: `pnpm release` bumps the version, writes `CHANGELOG.md` and creates the `vX.Y.Z` tag. Pushing the tag runs `.github/workflows/release.yml`, which publishes to npm through [trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers), with no `NPM_TOKEN`, and then creates the GitHub Release from `CHANGELOG.md`.

Do not publish from your machine after the first release, and do not hand-write `chore: release` commits.

## Regular release

1. Be on an up to date `main` with a clean working tree and the checks green.
2. Run `pnpm release`. release-it computes the next version from the Conventional Commits since the last tag (you can override it at the prompt), prepends the entry to `CHANGELOG.md`, commits `chore: release X.Y.Z`, creates the tag `vX.Y.Z` and pushes both.
3. The tag triggers `Release`. It checks that the tag matches `package.json`, runs typecheck, lint, tests and the build, publishes with `npm publish --access public` and creates the GitHub Release.
4. Confirm the new version on npmjs.com and that `npx notti-cli@latest --version` prints it.

The workflow skips the npm step when that exact version is already on the registry, so re-running it (or pushing the tag of a version you published by hand) does not fail on a duplicate publish.

## First publish (one time)

A Trusted Publisher can only be attached to a package that already exists on npm, so the very first version is published by hand.

1. Be logged in to npm with the `zeep.tech` account (`npm whoami`), with 2FA enabled.
2. From a clean checkout of `main`, with Node 22 or newer:

   ```sh
   pnpm install --frozen-lockfile
   pnpm typecheck && pnpm lint && pnpm test
   npm pack --dry-run   # check the file list: only dist/, README, LICENSE, package.json
   npm publish --access public
   ```

   `prepack` rebuilds `dist/` before packing. The version published is the one in `package.json` (`0.1.0`).
3. Set up the Trusted Publisher (next section).
4. Tag the published commit so the history and the GitHub Release line up:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

   The workflow sees that `0.1.0` is already on npm, skips the publish and creates the GitHub Release from the `0.1.0` section of `CHANGELOG.md`. This also gives release-it its first tag, so the next `pnpm release` only picks up newer commits.

## Trusted Publisher setup (npmjs.com)

On npmjs.com, open the package `notti-cli`, then **Settings**, **Trusted Publisher**, choose **GitHub Actions** and fill in:

| Field | Value |
| --- | --- |
| Organization or user | `zeeplabs` |
| Repository | `zeep-notti-cli` |
| Workflow filename | `release.yml` |
| Environment | leave empty |

The workflow needs `id-token: write` (already set) and npm 11.5.1 or newer, which is why the publish job runs on Node 24. After it works, in the same settings page you can set **Publishing access** to require 2FA and disallow tokens.

## Package contents

`package.json` `files` ships only `dist` (minus tests). The test fixtures in `fixtures/` and everything else in the repository are not published. Check with `npm pack --dry-run` before the first publish and when changing `files`.
