# @notti/cli

[![Checks](https://github.com/zeeplabs/zeep-notti-cli/actions/workflows/checks.yml/badge.svg)](https://github.com/zeeplabs/zeep-notti-cli/actions/workflows/checks.yml)
[![npm version](https://img.shields.io/npm/v/@notti/cli.svg)](https://www.npmjs.com/package/@notti/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

Command line for [Notti](https://zeepnotti.app). It publishes **Live updates**: signed JavaScript bundles that your React Native app downloads and applies on its next cold start, without a store release.

> Status: beta (0.x). The command surface may change between minor versions.

## Requirements

- Node.js 20 or newer.
- React Native 0.83 or newer (bare or Expo SDK 55+ prebuild), New Architecture, Hermes.
- `expo-updates` must not be installed. Notti Live updates and `expo-updates` are mutually exclusive.

## Install

```sh
npm install --save-dev @notti/cli
```

## Commands

The `ota` command group manages Live updates.

### Create a signing key

```sh
notti ota keys generate --out notti-live-updates.private.pem
```

Writes an ECDSA P-256 private key (PKCS#8 PEM, mode 0600) and prints the public key and its `key_id`. It refuses to overwrite an existing file and makes no network call. Register the public key on your App in the Notti dashboard and embed it in your app binary.

### Publish a Live update

Run it from the React Native project root, once per platform:

```sh
export NOTTI_API_KEY=...        # the App REST key
export NOTTI_APP_ID=...         # the App ID
export NOTTI_OTA_PRIVATE_KEY=./notti-live-updates.private.pem

notti ota release --platform android --runtime-version 1.4.0 --channel production
```

| Option | Meaning |
| --- | --- |
| `--platform <ios\|android>` | Required. |
| `--runtime-version <v>` | Required. Runtime version of the binaries this release targets. |
| `--channel <c>` | Channel to serve on. Default `production`. |
| `--rollout <1-100>` | Share of devices that receive it. Server default 100. |
| `--mandatory` | Mark the release as mandatory. |
| `--private-key <path>` | Signing key. Or `NOTTI_OTA_PRIVATE_KEY`, as a path or as the PEM itself. |
| `--api-key <key>` | App REST key. Or `NOTTI_API_KEY`. |
| `--app-id <id>` | App ID. Or `NOTTI_APP_ID`. |
| `--base-url <url>` | Notti server. Default `https://app.zeepnotti.app`; set it for self-hosted. |
| `--entry-file <path>` | JS entry. Bare default `index.js`; Expo resolves its own. |
| `--dry-run` | Build and sign without uploading. |

The command bundles with `react-native bundle` (bare) or `expo export:embed` (Expo), compiles to Hermes bytecode with the project's `hermesc`, builds a `tar.gz` archive, signs the manifest, uploads the archive and creates the release. Server errors are printed as `code: message` with a non-zero exit. The names (never the values) of `EXPO_PUBLIC_*` variables are listed so you can compare them with your binary build.

## Security

- The signing private key never leaves your machine. The CLI does not send the key, its path or its contents to Notti, and never prints it.
- The REST API key is read from `--api-key` or `NOTTI_API_KEY`. The CLI never writes it to disk and never prints it.

## Reporting vulnerabilities

Do not open a public issue. See [SECURITY.md](./SECURITY.md) for how to report privately.

## Development

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm build
node dist/cli.js --version
```

`pnpm fixtures` regenerates `fixtures/ota/`: signed manifest and archive vectors (valid and tampered) that the SDK test suites consume.

### Clean-room rule

No code from CodePush, hot-updater, expo-updates or Revopush (including their CLIs) may be copied, adapted or added as a dependency. Every line here is written from scratch. Reading their public documentation for behavior is fine; reading or porting their source is not.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md) first. Releases are described in [RELEASING.md](./RELEASING.md).

## License

[MIT](./LICENSE)
