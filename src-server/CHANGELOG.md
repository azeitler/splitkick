# Splitkick server changelog

The headless server `splitkick-server` has its own pre-release track until it
is tested. The desktop app does not install it (Install via SSH is off) and
desktop releases do not carry it. Changes to the desktop app are in the
top-level `CHANGELOG.md`.

## [1.0.0-pre.1] - unreleased

- **Splitkick server.** Every release now ships the headless server
  `splitkick-server` for Linux (amd64, arm64), its self-update feed
  `server-latest.json`, and the Docker image `ghcr.io/azeitler/splitkick-server`.
  It reports the release version, updates itself only from Splitkick releases,
  and uses port 3460, the unit `splitkick-server.service` and the data folder
  `app.splitkick.desktop`. Install it with `scripts/install-splitkick-server.sh`
  (the SHA-256 check is now required). An upstream `jean-server` on the same
  host is left alone.
- **Install via SSH is back.** Server connections and the onboarding's "Local
  or Remote" step install the server of this app's release over SSH again. The
  access token no longer appears in the argument list of any process on the
  remote host, and the install log masks it. Closes #105
