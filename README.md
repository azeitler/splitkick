<div align="center">

# JeanZ

A desktop AI assistant for managing multiple projects, worktrees, and chat sessions with Claude CLI, Codex CLI, Cursor CLI, OpenCode, PI, Command Code, Grok, Kimi Code, and Antigravity CLI.

Tauri v2 · React 19 · Rust · TypeScript · Tailwind CSS v4 · shadcn/ui v4 · Zustand v5 · TanStack Query · Pierre Diffs · xterm.js

</div>

> **JeanZ is a fork of [Jean](https://github.com/coollabsio/jean).**
>
> Jean is created and maintained by **[Andras Bacsai](https://github.com/andrasbacsai)** at [coolLabs](https://coollabs.io). All credit for the application belongs to him and to the upstream contributors. This fork only adds a few features and its own macOS build.
>
> Read the **[upstream README](https://github.com/coollabsio/jean/blob/main/README.md)** for the full project description, the other platforms, and the official downloads. It stays the authoritative document for everything this file does not describe.
>
> Licensed under Apache-2.0, © 2025 Andras Bacsai. See [LICENSE.md](LICENSE.md).

## About the Project

Jean is an opinionated native desktop app built with Tauri that gives you a powerful interface for working with Claude CLI, Codex CLI, Cursor CLI, OpenCode, PI, Command Code, Grok, Kimi Code, and Antigravity CLI across multiple projects. It has strong opinions about how AI-assisted development should work - managing git worktrees, chat sessions, terminals, GitHub and Linear integrations in one cohesive workflow.

No vendor lock-in. Everything runs locally on your machine with your own CLI installations.

For more information about the upstream project, take a look at [jean.build](https://jean.build).

## What This Fork Changes

- **Own macOS build** - a signed and notarized app named JeanZ, published on every push to `main`, with an in-app updater that points at this repository
- **Session search in the command palette** - find and open any session by name
- **Message timestamps** and a "Last active" badge on sessions
- **Row context menu** in the Files sidebar
- **Idle fade** - workspaces and sessions untouched for over a week fade out
- **Faster chat history** - 10 prompts preload, older history loads on scroll
- **Paused session state** with a shared session context menu
- **Session label badges** in the sidebar list and the tab bar

See [docs/developer/fork-macos-builds.md](docs/developer/fork-macos-builds.md) for the build flavor, the version scheme, and the CI details.

## Screenshots

<table>
<tr>
<td><img src="screenshots/SCR-20260304-krym.png" width="400" alt="Screenshot 1" /></td>
<td><img src="screenshots/SCR-20260304-ksgh.png" width="400" alt="Screenshot 2" /></td>
</tr>
<tr>
<td><img src="screenshots/SCR-20260304-ksjn.png" width="400" alt="Screenshot 3" /></td>
<td><img src="screenshots/SCR-20260304-ksnq.png" width="400" alt="Screenshot 4" /></td>
</tr>
<tr>
<td><img src="screenshots/SCR-20260304-kstl.png" width="400" alt="Screenshot 5" /></td>
<td><img src="screenshots/SCR-20260304-ktab.png" width="400" alt="Screenshot 6" /></td>
</tr>
<tr>
<td><img src="screenshots/SCR-20260304-ktwr.png" width="400" alt="Screenshot 7" /></td>
<td><img src="screenshots/SCR-20260304-kuhk.png" width="400" alt="Screenshot 8" /></td>
</tr>
</table>

## Features

- **Project & Worktree Management** - Multi-project support, linked projects for cross-project context, git worktree automation (create, archive, restore, delete), custom project avatars
- **Session Management** - Multiple sessions per worktree, execution modes (Plan, Build, Yolo) with plan approval flows, session recap/digest, saved contexts with AI summarization, archiving with retention settings, recovery, auto-naming, canvas views
- **AI Chat (Claude, Codex, Cursor, OpenCode, PI, Command Code, Grok, Kimi, Antigravity)** - Model selection and thinking/effort levels with per-mode overrides, MCP server support, multi-agent collaboration, file picker & image attachments, chat search, notification sounds, custom system prompts, custom CLI profiles
- **Magic Commands** - Investigate issues/PRs/workflows, code review with finding tracking, AI commit messages, PR content generation, merge conflict resolution, release notes generation, customizable per-prompt model/backend/effort selection
- **GitHub Integration** - Dashboard with Issues, PRs, Security Alerts, and Advisories tabs, Dependabot investigation, checkout PRs as worktrees, auto-archive on PR merge, workflow investigation
- **Linear Integration** - Issue investigation, context loading, per-project API key and team configuration
- **Developer Tools** - Multi-dock terminal (floating, left, right, bottom), command palette, open in editor (Zed, VS Code, VSCodium, Cursor, Xcode, IntelliJ), git operations (status, stash, revert, fetch/merge with conflict detection), diff viewer (unified & side-by-side), file tree with preview, debug panel with token usage tracking
- **Web Access** - Every Jean instance (desktop or headless server) can expose the full UI over HTTP/WebSocket with token auth so you can use it from a browser on your network
- **Customization** - Themes (light/dark/system), custom fonts, customizable AI prompts, configurable keybindings, mobile swipe gestures

## Installation

Download the latest JeanZ build from the [Releases](https://github.com/azeitler/jean/releases) page of this repository. The asset name stays the same, so this URL always gives you the newest build:

<https://github.com/azeitler/jean/releases/latest/download/JeanZ_macos_arm64.dmg>

CI builds are signed and notarized. If you build the app yourself, macOS signs it ad-hoc and shows a Gatekeeper warning. Remove the quarantine flag to open it:

```bash
xattr -dr com.apple.quarantine /Applications/JeanZ.app
```

> **Do not run JeanZ and Jean at the same time.** JeanZ keeps the upstream bundle identifier `com.jean.desktop`, so both apps use the same data directory.

For the official Jean builds, and for Homebrew, Windows and Linux packages, use the [upstream releases](https://github.com/coollabsio/jean/releases).

### Building from Source

Prerequisites:

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)

Build the JeanZ flavor:

```bash
bash scripts/build-fork-macos.sh
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full development setup and guidelines.

## Platform Support

This fork builds and tests **macOS on Apple Silicon only**. The other platforms are commented out in the workflow matrices, not deleted. To use JeanZ on another platform, build it from source. For released Windows and Linux packages, use the [upstream project](https://github.com/coollabsio/jean/releases).

## Web Access

Every Jean instance can run **Web Access**: an embedded HTTP + WebSocket server that serves the same UI in a browser. In the desktop app, open **Settings → Web Access**, enable the HTTP server, set the port and the bind address, and open the shown URL (it includes `?token=...`). Keep token authentication enabled for any non-localhost bind, and prefer a private mesh VPN such as [Tailscale](https://tailscale.com/) over a public port.

This fork publishes no `jean-server` binary and no server container image. `scripts/install-jean-server.sh` still downloads the **upstream** release binaries by default, so it is not a JeanZ install path. For the headless server, read [docs/headless-server.md](docs/headless-server.md) and the [upstream README](https://github.com/coollabsio/jean/blob/main/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Credits

Jean, and almost all of the code in this repository, is the work of Andras Bacsai and the upstream contributors.

|                                                                                                                                                                            Andras Bacsai                                                                                                                                                                             |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
|                                                                                                                                         <img src="https://github.com/andrasbacsai.png" width="200px" alt="Andras Bacsai" />                                                                                                                                          |
| <a href="https://github.com/andrasbacsai"><img src="https://api.iconify.design/devicon:github.svg" width="25px"></a> <a href="https://x.com/heyandras"><img src="https://api.iconify.design/devicon:twitter.svg" width="25px"></a> <a href="https://bsky.app/profile/heyandras.dev"><img src="https://api.iconify.design/simple-icons:bluesky.svg" width="25px"></a> |

The JeanZ fork is maintained by [Andreas Zeitler](https://github.com/azeitler).
