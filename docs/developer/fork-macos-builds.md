# JeanZ macOS builds

JeanZ is this fork's build flavor of Jean. It has its own name, its own icon and
its own release, but it is the same application. Every push to `main` builds it,
signs it and publishes it.

## Why a flavor instead of a branch of the config

`src-tauri/tauri.conf.json` is identical to upstream. Editing it would create a
merge conflict on every `git merge upstream/main`. Tauri supports build flavors
through `tauri build -c <file>`, which merges an overlay into the base config, so
the flavor lives in a separate file that upstream never touches.

| File                                 | Role                                                                  |
| ------------------------------------ | --------------------------------------------------------------------- |
| `src-tauri/tauri.fork.conf.json`     | The overlay: name, window title, icons, updater and signing overrides |
| `src-tauri/icons-fork/`              | The JeanZ icon set                                                    |
| `scripts/generate-fork-icon.mjs`     | Regenerates that icon set                                             |
| `scripts/build-fork-macos.sh`        | Local build, identical to CI                                          |
| `.github/workflows/macos-build.yml`  | Build, sign, notarize and publish                                     |
| `src/test/tauri-fork-config.test.ts` | Guards the overlay against dropped fields                             |

Two rules apply to the overlay:

- **Arrays are replaced, not merged.** The overlay repeats the complete window
  block for that reason. `tauri.windows.conf.json` does the same.
- **Do not rename the overlay to `tauri.macos.conf.json`.** Tauri applies that
  filename automatically to every macOS build, including the official one.

## Build it locally

```bash
bash scripts/build-fork-macos.sh
```

The result is
`src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/JeanZ_<version>_aarch64.dmg`.
The overlay sets the ad-hoc signing identity `-`, so the build needs no Apple
account. macOS then shows a Gatekeeper warning. Remove the quarantine flag to
open it:

```bash
xattr -dr com.apple.quarantine /Applications/JeanZ.app
```

The official app still builds unchanged, because it does not use the `-c` flag:

```bash
bun run tauri:build:fast
```

## Download the CI build

The workflow recreates a prerelease on every push, so the URL never changes:

<https://github.com/azeitler/jean/releases/download/main-build/JeanZ_macos_arm64.dmg>

The build is Apple Silicon only. The release notes state the version, the commit
and whether the build is notarized.

## Signing secrets

CI signs and notarizes when these repository secrets exist. Without them the
build still succeeds, but ad-hoc signed.

| Secret                       | Content                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `APPLE_CERTIFICATE`          | Base64 of a **Developer ID Application** `.p12` (certificate plus private key) |
| `APPLE_CERTIFICATE_PASSWORD` | Password of that `.p12`                                                        |
| `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: <name> (<team id>)`                                 |
| `APPLE_ID`                   | Apple account email                                                            |
| `APPLE_PASSWORD`             | App-specific password from account.apple.com                                   |
| `APPLE_TEAM_ID`              | 10-character team ID                                                           |

`APPLE_SIGNING_IDENTITY` is not optional. The base config pins coolLabs'
identity, and the bundler rejects an `APPLE_CERTIFICATE` that does not match the
configured identity.

`TAURI_SIGNING_PRIVATE_KEY` is **not** used. That key signs updater artifacts,
and the overlay disables them.

## JeanZ and Jean share one data directory

The bundle identifier stays `com.jean.desktop`. Tauri derives the app-data
directory from it, so JeanZ reads and writes
`~/Library/Application Support/com.jean.desktop`. Projects, sessions,
preferences and the Jean-managed CLI installs carry over, and nothing has to be
authenticated again.

**Do not run both apps at the same time.** That state is plain JSON
(`projects.json`, `preferences.json`, `ui-state.json`) protected by an
in-process lock only. Two processes that write it together lose changes.

If an isolated profile is ever needed: `jean-core` already reads `JEAN_DATA_DIR`
in `RuntimeContext::from_environment()`, but the desktop app calls
`RuntimeContext::new()` with the identifier-derived path
(`src-tauri/src/lib.rs`). Honouring the variable there as well would be a
three-line change.

## The updater is switched off

The base config points the updater at upstream's `latest.json` and carries
upstream's public key. JeanZ keeps the same identifier, so an update check would
verify successfully and replace JeanZ with the official Jean. The overlay
therefore sets `plugins.updater.endpoints` to an empty list. "Check for
Updates…" reports an error instead, which is the intended behaviour.

To give JeanZ real updates later, generate a key pair with
`bun run tauri signer generate`, publish `latest.json` from this repository, and
put the fork's public key and endpoint into the overlay.

## Replace the icon

The icon is derived from `src-tauri/icons/icon.png` by rotating the hue.

```bash
node scripts/generate-fork-icon.mjs           # keep the current artwork
node scripts/generate-fork-icon.mjs --force   # derive it again
```

To use your own artwork, put a 1024x1024 PNG at
`src-tauri/icons-fork/app-icon.png` and run the script without `--force`.
Commit the generated files: CI does not run the script and does not have
ImageMagick.
