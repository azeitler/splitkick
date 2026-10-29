# Session backup and cross-device search

Code: `jean-core/src/session_backup/` (`mod.rs` = backup, `search.rs` = remote
search). UI: Settings → General → **Session backup**
(`src/components/preferences/panes/SessionBackupSection.tsx`,
`src/components/preferences/SetupBackupDialog.tsx`).

## What it does

Each instance copies its session data into a user-picked folder that a sync
service keeps in step across devices (iCloud Drive, Syncthing, Nextcloud,
Dropbox). Every instance then also searches the backups of the other
instances. A hit from another device is **info only**. The palette has an
**Other devices** tab next to **Search messages**; both tabs query in
parallel and show their result counts as pills. Selecting a remote hit shows
a toast. With no backup folder set, the tab shows a **Setup Backup** button
that opens `SetupBackupDialog`. In web access the dialog browses the
server's folders (`DirectoryBrowser`), because the backup runs on the server.
The MCP `search_sessions` tool merges remote hits and marks them with
`device` and `note` (no `link`).

## Layout

```
<shared>/splitkick-backup/instances/<instance_id>/
  instance.json      who wrote this folder, last backup time
  projects.json      project + worktree names, normalized git remote
  sessions/index/*.json
  sessions/data/<session_id>/metadata.json, <run_id>.jsonl, search-digest.json
```

- One writer per instance folder, so the sync service never sees a conflict.
- `instance_id` is a UUID in `<app-data>/instance-id`, not in preferences, so a
  copied `preferences.json` never makes two devices share one id.
- Files are written to `*.splitkick-tmp` and renamed, so a reader never sees
  half a file.
- Not copied: `*.input.jsonl`, pasted images/texts, checkpoints, trash,
  preferences, UI state.
- The backup never deletes. A session deleted here stays in the backup.

## When it runs

`start_scheduler` (started in `start_runtime_services`): at start, every
10 minutes, and 30 s after a run completes, is cancelled or crashes
(`request_backup_soon` in `chat/run_log.rs`). It reads the preference on each
pass, so turning the backup on or off needs no restart. Only one backup runs
at a time.

## Incremental backups

Only the first backup copies everything. Every pass after it is incremental:

1. **Find the changes.** `scan` stats every file under `sessions/index` and
   `sessions/data` and compares it with the copy in the backup. A file is
   copied when the copy is missing, its size differs, or the source is newer
   (`needs_copy`). A copy is never older than its source (a cloned file
   keeps the source mtime, a plain copy gets the copy time), so an unchanged
   file is skipped on the next pass. For 5,361 files this check
   takes about 0.06 s.
2. **Copy whole files.** A changed file is copied in full, not as a delta.
   This is cheap because the files are small or append-only:
   - `metadata.json` and the worktree indexes change on most turns, but are
     a few KB each.
   - A run log (`<run_id>.jsonl`) is written once per run. It is skipped while
     its run is still `running`, so a long run is copied once, when it ends,
     and not again every 10 minutes. After that it never changes.
   - On mb14 this was about 136 MB per day.
3. **Update the search digests** only for sessions with a copied file, plus
   any backed-up session that has no digest yet.
4. **Write `projects.json` and `instance.json`** (small, every complete pass).
   `instance.json.last_sync_at` is the "last backup" time that other devices
   show.

Rules that follow from this:

- **Nothing is deleted or overwritten with older data.** A session that is
  deleted or archived on this device stays in the backup as it was.
- **A stopped pass loses nothing.** Files copied before Stop stay, and the
  next pass skips them. Stop skips steps 3 and 4, so `last_sync_at` keeps the
  time of the last complete pass.
- **Other devices see a change when the sync service has delivered it.** The
  remote search reads the files at query time; there is no cache to refresh.
- **Measured** (debug server, backup on a separate volume, 2026-10-29): first
  backup 5,371 files / 5.1 GB in 119 s (copy about 8 s, search index the
  rest; the release build is several times faster). Next pass with no
  changes: 0 files in 0.21 s. After one run log changed: 1 file (366 KB) in
  0.20 s.

The first backup into a folder runs in `SetupBackupDialog`, which is modal
while it runs: no close button, no Escape, no outside click, and the open
dialog blocks the app's keyboard shortcuts. Only **Stop** ends it early.
Later backups run in the background without any dialog.

Progress is the `session-backup:progress` event (`BackupProgress`, throttled
to 10/s). Background runs emit it too.

## Search digest (performance)

Raw run logs are mostly tool output: on the first real data set the message
text was about 0.2 % of the JSONL bytes. Scanning another device's raw logs
would cost as much as the local search (about 8.5 s for 5 GB), per device.
So the backup also writes `search-digest.json` (message id, role, text, from
`load_session_messages`) for each session whose logs changed, and the remote
search reads only `metadata.json` and the digest. Remote search runs as its
own command (`search_remote_sessions`) and its own palette query, so local
hits never wait for it.

## Project matching

`projects.json` stores `git_remote` normalized by `normalize_git_remote` to
`host/owner/repo` (lowercase, no `.git`, SSH and HTTPS alike). The searching
device maps it to its own project with the same remote; without a match the
hit keeps the remote project's name and id.

## Commands

All live in jean-core, so they need only a `dispatch.rs` arm:
`get_session_backup_status`, `estimate_session_backup`,
`run_session_backup_now` (returns at once), `cancel_session_backup`,
`search_remote_sessions`, `get_default_device_name`.

Preferences (`AppPreferences`, snake_case): `session_backup_dir`
(`null` = off), `session_backup_device_name` (`null` = macOS ComputerName),
`session_backup_search_remote` (default `true`).

## Caveats

- The first backup needs as much free space as the session data (shown in the
  setup dialog).
- iCloud Drive can evict files to save space. Reading an evicted digest
  downloads it first, which makes remote search slow. Mark the folder
  "Keep Downloaded" in Finder.

## Benchmark

Measured on mb14, 2026-10-29, release build, on a copy of real data:

| Step | Result |
|---|---|
| First backup | 5,361 files, 5.0 GB, 281 digests in 20.7 s |
| Next backup, nothing changed | 0.1 s |
| All search digests | 14 MB (0.3 % of the raw logs) |
| Remote search over that one device | 80–140 ms (the local search takes ~8.5 s) |

The target was on the same APFS volume, where `std::fs::copy` can clone
files. A folder on another volume copies at disk speed. Upload to the sync
service happens after that, at the speed the service allows.

`bench_real_data` in `session_backup/mod.rs` (ignored) times the initial and
incremental backup and remote search on a copy of real data:

```
cp -cR "~/Library/Application Support/app.splitkick.desktop/sessions" tmp/bench/data/
cp -c ".../projects.json" tmp/bench/data/
BENCH_DATA_DIR=$PWD/tmp/bench/data BENCH_SHARED_DIR=$PWD/tmp/bench/shared \
  cargo test --release --manifest-path jean-core/Cargo.toml --lib bench_real_data -- --ignored --nocapture
```
