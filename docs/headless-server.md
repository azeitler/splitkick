# Splitkick Headless Server

Splitkick can run as a browser-accessible Tokio/Axum server with no Tauri, WebView,
GTK, or display-server dependency. `jean-core` owns shared state, commands,
events, persistence, projects, chat backends, terminals, background work, and
the HTTP/WebSocket protocol. `src-server` is the standalone server adapter
(binary `splitkick-server`).

The server is **not** part of the desktop releases, and the desktop app does
not install it (Install via SSH is off). It has its own pre-release track until
it is tested:

- Version: `src-server/Cargo.toml` (`1.0.0-pre.N`), changes in
  `src-server/CHANGELOG.md`. `splitkick-server --version` prints it.
- GitHub pre-release `splitkick-server-v<version>` (the desktop app's tags are
  `splitkick-v<version>`). It is never marked latest. It carries
  `splitkick-server-linux-amd64-<version>.tar.gz`,
  `splitkick-server-linux-arm64-<version>.tar.gz` (each with a `.sha256`) and
  `server-latest.json`.
- `/api/auth` reports `serverVersion` (the server release) and `appVersion`
  (the version of the app code the server is built from). The desktop app
  compares only `appVersion` with its own version, so a server 1.0.0-pre.1
  built from app 1.5.16 does not show a version mismatch in app 1.5.16.

To build it from source: `bun run build`, then
`cargo build --release --manifest-path src-server/Cargo.toml`.

There is no Docker image. The agents (Claude, Codex, …) run on the machine
that runs `splitkick-server` and work in its repos with its tools; in a
container they would see only the container. Install the server on the Linux
host itself.

### Install a pre-release

Give the installer the version. It downloads from the
`splitkick-server-v<version>` release and stops if the SHA-256 file is missing
or does not match:

```bash
curl -fsSL https://raw.githubusercontent.com/azeitler/splitkick/splitkick-server-v1.0.0-pre.1/scripts/install-splitkick-server.sh \
  | sudo bash -s -- --version 1.0.0-pre.1
```

Without `--version`, the installer takes the newest `splitkick-server-v*`
release, pre-releases included (not GitHub's "latest" release, which is the
desktop app). To update a pre-release server, run the installer again with the
new `--version`; pre-releases do not update themselves.

Splitkick's server is not upstream Jean's `jean-server`. It uses its own unit
(`splitkick-server.service`), port (3460), and data folder
(`~/.local/share/app.splitkick.desktop`). An existing `jean-server` install stays
as it is; the two can run on the same host.

## Agent browser (AI + manual login)

splitkick-server has no embedded WebView. For an AI-controlled browser where you log
in manually once and agents reuse cookies, Splitkick uses **vercel-labs/agent-browser**
with a Splitkick-managed Chromium profile (`AGENT_BROWSER_PROFILE` under app data).

- Settings → **MCP Servers** → **Agent Browser** → **Install agent-browser**, then install MCP into backends
- Host prerequisite: `npm` on PATH (Splitkick downloads agent-browser + Chromium into app data)
- Manual fallback: `npm install -g agent-browser && agent-browser install`
- Design: `docs/developer/server-agent-browser.md`

## Host prerequisites

Splitkick checks shared host prerequisites instead of treating them as a Grok-only
concern. Git is required for project and worktree operations. Node.js and npm
are required by Splitkick-managed npm tools such as Grok, PI, Command Code, Kimi
Code, and agent-browser.

On a new server, use the setup prompt to install missing prerequisites
automatically or follow the linked manual instructions. Splitkick intentionally
does not recommend Debian/Ubuntu's `nodejs` package because it can lag supported
Node.js releases. Install a current LTS using the official Node.js installation
page instead: https://nodejs.org/en/download.

Automatic installation always requires explicit confirmation. On supported
Linux hosts it installs Git with the detected system package manager and
Node.js LTS with the installer recommended by the official Node.js download
flow, then verifies `git`, `node`, and `npm` versions.

## Start locally

When running a debug binary directly, build the browser bundle first. Splitkick
embeds `dist/` into the server binary at compile time, so production deploys
only need the compiled binary.

```bash
bun run build
cargo build --manifest-path src-server/Cargo.toml
```

```bash
env -u DISPLAY -u WAYLAND_DISPLAY ./src-server/target/debug/splitkick-server --host 127.0.0.1 --port 3460
curl http://127.0.0.1:3460/healthz
```

You can also run the server entrypoint when packaged/available:

```bash
splitkick-server --host 127.0.0.1 --port 3460
```

For a production single-binary server:

