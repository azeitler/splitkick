//! Backup of this instance's session data into a shared, synced folder.
//!
//! Each instance writes only into its own subfolder
//! (`<shared>/splitkick-backup/instances/<instance_id>/`), so instances on
//! different devices never write the same file and the sync service (iCloud
//! Drive, Syncthing, Dropbox) never has to resolve a conflict. The layout
//! mirrors `sessions/` in the app-data dir, plus three files written here:
//!
//! - `instance.json`: who wrote this folder and when.
//! - `projects.json`: project and worktree names with the normalized git
//!   remote, so another device can map a session to its own project.
//! - `sessions/data/<id>/search-digest.json`: the message text only. Raw run
//!   logs are about 99 % tool output, so other devices search the digest and
//!   never scan the raw logs (see `search.rs`).
//!
//! The backup never deletes: a session deleted here stays in the backup.

pub mod search;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::http_server::EmitExt;

use crate::chat::run_log::load_session_messages;
use crate::chat::storage::{get_data_dir, get_index_dir};
use crate::chat::types::MessageRole;
use crate::projects::storage::load_projects_data;

pub const BACKUP_DIR_NAME: &str = "splitkick-backup";
pub const FORMAT_VERSION: u32 = 1;
pub const DIGEST_FILE: &str = "search-digest.json";
const INSTANCE_ID_FILE: &str = "instance-id";
const PROGRESS_EVENT: &str = "session-backup:progress";

/// Background runs: one at start, then this often, plus one shortly after a
/// run ends.
const BACKUP_INTERVAL: Duration = Duration::from_secs(10 * 60);
const RUN_END_DEBOUNCE: Duration = Duration::from_secs(30);
const PROGRESS_THROTTLE: Duration = Duration::from_millis(100);

static RUNNING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static WAKE: Lazy<tokio::sync::Notify> = Lazy::new(tokio::sync::Notify::new);
static STATUS: Lazy<Mutex<LastRun>> = Lazy::new(|| Mutex::new(LastRun::default()));

