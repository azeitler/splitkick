# Remote capabilities: which actions show where

Splitkick runs in three modes. An action that opens something on a machine
(Finder, an editor, a terminal, a file picker) only helps when the user sits at
that machine. Where it cannot work for the user, show it **disabled** with the
short reason "Host only" (`HostOnlyHint`, `src/components/ui/host-only-hint.tsx`),
so the user sees that it exists and why it is off (#89). The reason is visible
text, not a tooltip, because phones have no hover.

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
commands, so an old client keeps working. Only the UI disables them.

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

Columns: Local desktop / Native + remote / Web Access. "on" means the action
works; "off" means it shows disabled with "Host only"; "hidden" means the item
does not exist in that mode. Web Access on `localhost` behaves like local for
rows that use `canOpenNativeApps()` when the host allows native open.

### Open on the machine

| Action                                                | Where                                    | Local       | Native + remote                               | Web Access                                   | Predicate                                                                    |
| ----------------------------------------------------- | ---------------------------------------- | ----------- | --------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| Open in Finder, terminal                              | Worktree context menu, worktree dropdown | on          | off (was hidden)                              | off (was hidden)                             | `canOpenNativeApps`                                                          |
| Open in editor                                        | Worktree context menu, worktree dropdown | on          | on (Zed `ssh://`)                             | off (was hidden)                             | `canOpenInEditor`                                                            |
| Open in Finder                                        | Project context menu (sidebar)           | on          | off (was shown, opened on the host or failed) | off (was hidden)                             | `canOpenNativeApps` (was `isNativeApp`)                                      |
| Open in editor                                        | Project context menu (sidebar)           | on          | on (Zed)                                      | off (was shown, failed)                      | `canOpenInEditor` (was ungated)                                              |
| Open in terminal, Open Worktrees Folder               | Project context menu (sidebar)           | on          | off (was shown)                               | off (was shown)                              | `canOpenNativeApps` (was ungated)                                            |
| Open in git client                                    | Worktree, project menus, Open In         | on          | hidden                                        | hidden                                       | `useGitClient`: no client is detected for a remote host                      |
| Open in editor / Finder / terminal / Worktrees Folder | Project canvas menu                      | on          | editor on, rest off                           | off                                          | `canOpenInEditor` / `canOpenNativeApps`                                      |
| Open In… modal (⌘O, File → Open In…)                  | Modal                                    | all on      | editor on, Finder and terminal off            | Finder, terminal, editor off; GitHub on      | same; disabled rows are skipped by the arrow keys and shortcuts              |
| Open In button                                        | Window toolbar                           | on          | editor on, rest off                           | button off when no target works (was hidden) | `canOpenInEditor` / `canOpenNativeApps`                                      |
| Open in editor / Default App / Reveal / Terminal      | File browser context menu                | on          | editor on, rest off                           | off                                          | `canOpenInEditor` / `canOpenNativeApps`                                      |
| Browse now (embedded browser)                         | File browser context menu                | on          | hidden                                        | hidden                                       | `isLocalBackend` (a `file://` page in this app's webview, not a host action) |
| Open in editor                                        | File viewer, diff modal                  | on          | on (Zed)                                      | off (was hidden)                             | `canOpenInEditor`                                                            |
| Reveal in Finder                                      | Message context menu (file link, image)  | on          | off (was hidden)                              | off (was hidden)                             | `canOpenNativeApps`                                                          |
| Reveal in Finder / Open in browser                    | Image viewer (#68)                       | Reveal on   | Reveal off, Open in browser on                | Reveal off, Open in browser on               | `canOpenNativeApps`                                                          |
| Open artifact / HTML page in system browser           | Artifacts, chat links                    | default app | preview URL                                   | preview URL                                  | `isLocalBackend` (falls back to the served URL)                              |
| Click a file path in the terminal                     | Embedded terminal                        | editor      | Zed                                           | no link (was a link that failed)             | `canOpenInEditor`; a link cannot be shown disabled                           |
| Copy Path / Copy Relative Path                        | File browser, worktree menu              | on          | on (path on the remote host)                  | on                                           | none                                                                         |

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
| Settings → Show Logs                         | General settings        | this app's log | this app's log (was the remote host's folder, on the host) | off (was hidden)      | `isNativeApp`; `open_log_directory` in `LOCAL_SHELL_COMMANDS` |
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
2. Show the action disabled with `<HostOnlyHint />` (menus) or `disabled` plus
   a title (icon buttons). Hide it only when the item has no meaning in that
   mode (no git client detected, Full Disk Access of another Mac).
3. Desktop-only commands that act on this app go in both
   `DESKTOP_ONLY_COMMANDS` and `LOCAL_SHELL_COMMANDS` in `src/lib/transport.ts`.
4. Test the four modes. `src/components/remote-capabilities.test.tsx` and
   `src/components/remote-capabilities.web-access.test.tsx` set them with the
   real predicates.
