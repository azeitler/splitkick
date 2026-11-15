# Splitkick server changelog

The headless server `splitkick-server` has its own pre-release track until it
is tested. The desktop app does not install it (Install via SSH is off) and
desktop releases do not carry it. Changes to the desktop app are in the
top-level `CHANGELOG.md`.

## [1.0.0-pre.1] - unreleased

First pre-release of the headless server. It is not tested enough for daily
use yet.

- **Splitkick server for Linux.** `splitkick-server` for amd64 and arm64, as
  tarballs with a `.sha256` file on the GitHub pre-release
  `splitkick-server-v1.0.0-pre.1`, and as the Docker image
  `ghcr.io/azeitler/splitkick-server:1.0.0-pre.1` (no `:latest`). It uses port
  3460, the unit `splitkick-server.service` and the data folder
  `app.splitkick.desktop`. An upstream `jean-server` on the same host is left
  alone.
- **Own version.** `splitkick-server --version` prints `Splitkick
1.0.0-pre.1`. `/api/auth` reports it as `serverVersion`, next to
  `appVersion`, the version of the app code the server is built from. The
  desktop app compares only `appVersion`, so it shows no version mismatch for
  a server built from its own app version.
- **Installer.** `scripts/install-splitkick-server.sh --version 1.0.0-pre.1`
  installs from the `splitkick-server-v1.0.0-pre.1` release (system or
  `--user-install`). Without `--version` it takes the newest
  `splitkick-server-v*` release. The SHA-256 check is required: a missing or
  wrong checksum stops the install. `--token-file` keeps the access token out
  of every process argument list (#105).
- **No self-update for pre-releases.** The update check says to update with
  the installer and `--version`. It does not read `server-latest.json`, which
  the release still carries.
- The desktop app does not install the server (Install via SSH stays off) and
  desktop releases do not carry it.