#[derive(Debug, Clone, Default)]
struct LastRun {
    last_sync_at: Option<u64>,
    last_error: Option<String>,
    files_copied: usize,
    bytes_copied: u64,
    duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BackupPhase {
    Scanning,
    Copying,
    Digest,
    Done,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupProgress {
    pub phase: BackupPhase,
    pub files_done: usize,
    pub files_total: usize,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub current: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InstanceInfo {
    pub format_version: u32,
    pub instance_id: String,
    pub device_name: String,
    pub app_version: String,
    pub last_sync_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupWorktree {
    pub id: String,
    pub name: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupProject {
    pub project_id: String,
    pub name: String,
    /// `host/owner/repo`, see [`normalize_git_remote`].
    pub git_remote: Option<String>,
    pub worktrees: Vec<BackupWorktree>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DigestMessage {
    pub id: String,
    pub role: MessageRole,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchDigest {
    pub messages: Vec<DigestMessage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupStatus {
    pub enabled: bool,
    pub backup_dir: Option<String>,
    pub instance_id: String,
    pub device_name: String,
    pub running: bool,
    pub last_sync_at: Option<u64>,
    pub last_error: Option<String>,
    pub files_copied: usize,
    pub bytes_copied: u64,
    pub duration_ms: u64,
    pub other_instances: Vec<InstanceInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupEstimate {
    pub bytes_needed: u64,
    pub files: usize,
    pub free_bytes: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SyncReport {
    pub files_copied: usize,
    pub bytes_copied: u64,
    pub digests_written: usize,
    pub cancelled: bool,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Stable id of this instance. Kept in its own file, not in preferences, so a
/// copied `preferences.json` never makes two devices share one id.
pub fn instance_id(app: &AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir()?.join(INSTANCE_ID_FILE);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim();
        if !existing.is_empty() {
            return Ok(existing.to_string());
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    std::fs::write(&path, &id).map_err(|e| format!("Failed to write instance id: {e}"))?;
    Ok(id)
}

/// The macOS ComputerName ("Andreas's MacBook Pro"), else the host name.
pub fn default_device_name() -> String {
    #[cfg(target_os = "macos")]
    if let Ok(output) = crate::platform::silent_command("scutil")
        .args(["--get", "ComputerName"])
        .output()
    {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() && !name.is_empty() {
            return name;
        }
    }
    crate::platform::silent_command("hostname")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Unknown device".to_string())
}

fn device_name(prefs: &crate::AppPreferences) -> String {
    prefs
        .session_backup_device_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .unwrap_or_else(default_device_name)
}

/// `host/owner/repo`, lowercase, so `git@github.com:A/b.git` and
/// `https://github.com/a/b` are the same project.
pub fn normalize_git_remote(url: &str) -> Option<String> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }
    let rest = if let Some((_, after_scheme)) = url.split_once("://") {
        // Drop `user@` or `user:token@` in front of the host.
        let (authority, path) = after_scheme.split_once('/').unwrap_or((after_scheme, ""));
        let host = authority.rsplit('@').next().unwrap_or(authority);
        let host = host.split(':').next().unwrap_or(host);
        format!("{host}/{path}")
    } else if let Some((user_host, path)) = url.split_once(':') {
        // scp-like `git@host:owner/repo`.
        let host = user_host.rsplit('@').next().unwrap_or(user_host);
        format!("{host}/{path}")
    } else {
        return None;
    };
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let normalized = rest.to_lowercase();
    normalized.contains('/').then_some(normalized)
}

/// One `git config` per project path and minute; the search maps every
/// local project on each query.
static GIT_REMOTE_CACHE: Lazy<Mutex<HashMap<String, (Instant, Option<String>)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn project_git_remote(project_path: &str) -> Option<String> {
    if let Ok(cache) = GIT_REMOTE_CACHE.lock() {
        if let Some((at, remote)) = cache.get(project_path) {
            if at.elapsed() < Duration::from_secs(60) {
                return remote.clone();
            }
        }
    }
    let remote = crate::platform::silent_command("git")
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(project_path)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| normalize_git_remote(&String::from_utf8_lossy(&output.stdout)));
    if let Ok(mut cache) = GIT_REMOTE_CACHE.lock() {
        cache.insert(project_path.to_string(), (Instant::now(), remote.clone()));
    }
    remote
}

pub fn instances_root(shared_dir: &Path) -> PathBuf {
    shared_dir.join(BACKUP_DIR_NAME).join("instances")
}

/// The other instances that wrote into this shared folder.
pub fn list_instances(shared_dir: &Path) -> Vec<(PathBuf, InstanceInfo)> {
    let Ok(entries) = std::fs::read_dir(instances_root(shared_dir)) else {
        return vec![];
    };
    let mut instances: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let dir = entry.path();
            let raw = std::fs::read_to_string(dir.join("instance.json")).ok()?;
            let info: InstanceInfo = serde_json::from_str(&raw).ok()?;
            Some((dir, info))
        })
        .collect();
    instances.sort_by(|a, b| a.1.device_name.cmp(&b.1.device_name));
    instances
}

/// A file to back up: where it is, where it goes, and how big it is.
#[derive(Debug, Clone)]
struct PendingCopy {
    source: PathBuf,
    target: PathBuf,
    size: u64,
    session_id: Option<String>,
}

fn needs_copy(source: &std::fs::Metadata, target: &Path) -> bool {
    let Ok(existing) = std::fs::metadata(target) else {
        return true;
    };
    if existing.len() != source.len() {
        return true;
    }
    match (source.modified(), existing.modified()) {
        (Ok(src), Ok(dst)) => src > dst,
        _ => true,
    }
}

/// Run ids whose log is still being written. Copying them now would re-copy
/// a growing file every interval; the run-end trigger copies them once.
fn running_run_ids(metadata_path: &Path) -> HashSet<String> {
    let Ok(raw) = std::fs::read_to_string(metadata_path) else {
        return HashSet::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return HashSet::new();
    };
    value
        .get("runs")
        .and_then(|runs| runs.as_array())
        .into_iter()
        .flatten()
        .filter(|run| run.get("status").and_then(|s| s.as_str()) == Some("running"))
        .filter_map(|run| run.get("run_id").and_then(|id| id.as_str()))
        .map(str::to_string)
        .collect()
}

/// Every file under `sessions/` that is new or changed since the last backup.
fn scan(index_dir: &Path, data_dir: &Path, target_root: &Path) -> Vec<PendingCopy> {
    let mut pending = Vec::new();
    let target_index = target_root.join("sessions").join("index");
    let target_data = target_root.join("sessions").join("data");

    if let Ok(entries) = std::fs::read_dir(index_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                push_if_changed(&mut pending, &path, &target_index, None);
            }
        }
    }

    let Ok(sessions) = std::fs::read_dir(data_dir) else {
        return pending;
    };
    for session in sessions.flatten() {
        let session_dir = session.path();
        if !session_dir.is_dir() {
            continue;
        }
        let session_id = session.file_name().to_string_lossy().to_string();
        let target_dir = target_data.join(&session_id);
        let running = running_run_ids(&session_dir.join("metadata.json"));
        let Ok(files) = std::fs::read_dir(&session_dir) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            let name = file.file_name().to_string_lossy().to_string();
            let is_metadata = name == "metadata.json";
            let is_run_log = name.ends_with(".jsonl") && !name.ends_with(".input.jsonl");
            if !is_metadata && !is_run_log {
                continue;
            }
            if is_run_log && running.contains(name.trim_end_matches(".jsonl")) {
                continue;
            }
            push_if_changed(&mut pending, &path, &target_dir, Some(&session_id));
        }
    }
    pending
}

fn push_if_changed(
    pending: &mut Vec<PendingCopy>,
    source: &Path,
    target_dir: &Path,
    session_id: Option<&str>,
) {
    let Ok(meta) = std::fs::metadata(source) else {
        return;
    };
    let Some(name) = source.file_name() else {
        return;
    };
    let target = target_dir.join(name);
    if needs_copy(&meta, &target) {
        pending.push(PendingCopy {
            source: source.to_path_buf(),
            target,
            size: meta.len(),
            session_id: session_id.map(str::to_string),
        });
    }
}

/// Copy to a temp name, then rename, so a reader on another device never sees
/// half a file.
fn copy_atomic(source: &Path, target: &Path) -> Result<u64, String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    let temp = target.with_extension("splitkick-tmp");
    let bytes = std::fs::copy(source, &temp)
        .map_err(|e| format!("Failed to copy {}: {e}", source.display()))?;
    std::fs::rename(&temp, target).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        format!("Failed to finalize {}: {e}", target.display())
    })?;
    Ok(bytes)
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    let json = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    let temp = path.with_extension("splitkick-tmp");
    std::fs::write(&temp, json).map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    std::fs::rename(&temp, path).map_err(|e| format!("Failed to finalize {}: {e}", path.display()))
}

struct ProgressEmitter<'a> {
    app: &'a AppHandle,
    last: Option<Instant>,
}

