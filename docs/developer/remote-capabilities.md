# Remote capabilities: which actions show where

Splitkick runs in three modes. An action that opens something on a machine
(Finder, an editor, a terminal, a file picker) only helps when the user sits at
that machine. Hide such an action where it cannot work for the user (#89).

| Mode            | What it is                               | `isNativeApp()` | `isLocalBackend()` |
| --------------- | ---------------------------------------- | --------------- | ------------------ |
| Local desktop   | The app on its own Mac                   | yes             | yes                |
| Native + remote | The app connected to a remote Splitkick  | yes             | no                 |
| Web Access      | A browser or phone on the Web Access URL | no              | no                 |

## Predicates

All live in `src/lib/environment.ts`. Use them; do not write per-component
checks.

| Predicate                      | Meaning                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isBackendOnThisMachine()`     | Local backend, or the backend is reached by a loopback address (`localhost`, `127.x`, `[::1]`): Web Access opened on `localhost`, or a remote connection to `127.0.0.1` |
| `isNativeOpenAllowed()`        | Host allows native open (`/api/init` `nativeOpenAllowed`) **and** `isBackendOnThisMachine()`                                                                            |
| `canOpenNativeApps()`          | Finder/Reveal, terminal, default app, worktrees folder: `isLocalBackend() \|\| isNativeOpenAllowed()`                                                                   |
| `canOpenRemoteEditorLocally()` | Native + remote, host open not usable: open the remote path in the local Zed over `ssh://`                                                                              |
| `canOpenInEditor()`            | `canOpenNativeApps() \|\| canOpenRemoteEditorLocally()`                                                                                                                 |
| `canPickLocalPaths()`          | Native file/folder picker (Browse…): local backend only. Remote clients use the backend `DirectoryBrowser` or type the path                                             |
| `isNativeApp()`                | Things of this desktop shell itself: dock, menu bar, window vibrancy, notifications, relaunch, this app's log                                                           |

### What `nativeOpenAllowed` means

The server sets `nativeOpenAllowed` in `/api/init`
(`jean-core/src/http_server/server.rs`, `platform::native_open_allowed()`): true
for the desktop app hosting Web Access, for `--allow-native-open` /
`JEAN_ALLOW_NATIVE_OPEN=1`, and under WSL. It says: **the host may launch apps**.

Before #89 the client showed Finder/terminal actions whenever the flag was
true. The desktop host always sets it, so a phone on the tunnel URL saw
"Reveal in Finder", and the click opened Finder on the host Mac, where nobody
looked.

Since #89 the client also asks whether the user sits at the host
(`isBackendOnThisMachine()`). The server is unchanged: it still allows the
commands, so an old client keeps working. Only the UI hides them.

- Works: Web Access on `http://localhost:<port>` on the host, WSL (a Windows
  browser on `localhost` forwarded into WSL), a native remote connection to
  `127.0.0.1` (the two-instance e2e harness).
- Hidden: every tunnel, LAN address or DNS name, even when the tunnel daemon
  connects to the server over loopback.
- Known edge: an SSH port forward makes a far host look like `localhost`.
  Open actions then show and run on the far host, the same as before #89.

The editor remap (`canOpenRemoteEditorLocally`) uses the same flag. A native
window connected to a desktop host through a tunnel now opens remote paths in
the local Zed instead of an editor on the host.

## Audit (1.5.0, #89)

Columns: Local desktop / Native + remote / Web Access. "shown" means the action
is visible and works for the user; "hidden" means the UI does not offer it.
Web Access on `localhost` behaves like local for rows that use
`canOpenNativeApps()` when the host allows native open.

### Open on the machine

| Action                                                | Where                                    | Local       | Native + remote                              | Web Access                       | Predicate                                         |
| ----------------------------------------------------- | ---------------------------------------- | ----------- | -------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| Open in Finder / Reveal                               | Worktree context menu, worktree dropdown | shown       | hidden                                       | hidden                           | `canOpenNativeApps`                               |
| Open in Finder                                        | Project context menu (sidebar)           | shown       | hidden (was shown, opened on host or failed) | hidden                           | `canOpenNativeApps` (was `isNativeApp`)           |
| Open in editor                                        | Project context menu (sidebar)           | shown       | shown (Zed `ssh://`)                         | hidden (was shown, failed)       | `canOpenInEditor` (was ungated)                   |
| Open in terminal                                      | Project context menu (sidebar)           | shown       | hidden (was shown)                           | hidden (was shown)               | `canOpenNativeApps` (was ungated)                 |
| Open in git client                                    | Project context menu                     | shown       | hidden                                       | hidden                           | `canOpenNativeApps` + `useGitClient` (local only) |
| Open Worktrees Folder                                 | Project context menu (sidebar)           | shown       | hidden (was shown)                           | hidden (was shown)               | `canOpenNativeApps` (was ungated)                 |
| Open in editor / Finder / terminal / Worktrees Folder | Project canvas menu                      | shown       | editor only                                  | hidden                           | `canOpenInEditor` / `canOpenNativeApps`           |
| Open In… modal (⌘O, File → Open In…)                  | Modal                                    | all         | editor + GitHub                              | GitHub                           | `canOpenInEditor` / `canOpenNativeApps`           |
| Open In button                                        | Chat toolbar                             | all         | editor                                       | hidden                           | `canOpenInEditor` / `canOpenNativeApps`           |
| Open in editor / Default App / Reveal / Terminal      | File browser context menu                | shown       | editor only                                  | hidden                           | `canOpenInEditor` / `canOpenNativeApps`           |
| Browse now (embedded browser)                         | File browser context menu                | shown       | hidden                                       | hidden                           | `isLocalBackend` (file:// in native webview)      |
| Open in editor                                        | File viewer, diff modal                  | shown       | shown (Zed)                                  | hidden                           | `canOpenInEditor`                                 |
| Reveal in Finder                                      | Message context menu (file link, image)  | shown       | hidden                                       | hidden                           | `canOpenNativeApps`                               |
| Reveal in Finder / Open in browser                    | Image viewer (#68)                       | Reveal      | Open in browser                              | Open in browser                  | `canOpenNativeApps` (was `isLocalBackend`)        |
| Open artifact / HTML page in system browser           | Artifacts, chat links                    | default app | preview URL                                  | preview URL                      | `isLocalBackend` (falls back to served URL)       |
| Click a file path in the terminal                     | Embedded terminal                        | editor      | Zed                                          | no link (was a link that failed) | `canOpenInEditor` (was ungated)                   |
| Copy Path / Copy Relative Path                        | File browser, worktree menu              | shown       | shown (path on the remote host)              | shown                            | none                                              |

### Pickers

| Action                             | Where                | Local     | Native + remote                | Web Access                     | Predicate           |
| ---------------------------------- | -------------------- | --------- | ------------------------------ | ------------------------------ | ------------------- |
| Add Project → Browse / Init        | Add Project dialog   | OS picker | backend directory browser      | backend directory browser      | `canPickLocalPaths` |
| Clone → target folder              | Clone dialog         | OS picker | backend directory browser      | backend directory browser      | `canPickLocalPaths` |
| Worktrees Location → Browse        | Project settings     | OS picker | backend directory browser      | backend directory browser      | `canPickLocalPaths` |
| Backup folder → Browse             | Session backup setup | OS picker | backend directory browser      | backend directory browser      | `canPickLocalPaths` |
| Graph folder / graph file → Browse | New Graph dialog     | OS picker | directory browser / typed path | directory browser / typed path | `canPickLocalPaths` |

### This app (desktop shell)

| Action                                       | Where                   | Local          | Native + remote                                            | Web Access            | Predicate / routing                                           |
| -------------------------------------------- | ----------------------- | -------------- | ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| Help → Show Log                              | macOS menu              | this app's log | this app's log                                             | n/a (no menu)         | Rust menu handler, always local                               |
| Settings → Show Logs                         | General settings        | this app's log | this app's log (was the remote host's folder, on the host) | hidden                | `isNativeApp`; `open_log_directory` in `LOCAL_SHELL_COMMANDS` |
| Restart to update / relaunch                 | Title bar, update modal | shown          | shown (updates this app)                                   | hidden                | `isNativeApp`; `relaunch_app` local shell                     |
| Restart host                                 | Server update badge     | n/a            | shown (remote host update)                                 | shown                 | intentional remote action                                     |
| Full Disk Access                             | General settings        | shown on macOS | hidden                                                     | hidden                | `getFullDiskAccessStatus` → `not_applicable`                  |
| Notifications, dock badge, menu accelerators | OS                      | local          | local                                                      | browser notifications | `LOCAL_SHELL_COMMANDS`                                        |
| About, Check for Updates                     | macOS menu              | local          | local                                                      | n/a                   | `isNativeApp`                                                 |
| Editor / terminal / git client preference    | General settings        | shown          | shown (host preference)                                    | hidden                | `isNativeApp` (a preference, not an action)                   |

### ⌘K

No ⌘K command opens Finder, a terminal or an editor. ⌘K and File → Open In…
reach those actions only through the Open In modal, which applies the
predicates above.

## Adding a new action

1. Pick the predicate from the table. If none fits, add one to
   `environment.ts` with a doc comment and a row here.
2. Hide the action (preferred) instead of disabling it.
3. Desktop-only commands that act on this app go in both
   `DESKTOP_ONLY_COMMANDS` and `LOCAL_SHELL_COMMANDS` in `src/lib/transport.ts`.
4. Test the four modes. `src/components/remote-capabilities.test.tsx` and
   `src/components/remote-capabilities.web-access.test.tsx` set them with the
   real predicates.
