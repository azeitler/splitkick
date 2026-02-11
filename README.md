# Jean

Jean is a desktop AI assistant for managing multiple projects, worktrees, and chat sessions with Claude CLI.

## Features

### Project & Worktree Management
- Multi-project support with folder organization
- Git worktree automation (create, archive, restore, delete)
- Base session mode (work on main without worktrees)
- Custom project avatars

### Session Management
- Multiple sessions per worktree
- Execution modes: Plan, Build, Yolo
- Session archiving, recovery, auto-naming
- Canvas views for visual session overview

### AI Chat (Claude CLI)
- Model selection (Opus, Sonnet, Haiku)
- Thinking levels (Think, Megathink, Ultrathink) and effort levels for Opus
- MCP server support
- File mentions, image support, context loading
- Customizable system prompts per project

### Magic Commands
- Investigate Issue / PR / Workflow
- Code Review with finding tracking
- AI Commit messages, PR content generation
- Merge conflict resolution
- Release notes generation

### GitHub Integration
- Issue & PR investigation
- Checkout PRs as worktrees
- Auto-archive on PR merge
- GitHub Actions workflow investigation

### Developer Tools
- Integrated terminal (multiple per worktree)
- Open in editor (VS Code, Cursor, Xcode)
- Git status, diff viewer (unified & side-by-side)
- File tree with preview

### Remote Access
- Built-in HTTP server with WebSocket support
- Token-based authentication
- Web browser access

### Customization
- Themes (light/dark/system)
- Custom fonts and font sizes
- Customizable AI prompts
- Configurable keybindings

## Tech Stack

Tauri v2 · React 19 · Rust · TypeScript · Tailwind CSS v4 · shadcn/ui v4 · Zustand v5 · TanStack Query · CodeMirror 6 · xterm.js

## Screenshots

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
- Enhance remote web access

# Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

# Philosophy

Learn more about our approach: [Philosophy](https://coollabs.io/philosophy/)

---

Made by [Andras Bacsai](https://x.com/heyandras).