impl ProgressEmitter<'_> {
    fn emit(&mut self, progress: &BackupProgress, force: bool) {
        if !force && self.last.is_some_and(|at| at.elapsed() < PROGRESS_THROTTLE) {
            return;
        }
        self.last = Some(Instant::now());
        // `emit_all`, not `emit`: web-access clients get it over the WebSocket.
        let _ = self.app.emit_all(PROGRESS_EVENT, progress);
    }
}

/// One backup pass. Blocking; call it from `spawn_blocking`.
pub fn sync_once(app: &AppHandle, shared_dir: &Path) -> Result<SyncReport, String> {
    let prefs = crate::load_preferences_sync(app)?;
    let id = instance_id(app)?;
    let target_root = instances_root(shared_dir).join(&id);
    let mut emitter = ProgressEmitter { app, last: None };
    let mut progress = BackupProgress {
        phase: BackupPhase::Scanning,
        files_done: 0,
        files_total: 0,
        bytes_done: 0,
        bytes_total: 0,
        current: None,
    };
    emitter.emit(&progress, true);

    let pending = scan(&get_index_dir(app)?, &get_data_dir(app)?, &target_root);
    progress.phase = BackupPhase::Copying;
    progress.files_total = pending.len();
    progress.bytes_total = pending.iter().map(|p| p.size).sum();
    emitter.emit(&progress, true);

    let mut report = SyncReport::default();
    let mut changed_sessions = HashSet::new();
    for file in &pending {
        if CANCEL.load(Ordering::Relaxed) {
            report.cancelled = true;
            break;
        }
        progress.current = file.session_id.clone();
        match copy_atomic(&file.source, &file.target) {
            Ok(bytes) => {
                report.files_copied += 1;
                report.bytes_copied += bytes;
                if let Some(session_id) = &file.session_id {
                    changed_sessions.insert(session_id.clone());
                }
            }
            // A file that vanished mid-run (a deleted session) is not fatal.
            Err(e) => log::warn!("[SessionBackup] {e}"),
        }
        progress.files_done += 1;
        progress.bytes_done += file.size;
        emitter.emit(&progress, false);
    }

    if !report.cancelled {
        progress.phase = BackupPhase::Digest;
        progress.current = None;
        emitter.emit(&progress, true);
        report.digests_written = write_digests(
            app,
            &target_root,
            &changed_sessions,
            &mut progress,
            &mut emitter,
        );
        write_json_atomic(&target_root.join("projects.json"), &project_digest(app)?)?;
        write_json_atomic(
            &target_root.join("instance.json"),
            &InstanceInfo {
                format_version: FORMAT_VERSION,
                instance_id: id,
                device_name: device_name(&prefs),
                app_version: crate::app_version().to_string(),
                last_sync_at: now_secs(),
            },
        )?;
    }

    progress.phase = if report.cancelled {
        BackupPhase::Cancelled
    } else {
        BackupPhase::Done
    };
    emitter.emit(&progress, true);
    Ok(report)
}

