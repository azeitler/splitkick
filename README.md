# Jean

Jean (Claude haha) is an AI assistant application that helps you to manage multiple projects, worktrees, session with Claude CLI.

# Features

- Automated worktree management
- Load context from sessions, GitHub Issues / Pull requests
- Automated (magic) Git commands / prompts (review, commit, open PR, investigate issue/pr)
- Automated GitHub PR or local merge worktrees
- Automated merge conflict resolver
- Archive worktrees / branches so you can restore them and continue to work
- A lot more

# Screenshots

![Main Interface](screenshots/SCR-20260209-nigu.png)
![Development Mode](screenshots/SCR-20260209-ninl.png)
![Diff View](screenshots/SCR-20260209-niug.png)
![Plan Mode](screenshots/SCR-20260209-njel.png)

# Prerequisites

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)
- **Windows only**: In the Visual Studio Installer, ensure the **"Desktop development with C++"** workload is selected, which includes:
  - MSVC C++ build tools
  - Windows SDK (provides `kernel32.lib` and other system libraries required by Rust)

# Platform Support

- **macOS**: Tested
- **Windows**: Not fully tested
- **Linux**: Not tested at all

# Roadmap

- Add [Opencode](https://opencode.ai/) support
- Add remote access support through an API

# Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

# Philosophy

Learn more about our approach: [Philosophy](https://coollabs.io/philosophy/)

---

Made by [Andras Bacsai](https://x.com/heyandras).
