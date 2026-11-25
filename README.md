# @notti/cli

Command line for [Notti](https://zeepnotti.app). It publishes **Live updates**: signed JavaScript bundles that your React Native app downloads and applies on its next cold start, without a store release.

> Status: in development. Not published to npm yet.

## Requirements

- Node.js 20 or newer.
- React Native 0.83 or newer (bare or Expo SDK 55+ prebuild), New Architecture, Hermes.
- `expo-updates` must not be installed. Notti Live updates and `expo-updates` are mutually exclusive.

## Install

```sh
npm install --save-dev @notti/cli
```

## Commands

```sh
notti --version
notti ota --help
```

The `ota` command group manages Live updates.

## Security

- The signing private key never leaves your machine. The CLI does not send the key, its path or its contents to Notti, and never prints it.
- The REST API key is read from `--api-key` or `NOTTI_API_KEY`. The CLI never writes it to disk and never prints it.

## Development

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm build
node dist/cli.js --version
```

### Clean-room rule

No code from CodePush, hot-updater, expo-updates or Revopush (including their CLIs) may be copied, adapted or added as a dependency. Every line here is written from scratch. Reading their public documentation for behavior is fine; reading or porting their source is not.

## License

MIT