/// A digest for every session whose logs changed, and for any backed-up
/// session that has none yet (a backup made before digests existed).
fn write_digests(
    app: &AppHandle,
    target_root: &Path,
    changed: &HashSet<String>,
    progress: &mut BackupProgress,
    emitter: &mut ProgressEmitter<'_>,
) -> usize {
    let data_dir = target_root.join("sessions").join("data");
    let mut sessions: Vec<String> = changed.iter().cloned().collect();
    if let Ok(entries) = std::fs::read_dir(&data_dir) {
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().to_string();
            if !changed.contains(&id) && !entry.path().join(DIGEST_FILE).exists() {
                sessions.push(id);
            }
        }
    }
    // This phase counts sessions, not files; the copy phase is done.
    progress.files_done = 0;
    progress.files_total = sessions.len();
    emitter.emit(progress, true);
    let mut written = 0;
    for session_id in sessions {
        if CANCEL.load(Ordering::Relaxed) {
            break;
        }
        progress.files_done += 1;
        progress.current = Some(session_id.clone());
        emitter.emit(progress, false);
        let messages = match load_session_messages(app, &session_id) {
            Ok(messages) => messages,
            Err(e) => {
                log::warn!("[SessionBackup] session={session_id} digest skipped: {e}");
                continue;
            }
        };
        let digest = SearchDigest {
            messages: messages
                .into_iter()
                .filter(|m| !m.content.trim().is_empty())
                .map(|m| DigestMessage {
                    id: m.id,
                    role: m.role,
                    content: m.content,
                })
                .collect(),
        };
        match write_json_atomic(&data_dir.join(&session_id).join(DIGEST_FILE), &digest) {
            Ok(()) => written += 1,
            Err(e) => log::warn!("[SessionBackup] {e}"),
        }
    }
    written
}