```bash
bun run build
cargo build --release --manifest-path src-server/Cargo.toml
./src-server/target/release/splitkick-server --host 0.0.0.0 --port 3460 --token "$JEAN_TOKEN"
```

After the release build finishes, `dist/` is no longer needed on the target
server. Re-run `bun run build` before compiling whenever frontend code changes.

## Install on a server (release binary + systemd)

Use the production installer to download the latest `splitkick-server` release,
install the binary, write an env file, and register a systemd service.

**Interactive (recommended on a real terminal):** without `-y` / `--host` /
`--port`, the installer asks which interface to bind to (localhost, all
interfaces, primary LAN IP, Tailscale if detected, or a custom address) and
which port to use:

```bash
curl -fsSL https://raw.githubusercontent.com/azeitler/splitkick/main/scripts/install-splitkick-server.sh | sudo bash
```

**Non-interactive:** pass `-y` and optionally predefine bind settings via flags
or env (`JEAN_HOST`, `JEAN_PORT`):

```bash
curl -fsSL https://raw.githubusercontent.com/azeitler/splitkick/main/scripts/install-splitkick-server.sh | sudo bash -s -- -y
```

Or from a clone of this repo:

```bash
sudo ./scripts/install-splitkick-server.sh --host 127.0.0.1 --port 3460 -y
```

Common options:

```bash
# Bind on all interfaces with your own token. --token-file keeps it out of
# `ps`; --token <value> works too, but every user on the host can read it.
(umask 077; openssl rand -base64 32 > token)
sudo ./scripts/install-splitkick-server.sh \
  --host 0.0.0.0 \
  --port 3460 \
  --token-file ./token \
  -y
rm -f token

# Bind only on the machine's Tailscale IP (auto-detected)
sudo ./scripts/install-splitkick-server.sh --host tailscale --port 3460 -y

# Bind only on the primary LAN IPv4
sudo ./scripts/install-splitkick-server.sh --host lan -y

# Install as the current user (user systemd unit under ~/.config/systemd/user)
./scripts/install-splitkick-server.sh --user-install --host 127.0.0.1 -y

# Pin a release (splitkick-server-v<version>)
sudo ./scripts/install-splitkick-server.sh --version 1.0.0-pre.1 -y

# Binary only (no service)
sudo ./scripts/install-splitkick-server.sh --no-service -y
```

`--host` accepts a concrete address or presets: `localhost` / `127.0.0.1`,
`all` / `public` / `0.0.0.0`, `lan` / `primary`, `tailscale` / `ts`, or any IP
or hostname.

Defaults:

