# Changelog

# 0.1.0 (2026-11-26)

First release (beta).

### Features

* `notti ota keys generate`: create an ECDSA P-256 signing key for Live updates and print its public key and `key_id`.
* `notti ota release`: bundle a React Native or Expo app, compile it to Hermes bytecode, sign the manifest and publish the Live update to a Notti App (channel, rollout and mandatory flag supported; `--dry-run` builds and signs without uploading).

### Notes

* Beta: the command surface and flags may change in 0.x minor versions.
* Requires Node.js 20 or newer. Works with React Native 0.83+ (bare or Expo SDK 55+ prebuild); `expo-updates` must not be installed.