fn project_digest(app: &AppHandle) -> Result<Vec<BackupProject>, String> {
    let data = load_projects_data(app)?;
    Ok(data
        .projects
        .iter()
        .filter(|project| !project.is_folder)
        .map(|project| BackupProject {
            project_id: project.id.clone(),
            name: project.name.clone(),
            git_remote: project_git_remote(&project.path),
            worktrees: data
                .worktrees_for_project(&project.id)
                .into_iter()
                .map(|w| BackupWorktree {
                    id: w.id.clone(),
                    name: w.name.clone(),
                    branch: w.branch.clone(),
                })
                .collect(),
        })
        .collect())
}

fn configured_dir(app: &AppHandle) -> Option<PathBuf> {
    let prefs = crate::load_preferences_sync(app).ok()?;
    prefs
        .session_backup_dir
        .filter(|dir| !dir.trim().is_empty())
        .map(PathBuf::from)
}

/// Run one backup now, unless one is already running. Progress goes out as
/// `session-backup:progress` events.
pub async fn run_backup(app: AppHandle) -> Result<(), String> {
    let Some(shared_dir) = configured_dir(&app) else {
        return Err("No backup folder is set".to_string());
    };
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let started = Instant::now();
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || sync_once(&worker_app, &shared_dir))
        .await
        .map_err(|e| format!("Backup task failed: {e}"))
        .and_then(|r| r);
    RUNNING.store(false, Ordering::SeqCst);

    let duration_ms = started.elapsed().as_millis() as u64;
    let mut status = STATUS.lock().map_err(|e| e.to_string())?;
    status.duration_ms = duration_ms;
    match &result {
        Ok(report) => {
            log::info!(
                "[SessionBackup] copied {} files ({} bytes), {} digests in {duration_ms} ms{}",
                report.files_copied,
                report.bytes_copied,
                report.digests_written,
                if report.cancelled { ", cancelled" } else { "" }
            );
            status.files_copied = report.files_copied;
            status.bytes_copied = report.bytes_copied;
            if !report.cancelled {
                status.last_sync_at = Some(now_secs());
                status.last_error = None;
            }
        }
        Err(e) => {
            log::warn!("[SessionBackup] failed: {e}");
            status.last_error = Some(e.clone());
            let _ = app.emit_all_owned(
                PROGRESS_EVENT,
                BackupProgress {
                    phase: BackupPhase::Failed,
                    files_done: 0,
                    files_total: 0,
                    bytes_done: 0,
                    bytes_total: 0,
                    current: Some(e.clone()),
                },
            );
        }
    }
    result.map(|_| ())
}

pub fn cancel_backup() {
    if RUNNING.load(Ordering::SeqCst) {
        CANCEL.store(true, Ordering::SeqCst);
    }
}

/// Ask the scheduler for a backup soon (debounced). Called when a run ends.
pub fn request_backup_soon() {
    WAKE.notify_one();
}

/// The background loop: a backup at start, every `BACKUP_INTERVAL`, and
/// `RUN_END_DEBOUNCE` after a run ends. Does nothing while no folder is set,
/// and reads the preference on every pass, so turning it on or off needs no
/// restart.
pub fn start_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            if configured_dir(&app).is_some() {
                if let Err(e) = run_backup(app.clone()).await {
                    log::warn!("[SessionBackup] scheduled backup failed: {e}");
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(BACKUP_INTERVAL) => {}
                _ = WAKE.notified() => {
                    tokio::time::sleep(RUN_END_DEBOUNCE).await;
                }
            }
        }
    });
}

