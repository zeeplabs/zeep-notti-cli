# notti-cli

[![Checks](https://github.com/zeeplabs/zeep-notti-cli/actions/workflows/checks.yml/badge.svg)](https://github.com/zeeplabs/zeep-notti-cli/actions/workflows/checks.yml)
[![npm version](https://img.shields.io/npm/v/notti-cli.svg)](https://www.npmjs.com/package/notti-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

Command line for [Notti](https://zeepnotti.app). It publishes **Live updates**: signed JavaScript bundles that your React Native app downloads and applies on its next cold start, without a store release.

> Status: beta (0.x). The command surface may change between minor versions.

The CLI is one of three pieces. It builds, signs and publishes a release from your project, locally or in CI. The native SDK in your app ([`react-native-notti-ota`](https://github.com/zeeplabs/zeep-notti-react-native-ota)) picks the bundle, verifies the signature on the device and rolls back a bad update. The Notti dashboard lists releases and manages the signing keys.

## Table of contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Commands](#commands)
- [Publishing from CI (GitHub Actions)](#publishing-from-ci-github-actions)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Reporting vulnerabilities](#reporting-vulnerabilities)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Requirements

- Node.js 20 or newer.
- React Native 0.83 or newer (bare, or Expo SDK 55+ with prebuild), New Architecture, Hermes.
- `hermes-compiler` (ships with React Native) and, for a bare project, `@react-native-community/cli`.
- `expo-updates` must not be installed. Notti Live updates and `expo-updates` are mutually exclusive: disabling it is not enough, uninstall it and rebuild the app.
- A Notti App on a plan (or a self-hosted license) that includes Live updates.

## Install

```sh
npm install --save-dev notti-cli
npx notti --version
```

Run the CLI from the root of your React Native project, with the project dependencies installed.

## Quick start

From zero to a first published update.

**1. Collect the App values.** In the Notti dashboard, open the App's **Settings > Keys & IDs** and copy the **App ID**, the **client key** (goes in the app) and the **REST key** (secret, used by the CLI).

**2. Generate a signing key.**

```sh
npx notti ota keys generate --out notti-live-updates.private.pem
```

It writes the private key and prints the `key_id` and the public key PEM. Never commit the private key.

**3. Register the public key** on the App: dashboard, **Live updates > Signing keys > Add key**, and paste the PEM. The server refuses releases signed with a key it does not know.

**4. Install the SDK in your app and embed the public key.** The SDK lives in [zeeplabs/zeep-notti-react-native-ota](https://github.com/zeeplabs/zeep-notti-react-native-ota); its README has the full install guide, including the bare React Native setup.

```sh
# Expo (SDK 55+ with prebuild)
npx expo install react-native-notti-ota react-native-notti-ota-expo

# Bare React Native
npm install react-native-notti-ota
cd ios && pod install
```

With Expo, remove `expo-updates` and add the config plugin to `app.json`. The `runtimeVersion` and `channel` here must match what you pass to the CLI, and `publicKeys` is the PEM from step 2:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-notti-ota",
        {
          "appId": "<app id>",
          "baseUrl": "https://app.zeepnotti.app",
          "clientKey": "<client key>",
          "channel": "production",
          "runtimeVersion": "1.4.0",
          "publicKeys": [
            "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
          ]
        }
      ]
    ]
  }
}
```

**5. Build and install a Release binary.** Live updates only act in Release builds; debug builds always load from Metro. Use the runtime version you configured in step 4.

**6. Publish an update.** Change some JavaScript, then run once per platform:

```sh
export NOTTI_API_KEY=...        # the App REST key
export NOTTI_APP_ID=...         # the App ID
export NOTTI_OTA_PRIVATE_KEY=./notti-live-updates.private.pem

npx notti ota release --platform android --runtime-version 1.4.0 --channel production
npx notti ota release --platform ios --runtime-version 1.4.0 --channel production
```

Add `--dry-run` first to build and sign without uploading. For a self-hosted Notti, add `--base-url https://notti.example.com`.

**7. See it on the device.** Open the installed app, close it and open it again. The SDK downloads and verifies the update in the background and loads it on the next cold start. The release then shows up in the dashboard under **Live updates > Releases**.

## Concepts

- **Signing key.** Releases are signed with ECDSA P-256. The private key stays with you (your machine or CI secrets). Notti and the app only see public keys. The `key_id` is the first 8 bytes of the SHA-256 of the 65-byte uncompressed public point, in lowercase hex. A device trusts only the public keys embedded in its own binary, so to rotate, ship a binary that embeds both the old and the new key before you sign with the new one.
- **Runtime version.** A string of 1 to 64 characters that says which binaries a release can run on. Change it whenever native code changes (a new native module, an SDK or React Native upgrade). The server only offers a release to devices with the same runtime version. If you publish for a runtime version no binary has, no device receives it.
- **Channel.** A name a release is published to and a binary is pinned to (`[a-z0-9-]`, 1 to 32 characters, default `production`). A binary reads one channel from its configuration and cannot change it at runtime.
- **Rollout.** `--rollout 10` offers the release to about 10% of devices. Raising it only adds devices. Lowering it stops offering the release to devices that do not have it yet, but never pulls a device off a release it already runs. Omit it for the server default of 100.
- **Mandatory.** `--mandatory` marks the release as mandatory. The SDK reports it to your app, which decides how to ask the user to restart; the SDK never restarts the app itself.
- **Hermes bytecode version.** The CLI compiles the bundle with the `hermesc` that ships with the project's React Native and records the bytecode version in the manifest. Build from the same React Native version as your binary.

## Commands

The `ota` command group manages Live updates. Promoting a release between channels and listing, disabling or changing the rollout of releases are not available in the CLI; use the dashboard for those.

### `notti ota keys generate`

```sh
notti ota keys generate --out notti-live-updates.private.pem
```

Writes an ECDSA P-256 private key (PKCS#8 PEM, mode 0600) and prints the public key and its `key_id`. It refuses to overwrite an existing file and makes no network call. Register the public key on your App in the Notti dashboard and embed it in your app binary.

| Option         | Meaning                                                                   |
| -------------- | ------------------------------------------------------------------------- |
| `--out <path>` | Where to write the private key. Default `notti-live-updates.private.pem`. |

### `notti ota release`

Bundles, signs and publishes one release for one platform and one channel. Run it once per platform:

```sh
export NOTTI_API_KEY=...        # the App REST key
export NOTTI_APP_ID=...         # the App ID
export NOTTI_OTA_PRIVATE_KEY=./notti-live-updates.private.pem

notti ota release --platform android --runtime-version 1.4.0 --channel production
```

| Option                      | Meaning                                                                    |
| --------------------------- | -------------------------------------------------------------------------- |
| `--platform <ios\|android>` | Required.                                                                  |
| `--runtime-version <v>`     | Required. Runtime version of the binaries this release targets.            |
| `--channel <c>`             | Channel to serve on. Default `production`.                                 |
| `--rollout <1-100>`         | Share of devices that receive it, an integer. Server default 100.          |
| `--mandatory`               | Mark the release as mandatory.                                             |
| `--private-key <path>`      | Signing key. Or `NOTTI_OTA_PRIVATE_KEY`, as a path or as the PEM itself.   |
| `--api-key <key>`           | App REST key. Or `NOTTI_API_KEY`.                                          |
| `--app-id <id>`             | App ID. Or `NOTTI_APP_ID`.                                                 |
| `--base-url <url>`          | Notti server. Default `https://app.zeepnotti.app`; set it for self-hosted. |
| `--entry-file <path>`       | JS entry. Bare default `index.js`; Expo resolves its own.                  |
| `--dry-run`                 | Build and sign without uploading.                                          |

The App ID is always required (flag or variable), even for a dry run, because it is part of the signed manifest. It must be a UUID; the CLI lowercases it. The REST key is required except with `--dry-run`, and a dry run does not contact the server.

What it does:

1. Checks the project: React Native 0.83+ and no `expo-updates`.
2. Bundles in release mode with `react-native bundle` (bare) or `expo export:embed` (Expo), and compiles the bundle to Hermes bytecode with the project's `hermesc`.
3. Builds a `tar.gz` archive (limited to 50 MiB) and signs the manifest with your key.
4. Unless `--dry-run`: lists the App's registered keys, asks for an upload URL, uploads the archive to storage (the REST key is never sent there) and creates the release.

It also prints the names (never the values) of the `EXPO_PUBLIC_*` variables inlined in the bundle, so you can compare them with your binary build.

### Exit codes

| Code | Meaning                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| `0`  | Success. Also `--help` and `--version`.                                                                        |
| `1`  | Any failure: invalid usage or option, a missing or invalid input, a failed build step, or an error from Notti. |

Failures print to stderr as `error: <message>`. Server errors have the form `error: <code>: <message>`.

## Publishing from CI (GitHub Actions)

The CLI reads everything from flags or environment variables, so a CI job only needs the three secrets below.

| Name                    | Where                         | Content                                                                                                                                                                                                |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NOTTI_API_KEY`         | Repository secret             | The App REST key.                                                                                                                                                                                      |
| `NOTTI_OTA_PRIVATE_KEY` | Repository secret             | The private key **PEM itself** (the whole file, including the `-----BEGIN` and `-----END` lines). A value that starts with `-----BEGIN` is used as the key; any other value is treated as a file path. |
| `NOTTI_APP_ID`          | Repository variable or secret | The App ID.                                                                                                                                                                                            |

```yaml
name: Publish Live update
on:
  workflow_dispatch:

jobs:
  live-update:
    runs-on: macos-latest
    strategy:
      fail-fast: false
      matrix:
        platform: [ios, android]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: >
          npx notti ota release
          --platform ${{ matrix.platform }}
          --runtime-version 1.4.0
          --channel production
        env:
          NOTTI_API_KEY: ${{ secrets.NOTTI_API_KEY }}
          NOTTI_APP_ID: ${{ vars.NOTTI_APP_ID }}
          NOTTI_OTA_PRIVATE_KEY: ${{ secrets.NOTTI_OTA_PRIVATE_KEY }}
```

Notes:

- Keep the private key and the REST key in CI secrets only. Never commit the key, print it in logs or pass it as a command-line argument; prefer the environment variable over `--private-key` and `--api-key`.
- `--runtime-version` and `--channel` must match the binary your users run. Hard-code them or read them from the same source as your app configuration.
- The job runs `npm ci` first because the CLI needs the project dependencies installed. It publishes one release per matrix entry, so the two platforms are independent: one can fail while the other succeeds.
- Add `--dry-run` to validate the setup without publishing. In that mode the REST key is not needed.
- Pin third-party actions to a commit SHA if your organization requires it.

## Troubleshooting

Messages below are printed by the CLI. Server codes are the ones the Notti API returns; the right-hand column says what to check.

| Message                                                                                                           | What to check                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `no app ID: pass --app-id <id> or set NOTTI_APP_ID`                                                               | Set the App ID. It is required even with `--dry-run`.                                                 |
| `the app ID must be a lowercase UUID`                                                                             | Copy the App ID from **Settings > Keys & IDs** again.                                                 |
| `no API key: pass --api-key <key> or set NOTTI_API_KEY (the App REST key)`                                        | Set the REST key. Only `--dry-run` runs without it.                                                   |
| `no signing key: pass --private-key <path> or set NOTTI_OTA_PRIVATE_KEY`                                          | Pass the key file path, or set the variable to a path or to the PEM.                                  |
| `cannot read the private key file given by --private-key` (or `NOTTI_OTA_PRIVATE_KEY`)                            | The path does not exist or is unreadable. The message never prints the path itself.                   |
| `the signing key is not a readable PEM private key`                                                               | The value is not a PKCS#8 PEM. In CI, check the secret holds the whole file.                          |
| `the signing key must be an ECDSA P-256 private key (create one with notti ota keys generate)`                    | Another key type or curve. Generate a new key.                                                        |
| `<path> already exists; refusing to overwrite a signing key`                                                      | `keys generate` never overwrites. Choose another `--out` or remove the file on purpose.               |
| `no package.json in <dir>; run notti from your React Native project root`                                         | Change directory to the project root.                                                                 |
| `expo-updates is installed in this project. Notti Live updates and expo-updates are mutually exclusive: ...`      | Uninstall `expo-updates` and rebuild the app. Disabling it is not enough.                             |
| `react-native is not installed in <dir>; install the project dependencies first`                                  | Run your package manager install first.                                                               |
| `Live updates need React Native 0.83 or newer; this project has react-native <version>`                           | Upgrade React Native.                                                                                 |
| `@react-native-community/cli is not installed; react-native bundle needs it`                                      | Bare project: install it.                                                                             |
| `expo is not installed; install the project dependencies first`                                                   | Expo project: install the dependencies.                                                               |
| `hermesc not found: Live updates need the Hermes compiler that ships with react-native (package hermes-compiler)` | Reinstall the dependencies; check `hermes-compiler` is present.                                       |
| `react-native bundle failed with exit code <n>` or `expo export:embed failed with exit code <n>`                  | The bundler failed. Its own output is printed above the error.                                        |
| `<file> is not a Hermes bytecode bundle: ...`                                                                     | `hermesc` did not produce Hermes bytecode. Check the React Native and Hermes setup.                   |
| `the archive is <n> bytes; Live updates archives are limited to <max> bytes (50 MiB)`                             | Reduce assets and bundle size.                                                                        |
| `--rollout must be an integer from 1 to 100`                                                                      | Use a whole number between 1 and 100.                                                                 |
| `ota_no_public_key: this app has no Live updates public key; register the public key of <key_id> first`           | Register the public key in **Live updates > Signing keys**.                                           |
| `ota_unknown_key: key <key_id> is not registered on this app`                                                     | You signed with a key that is not registered on this App. Compare the `key_id`.                       |
| `ota_not_in_plan`                                                                                                 | The plan has no Live updates (HTTP 402).                                                              |
| `ota_release_limit_reached`                                                                                       | The App published all its releases this UTC month. The message includes the limit and the reset date. |
| `subscription_inactive`                                                                                           | The subscription is not active (HTTP 402).                                                            |
| `ota_storage_not_configured`                                                                                      | Self-hosted: configure object storage in Company settings (HTTP 409).                                 |
| `ota_invalid_signature`                                                                                           | The server could not verify the signature with the registered key.                                    |
| `ota_upload_invalid`                                                                                              | The upload is missing, used, expired or belongs to another App. Run the command again.                |
| `ota_artifact_mismatch`                                                                                           | The stored archive does not match the manifest size or hash.                                          |
| `ota_release_exists`                                                                                              | A release with this ID already exists (HTTP 409).                                                     |
| `ota_storage_error`                                                                                               | Object storage did not respond (HTTP 502).                                                            |
| `invalid_content`, `invalid_body`                                                                                 | The server refused the manifest or the request body (HTTP 422).                                       |
| `forbidden`, `forbidden_role`                                                                                     | The key cannot manage Live updates for this App (HTTP 403).                                           |
| `network_error: could not reach <url>: ...`                                                                       | Check `--base-url` and the network.                                                                   |
| `network_error: the archive upload failed: ...`                                                                   | The archive upload to storage failed. Check the network and try again.                                |
| `upload_failed: storage answered HTTP <status> to the archive upload`                                             | Storage refused the upload. Self-hosted: check the S3 settings.                                       |
| `invalid_response: ... answered HTTP <status> without JSON`                                                       | The server (or a proxy) answered without JSON. Check `--base-url`.                                    |
| `http_<status>: unexpected response from the server`                                                              | A non-Notti error response, such as one from a proxy.                                                 |
| `the archive is <n> bytes; the server accepts at most <max>`                                                      | The server's upload limit is lower than the archive size.                                             |

The update is published but a device does not get it:

- The binary's runtime version and channel must equal the release's (`--runtime-version`, `--channel`).
- The update loads on the next cold start after the SDK downloaded it, not in the running session.
- Debug builds always load from Metro. Test with a Release build.
- Each device event, with its reason, shows on the release in the dashboard under **Live updates > Releases**. Start there.

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
