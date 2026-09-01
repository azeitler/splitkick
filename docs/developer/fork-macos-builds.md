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
| `scripts/jeanz-version.mjs`          | Resolves the next release version                                     |
| `src/lib/release-url.ts`             | Points the title bar version badge at the right repository            |
| `.github/workflows/preflight.yml`    | Build, sign, notarize and publish                                     |
| `src/test/tauri-fork-config.test.ts` | Guards the overlay against dropped fields                             |

Two rules apply to the overlay:

- **Arrays are replaced, not merged.** The overlay repeats the complete window
  block for that reason. `tauri.windows.conf.json` does the same.
- **Do not rename the overlay to `tauri.macos.conf.json`.** Tauri applies that
  filename automatically to every macOS build, including the official one.

## Which workflows run

The fork reuses the existing workflows instead of adding new ones. They are
scoped down to macOS on Apple Silicon, which is the only platform this fork
ships.

`CI Build` calls `Preflight` with `publishFlavor: true`. Preflight runs the
usual gate - typecheck, lint, clippy, frontend tests, Rust tests - and its last
step normally compiles the application with `--no-bundle` and throws the binary
away. With `publishFlavor` set, that step instead builds the JeanZ bundle,
signs it, notarizes it and publishes a release. It is the same compile on the
same runner, so the application is built once.

| Workflow             | State                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| CI Build / Preflight | Active, macOS arm64 only                                                                                       |
| Release Jean         | Active, macOS arm64 only. Skips `-z` tags, and the Homebrew tap job is off because the tap lives in coollabsio |
| Server Release       | Manual only; the `release: published` trigger is removed                                                       |

`Release Jean` and `Server Release` both triggered on `release: published`,
which every JeanZ build fires. Without the guards, one push would have started
a second, four-platform build.

Every removed platform is commented out in the matrix, not deleted. Restore an
entry to bring a platform back; all steps are still platform-aware.

## Version numbers

A JeanZ build carries the upstream product version plus this fork's own patch
suffix:

```
0.1.73-z.1    0.1.73-z.2    0.2.0-z.3    0.2.0-z.4
```

The suffix is a semver prerelease field, so the version stays valid semver.
Tauri writes it into the bundle, which means the title bar, `getVersion()` and
the Finder all show the JeanZ version and not the upstream one.

Note that this is a semver prerelease _field_, not a GitHub prerelease. The
release itself is a full release.

**The dot in `-z.4` is required.** The updater only offers a build when its
version is semver-greater than the installed one, and semver compares a
prerelease identifier that contains a letter as ASCII text. An undotted `z10`
would therefore sort _below_ `z9`, and the in-app update would go quiet after
the ninth build. Split into the two identifiers `z` and `4`, the number is
compared as a number and the order holds forever.
`scripts/jeanz-version.test.mjs` checks 40 consecutive builds against that
rule.

On macOS the version becomes `CFBundleShortVersionString` and
`CFBundleVersion`. Apple documents both as dot-separated digits, but that rule
is enforced by App Store Connect, not by codesign or the notary service, and
JeanZ is distributed directly. Should notarization ever reject the suffix, set
`bundle > macOS > bundleVersion` to the plain upstream version in the overlay.

The counter is global and never restarts. A higher `-z` is therefore always the
newer build, even when upstream jumps several versions between two JeanZ
builds. `scripts/jeanz-version.mjs` resolves it: it reads the upstream version
from `src-tauri/tauri.conf.json`, reads the existing tags with
`git ls-remote --tags origin`, and adds one to the highest `-z` it finds. CI
runs it before the build, because the version is compiled into the bundle, and
passes the result to `tauri build` as a second `-c` layer on top of the flavor
overlay.

Two builds that resolve the same number would collide on the tag, and the
second one fails at the publish step. `CI Build` cancels a running job when the
next push arrives, so this needs two pushes within one build to happen. Re-run
the failed job to give it the next free number.

Local builds do not get a suffix. They use the plain upstream version, because
nothing is published.

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

Every push to `main` publishes a full release - not a prerelease - tagged
`v<version>` and marked as the latest one. The asset name is constant, so this
URL always serves the newest build:

<https://github.com/azeitler/jean/releases/latest/download/JeanZ_macos_arm64.dmg>

The tagged URL of one specific build is
`https://github.com/azeitler/jean/releases/download/v0.1.73-z.1/JeanZ_macos_arm64.dmg`.