pub fn backup_status(app: &AppHandle) -> Result<BackupStatus, String> {
    let prefs = crate::load_preferences_sync(app)?;
    let id = instance_id(app)?;
    let shared_dir = prefs
        .session_backup_dir
        .clone()
        .filter(|dir| !dir.trim().is_empty());
    let other_instances = shared_dir
        .as_deref()
        .map(|dir| {
            list_instances(Path::new(dir))
                .into_iter()
                .map(|(_, info)| info)
                .filter(|info| info.instance_id != id)
                .collect()
        })
        .unwrap_or_default();
    let last = STATUS.lock().map_err(|e| e.to_string())?.clone();
    Ok(BackupStatus {
        enabled: shared_dir.is_some(),
        backup_dir: shared_dir,
        instance_id: id,
        device_name: device_name(&prefs),
        running: RUNNING.load(Ordering::SeqCst),
        last_sync_at: last.last_sync_at,
        last_error: last.last_error,
        files_copied: last.files_copied,
        bytes_copied: last.bytes_copied,
        duration_ms: last.duration_ms,
        other_instances,
    })
}

#[cfg(unix)]
fn available_space(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `path` is a valid C string and `stat` is a writable statvfs.
    if unsafe { libc::statvfs(path.as_ptr(), &mut stat) } != 0 {
        return None;
    }
    Some(stat.f_bavail as u64 * stat.f_frsize as u64)
}

#[cfg(not(unix))]
fn available_space(_dir: &Path) -> Option<u64> {
    None
}