| Item        | System install                                               | `--user-install`                                  |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------- |
| Binary      | `/usr/local/bin/splitkick-server`                            | `~/.local/bin/splitkick-server`                   |
| Env file    | `/etc/splitkick-server.env`                                  | `~/.config/splitkick-server/splitkick-server.env` |
| Service     | `splitkick-server.service` (system)                          | `splitkick-server.service` (user)                 |
| Host / port | `127.0.0.1:3460` (or prompted)                               | same                                              |
| Token       | auto-generated (printed once)                                | same                                              |
| Data folder | `/root/.local/share/app.splitkick.desktop` (service user's)  | `~/.local/share/app.splitkick.desktop`            |
| Checksum    | `.sha256` required; a missing or wrong one stops the install | same                                              |

Re-running the installer reuses an existing `JEAN_TOKEN` from the env file unless
you pass `--token`. Data under `SPLITKICK_DATA_DIR` / the default app-data directory is
left intact. Uninstall:

```bash
sudo ./scripts/install-splitkick-server.sh --uninstall -y
```

If systemd is not available, the script still installs the binary + env file and
prints an OpenRC example unit.

## Codex on Linux (bubblewrap sandbox)

Codex's Linux sandbox needs [bubblewrap](https://github.com/containers/bubblewrap)
(`bwrap`) either:

1. **System package** (recommended on servers):

   ```bash
   sudo apt install bubblewrap   # Debian/Ubuntu
   # sudo dnf install bubblewrap  # Fedora/RHEL
   ```

2. **Bundled helper** next to the Codex binary at `codex-resources/bwrap`
   (Splitkick-managed installs download this automatically when available).

Without either, sandboxed shell / `apply_patch` tools fail. Splitkick surfaces a
warning in **Settings → Codex** when bubblewrap is missing.

**Auth on headless/servers:** Splitkick's Codex login uses `codex login --device-auth`
(device code + URL). Browser callback login does not work without a local display.

## Install the local development build

Install the Linux build dependencies once on Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y libssl-dev pkg-config
```

On a Linux host where `splitkick-server.service` already runs the binary at
`/usr/local/bin/splitkick-server`, use:

```bash
bun run install:local:server
tail -f tmp/install-local-server.log
```

The command runs in the background by default. It builds and embeds the current
frontend, compiles `src-server` in release mode, atomically replaces the binary,
and queues a systemd restart. The browser connection will briefly disconnect
while the service restarts. Use `bun run install:local:server:foreground` to
keep build output in the current terminal.

Override the defaults when the service uses a different unit or binary path:

```bash
JEAN_SERVER_INSTALL_PATH=/opt/splitkick/splitkick-server \
JEAN_SERVER_SERVICE=splitkick-dev.service \
bun run install:local:server
```

## Options and environment

| CLI                       | Environment                    | Default                                |
| ------------------------- | ------------------------------ | -------------------------------------- |
| `--headless`              | `JEAN_HEADLESS=1`              | off                                    |
| `--host <addr>`           | `JEAN_HOST`                    | saved preference, normally `127.0.0.1` |
| `--port <port>`           | `JEAN_PORT`                    | `3460`                                 |
| `--token <token>`         | `JEAN_TOKEN`                   | saved/generated token                  |
| `--no-token`              | `JEAN_NO_TOKEN=1`              | off                                    |
| `--allow-unsafe-no-token` | `JEAN_ALLOW_UNSAFE_NO_TOKEN=1` | off                                    |
| `--allow-native-open`     | `JEAN_ALLOW_NATIVE_OPEN=1`     | off (auto-on under WSL)                |
| n/a                       | `JEAN_ALLOWED_ORIGINS`         | same-origin only                       |

By default a token is required (using `--token`, `JEAN_TOKEN`, or an auto-generated one); pass `--no-token` to disable it. `--token` and `--no-token` are mutually exclusive. Splitkick rejects `--no-token` with `--host 0.0.0.0` or `--host ::` unless `--allow-unsafe-no-token` is also set.

### Native open actions (editor / file manager / terminal)

HTTP/WebSocket clients can trigger **Open in editor**, **Open worktrees folder**, and related actions only when native open is allowed:

- **Auto-enabled under WSL** — headless Splitkick inside WSL routes folders through `explorer.exe` and editors through the Linux CLI binaries on PATH (same as #490 / #522).
- **Opt-in elsewhere** — pass `--allow-native-open` or set `JEAN_ALLOW_NATIVE_OPEN=1` for a local headless server that should open host apps.
- **Desktop Web Access** — automatically allowed when the desktop app hosts the HTTP server.
- **Remote/VPS headless** — left off by default so a browser client cannot spawn GUI tools on the server.

## Health checks

- `GET /healthz` - process is alive.
- `GET /readyz` - HTTP server is initialized and WebSocket broadcaster state is ready.

Authenticated endpoints accept either the existing `?token=...` query parameter or an HTTP bearer token:

```bash
curl -H "Authorization: Bearer $JEAN_TOKEN" http://127.0.0.1:3460/api/auth
curl "http://127.0.0.1:3460/api/init?token=$JEAN_TOKEN"
```

The browser UI still uses `/api/init`, `/api/auth`, and `/ws` from the same origin, so reverse proxies do not need to rewrite paths.

`POST /api/invoke` runs one backend command over HTTP, with the same command names and
args as the WebSocket. Splitkick uses it to send a session to another instance:

```bash
curl -X POST "http://127.0.0.1:3460/api/invoke?token=$JEAN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"command":"list_projects","args":{}}'
# {"ok":true,"data":[...]}  — or {"ok":false,"error":"..."} with 401 / 422
```

Requests can be up to 256 MiB. A reverse proxy in front must allow that body size for
this path (Caddy has no limit by default; nginx needs `client_max_body_size`).

## systemd example

```ini
[Unit]
Description=Splitkick headless server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=splitkick
Environment=JEAN_HOST=127.0.0.1
Environment=JEAN_PORT=3460
Environment=JEAN_TOKEN=change-me-long-random-token
ExecStart=/usr/local/bin/splitkick-server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Splitkick loads the service user's interactive login-shell `PATH` at startup, so
browser terminals can find tools installed by shell setup scripts (for example
`~/.bun/bin/bun`) even though systemd itself provides a minimal environment.

## Reverse proxy

### Caddy

```caddyfile
splitkick.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3460
}
```

### Nginx

```nginx
server {
  listen 443 ssl http2;
  server_name splitkick.example.com;

  location / {
    proxy_pass http://127.0.0.1:3460;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Tailscale binding

Bind directly to the Tailscale IP and keep token auth enabled:

```bash
splitkick-server --host 100.x.y.z --port 3460 --token "$JEAN_TOKEN"
```

For Tailscale access from a browser, prefer `tailscale serve` (HTTPS) in front
of `127.0.0.1` rather than plain `http://100.x.y.z` — browsers block the
clipboard API and other secure-context features on non-localhost HTTP,
including the app cache (service worker) that lets the phone app start
without the server. See `docs/userguide/phone-home-screen-app.md`.

## Server updates (bare-metal Linux)

`splitkick-server` can install a newer binary when you choose to from Web Access.
Nothing is installed in the background - apply only runs after you click
**Update & restart**.

**Pre-releases (`1.0.0-pre.N`) do not update themselves.** The update check
answers "update it with the installer: `install-splitkick-server.sh --version
<new version>`" and reads no feed. The feed below is on the GitHub release
that `releases/latest` points to, and that is always the desktop release:
GitHub never marks a pre-release as latest.

| Piece           | Behavior                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Manifest        | `server-latest.json` on the latest Splitkick release                                                                     |
| Check           | Web Access calls `check_server_update` after connect and shows a toast if newer                                          |
| Apply           | User clicks **Update & restart** → `apply_server_update`                                                                 |
| Verify          | SHA-256 from the release manifest                                                                                        |
| Restart         | `systemctl restart splitkick-server.service` when that unit is loaded (or `SPLITKICK_SERVER_SERVICE`), otherwise re-exec |
| Containers      | Not supported - replace the binary in the container instead                                                              |
| Active sessions | Apply is refused while chat sessions are running                                                                         |

## Security recommendations

- Prefer `127.0.0.1` behind Caddy/Nginx, SSH tunnel, or Tailscale.
- Keep token auth enabled for every non-localhost bind.
- Use a long random token, for example `openssl rand -base64 32`.
- Set `JEAN_ALLOWED_ORIGINS=https://splitkick.example.com` only when you need additional cross-origin browser access; native Splitkick client origins are allowed by default.

## Connect from the native Splitkick app

In the desktop app, click the server icon in the title bar and choose **Add
remote**. You can either:

1. **Install via SSH** (native app only; **off** while the server is on its
   pre-release track, `REMOTE_INSTALL_ENABLED` in `src/lib/remote-install.ts`)
   — enter an SSH user and host/IP
   (optional name, SSH port, server port). Splitkick connects with key-based SSH
   (`BatchMode`, no password prompt), runs `install-splitkick-server.sh` from the
   Splitkick release of the desktop app (`splitkick-v<version>`, never `main`)
   with `--version <version>`, so the server has the same version as the app.
   It tries a system install with passwordless `sudo -n`, otherwise
   `--user-install`, waits until `/healthz`, `/readyz`, and `/api/auth` succeed
   from this client, then saves the remote and switches to it.

   The access token is made on the remote host into a `mktemp` file (mode 600),
   handed to the installer with `--token-file`, and deleted when the install
   ends. It is never an argument of `sudo`, `bash`, or the installer, so `ps` on
   the host does not show it (#105). It comes back over the SSH channel and is
   masked in the install log the dialog shows.

   A version of the app with no published server release (a local build of an
   unreleased version) cannot install over SSH; the dialog says so.

2. **Existing URL** — paste a full Web Access URL (including `?token=...`) or
   enter the server URL and token separately.

Selecting the remote switches the entire Splitkick backend while keeping the desktop
app's bundled React UI and local native shell capabilities. Commands and events
for the selected instance travel over HTTP/WebSocket. Select **Local** from the
same dialog to return to the desktop app's local backend.

**SSH install requirements:**

- OpenSSH client on the machine running Splitkick
- Key-based SSH access to `user@host` (password auth is not supported)
- Remote host is Linux (amd64/arm64) with `curl` and `tar`
- Port `3460` (or the server port you chose) reachable from this client; the
  installer binds `0.0.0.0` so LAN/Tailscale IPs work
- Passwordless sudo for a system install, or a working user systemd session for
  `--user-install`

Native Splitkick client origins are allowed automatically. HTTP and HTTPS server
URLs are both supported; keep token authentication enabled on remote servers.

The connection picker shows each remote's `appVersion` (from `/api/auth`) next
to Local's client version. When the versions differ, Splitkick shows a warning toast
and highlights the mismatch in the picker, but still allows the connection so
you are not locked out. Prefer matching versions for the best experience.