The build is Apple Silicon only. The release notes state the upstream version,
the commit and whether the build is notarized.

## Signing secrets

CI signs and notarizes when these repository secrets exist. The build step
degrades instead of failing: with no certificate it uses the overlay's ad-hoc
identity, and with a certificate but no notarization credentials it produces a
signed build. The "Report signature status" step states which of the three
results you got.

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

Two more secrets sign the in-app update. They are read as a pair; with either
one missing the build still publishes its DMG, but without update artifacts.

| Secret                               | Content                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `JEANZ_UPDATER_PRIVATE_KEY`          | Content of the updater private key file, one base64 line |
| `JEANZ_UPDATER_PRIVATE_KEY_PASSWORD` | Password of that key                                     |

The key must have a password. Tauri rejects an empty one and then falls back to
prompting on a terminal that a runner does not have, which fails the build
rather than degrading.

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

## The updater targets this fork

The app checks for updates five seconds after launch and from "Check for
Updates…". Upstream points that check at coolLabs' `latest.json` and verifies
it with coolLabs' public key. JeanZ keeps the same bundle identifier, so an
unchanged check would verify successfully and quietly replace JeanZ with the
official Jean. **Endpoint and key therefore have to move together**, and the
overlay changes both:

```json
"plugins": {
  "updater": {
    "endpoints": ["https://github.com/azeitler/jean/releases/latest/download/latest.json"],
    "pubkey": "<the fork's minisign public key>"
  }
}
```

What a build publishes:

| Asset                          | Role                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| `JeanZ_macos_arm64.dmg`        | First install, dragged to Applications by hand              |
| `JeanZ_macos_arm64.app.tar.gz` | What the updater downloads and unpacks over the running app |
| `latest.json`                  | Version, publication date, download URL and signature       |

The installed app polls `releases/latest/download/latest.json`. That URL
resolves to the newest release because the publish step passes `--latest`, so
`latest.json` has to be attached to every release. `tauri-action` would write
that file, but this fork calls `tauri build` directly, so the "Write
latest.json" step assembles it from the `.sig` that the bundler produced.

The signature is a minisign signature over the BLAKE2b hash of the tarball. The
updater checks it against the `pubkey` in the overlay before it replaces
anything, so a release asset that was swapped out cannot install.

`createUpdaterArtifacts` stays **off** in the overlay and CI turns it on with a
third `-c` layer when the key is present. Tauri fails a build that has a
`pubkey` configured and asks for updater artifacts without a private key, and
leaving it on would break `scripts/build-fork-macos.sh` on any machine without
the key.

### Where the key lives

The private half is not in this repository. It sits next to the Apple signing
material in `.local-signing/`, which `.git/info/exclude` and the folder's own
`.gitignore` both hide from git, and it is mirrored into 1Password.

```
.local-signing/updater.key            private key, one base64 line
.local-signing/updater.key.password   its password
.local-signing/updater.key.pub        public half, also in the overlay
```

`bash .local-signing/validate.sh` checks the pair: it compares
`updater.key.pub` against `plugins.updater.pubkey` in the overlay and signs a
throwaway file to prove the password still opens the key.
`bash .local-signing/push-secrets.sh` writes both halves to the repository
secrets.

### Rotating or recreating the key

```bash
bun run tauri signer generate -w .local-signing/updater.key -p '<a password>'
```

Put the public half into `plugins.updater.pubkey` in the overlay, run
`push-secrets.sh`, then `validate.sh`. The bundler also warns when key and
pubkey disagree, so a mismatch shows up in the build log rather than in a
failed update.

Installed copies keep the old key until they update once, so publish at least
one release that is still signed with the old key before you retire it. There
is no recovery if the key is lost: every installed JeanZ then needs a manual
DMG download.

### The version badge

The `v<version>` chip at the right of the title bar opens the release it was
built from. Upstream hard-codes that link at coolLabs, which has no tag for a
JeanZ version and would 404 on every build, so the link is now derived from the
version itself in `src/lib/release-url.ts`: a `-z.<n>` suffix points at this
fork, anything else stays upstream.

That is the one place where the fork edits shared source instead of the
overlay, because a config file cannot express it. The rule is deliberately
narrow so upstream keeps working unchanged - upstream never produces a `-z.<n>`
version, so it always takes the unchanged branch.

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