/// What a first backup into `dir` would copy, and the free space there.
pub fn estimate_backup(app: &AppHandle, dir: &str) -> Result<BackupEstimate, String> {
    let id = instance_id(app)?;
    let target_root = instances_root(Path::new(dir)).join(id);
    let pending = scan(&get_index_dir(app)?, &get_data_dir(app)?, &target_root);
    Ok(BackupEstimate {
        bytes_needed: pending.iter().map(|p| p.size).sum(),
        files: pending.len(),
        free_bytes: available_space(Path::new(dir)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Timings on real data. Point it at a copy, never at the live data dir:
    /// `BENCH_DATA_DIR=<copy> BENCH_SHARED_DIR=<empty dir> cargo test --release
    /// --lib bench_real_data -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_real_data() {
        let data = PathBuf::from(std::env::var("BENCH_DATA_DIR").unwrap());
        let shared = PathBuf::from(std::env::var("BENCH_SHARED_DIR").unwrap());
        let app = AppHandle::new(data.clone(), data).unwrap();

        for pass in ["initial", "incremental"] {
            let started = Instant::now();
            let report = sync_once(&app, &shared).unwrap();
            println!(
                "{pass} backup: {} files, {} MB, {} digests in {:.1} s",
                report.files_copied,
                report.bytes_copied / 1_048_576,
                report.digests_written,
                started.elapsed().as_secs_f64()
            );
        }

        let own = instances_root(&shared).join(instance_id(&app).unwrap());
        let digest_bytes: u64 = std::fs::read_dir(own.join("sessions/data"))
            .unwrap()
            .flatten()
            .filter_map(|e| std::fs::metadata(e.path().join(DIGEST_FILE)).ok())
            .map(|m| m.len())
            .sum();
        println!("digests: {} MB", digest_bytes / 1_048_576);

        let (dir, info) = list_instances(&shared).remove(0);
        for query in ["zzqxnotfound", "backup", "release notes"] {
            let started = Instant::now();
            let hits = search::search_instance(
                &dir,
                &info,
                &HashMap::new(),
                query,
                &crate::chat::search::SessionSearchOptions {
                    include_archived: true,
                    ..Default::default()
                },
            );
            println!(
                "remote search {query:?}: {} hits in {} ms",
                hits.len(),
                started.elapsed().as_millis()
            );
        }
    }

    #[test]
    fn normalizes_ssh_and_https_remotes_to_the_same_key() {
        let expected = Some("github.com/azeitler/splitkick".to_string());
        assert_eq!(
            normalize_git_remote("git@github.com:azeitler/splitkick.git"),
            expected
        );
        assert_eq!(
            normalize_git_remote("https://github.com/Azeitler/Splitkick"),
            expected
        );
        assert_eq!(
            normalize_git_remote("https://user:token@github.com/azeitler/splitkick.git/"),
            expected
        );
        assert_eq!(
            normalize_git_remote("ssh://git@github.com:22/azeitler/splitkick.git"),
            expected
        );
        assert_eq!(normalize_git_remote(""), None);
        assert_eq!(normalize_git_remote("/local/path/repo"), None);
    }

    fn write(path: &Path, content: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    fn names(pending: &[PendingCopy]) -> Vec<String> {
        let mut names: Vec<String> = pending
            .iter()
            .map(|p| p.source.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn scan_picks_new_files_skips_inputs_and_running_runs() {
        let tmp = tempfile::tempdir().unwrap();
        let index = tmp.path().join("index");
        let data = tmp.path().join("data");
        let target = tmp.path().join("target");
        write(&index.join("wt-1.json"), "{}");
        write(
            &data.join("s1").join("metadata.json"),
            r#"{"runs":[{"run_id":"r1","status":"completed"},{"run_id":"r2","status":"running"}]}"#,
        );
        write(&data.join("s1").join("r1.jsonl"), "line\n");
        write(&data.join("s1").join("r2.jsonl"), "growing\n");
        write(&data.join("s1").join("r1.input.jsonl"), "temp\n");
        write(&data.join("s1").join("other.txt"), "skip\n");

        let pending = scan(&index, &data, &target);

        assert_eq!(
            names(&pending),
            vec!["metadata.json", "r1.jsonl", "wt-1.json"]
        );
        let run_log = pending
            .iter()
            .find(|p| p.source.ends_with("r1.jsonl"))
            .unwrap();
        assert_eq!(run_log.target, target.join("sessions/data/s1/r1.jsonl"));
        assert_eq!(run_log.session_id.as_deref(), Some("s1"));
    }

    #[test]
    fn scan_skips_unchanged_files_and_recopies_grown_ones() {
        let tmp = tempfile::tempdir().unwrap();
        let index = tmp.path().join("index");
        let data = tmp.path().join("data");
        let target = tmp.path().join("target");
        write(&data.join("s1").join("metadata.json"), r#"{"runs":[]}"#);
        write(&data.join("s1").join("r1.jsonl"), "one\n");

        for file in scan(&index, &data, &target) {
            copy_atomic(&file.source, &file.target).unwrap();
        }
        assert!(scan(&index, &data, &target).is_empty());

        write(&data.join("s1").join("r1.jsonl"), "one\ntwo\n");
        assert_eq!(names(&scan(&index, &data, &target)), vec!["r1.jsonl"]);
    }

    #[test]
    fn copy_atomic_leaves_no_temp_file() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("a.jsonl");
        let target = tmp.path().join("out").join("a.jsonl");
        write(&source, "content");

        assert_eq!(copy_atomic(&source, &target).unwrap(), 7);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "content");
        assert!(!target.with_extension("splitkick-tmp").exists());
    }

    #[test]
    fn list_instances_reads_instance_files_and_ignores_others() {
        let tmp = tempfile::tempdir().unwrap();
        let root = instances_root(tmp.path());
        let info = InstanceInfo {
            format_version: FORMAT_VERSION,
            instance_id: "b".to_string(),
            device_name: "mb16".to_string(),
            app_version: "1.2.1".to_string(),
            last_sync_at: 1,
        };
        write(
            &root.join("b").join("instance.json"),
            &serde_json::to_string(&info).unwrap(),
        );
        write(&root.join("junk").join("readme.txt"), "x");

        let instances = list_instances(tmp.path());

        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].1, info);
    }
}
