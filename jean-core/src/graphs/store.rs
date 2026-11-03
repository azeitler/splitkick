//! Graph file IO, registry, locks and the outside-edit poller.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Once};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use tauri::AppHandle;
use uuid::Uuid;

use super::model::{GraphFile, RegistryEntry};
use crate::http_server::EmitExt;

/// Serializes read-modify-write of app-data files (registry, changes, requests, seen).
pub(super) static APP_DATA_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// Per graph-file locks.
static FILE_LOCKS: Lazy<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Last mtime Splitkick saw (or wrote) per graph file. `None` = missing.
static KNOWN_MTIMES: Lazy<Mutex<HashMap<PathBuf, Option<SystemTime>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static POLLER: Once = Once::new();

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn file_lock(path: &Path) -> Arc<Mutex<()>> {
    FILE_LOCKS
        .lock()
        .unwrap()
        .entry(path.to_path_buf())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

pub(super) fn graphs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?
        .join("graphs");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create graphs dir: {e}"))?;
    Ok(dir)
}

/// Keep file names safe even if an id was hand-edited.
pub(super) fn safe_name(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Write via a uuid `.tmp` file + rename.
pub(super) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    fs::write(&tmp, bytes).map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Failed to finalize {}: {e}", path.display())
    })
}

pub(super) fn read_json<T: serde::de::DeserializeOwned + Default>(
    path: &Path,
) -> Result<T, String> {
    if !path.exists() {
        return Ok(T::default());
    }
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(T::default());
    }
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse {}: {e}", path.display()))
}

pub(super) fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(value).map_err(|e| format!("Failed to serialize: {e}"))?;
    write_atomic(path, json.as_bytes())
}

// ============================================================================
// Registry
// ============================================================================

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(graphs_dir(app)?.join("registry.json"))
}

pub fn load_registry(app: &AppHandle) -> Result<Vec<RegistryEntry>, String> {
    let _guard = APP_DATA_LOCK.lock().unwrap();
    read_json(&registry_path(app)?)
}

/// Read-modify-write the registry under the module lock.
pub(super) fn with_registry_mut<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut Vec<RegistryEntry>) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = APP_DATA_LOCK.lock().unwrap();
    let path = registry_path(app)?;
    let mut entries: Vec<RegistryEntry> = read_json(&path)?;
    let result = f(&mut entries)?;
    write_json(&path, &entries)?;
    Ok(result)
}

pub fn graph_path(app: &AppHandle, graph_id: &str) -> Result<PathBuf, String> {
    load_registry(app)?
        .into_iter()
        .find(|e| e.id == graph_id)
        .map(|e| PathBuf::from(e.path))
        .ok_or_else(|| format!("Unknown graph: {graph_id}"))
}

// ============================================================================
// Graph files
// ============================================================================

fn mtime(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|m| m.modified()).ok()
}

fn remember_mtime(path: &Path) {
    KNOWN_MTIMES
        .lock()
        .unwrap()
        .insert(path.to_path_buf(), mtime(path));
}

pub fn parse_graph(content: &str) -> Result<GraphFile, String> {
    if content.trim().is_empty() {
        return Ok(GraphFile::default());
    }
    serde_yaml::from_str(content).map_err(|e| format!("Invalid graph file: {e}"))
}

pub fn serialize_graph(graph: &GraphFile) -> Result<String, String> {
    serde_yaml::to_string(graph).map_err(|e| format!("Failed to serialize graph: {e}"))
}

pub fn read_graph_file(path: &Path) -> Result<GraphFile, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    parse_graph(&content)
}

/// Write a graph file and remember its mtime so the poller ignores our own write.
pub fn write_graph_file(path: &Path, graph: &GraphFile) -> Result<(), String> {
    write_atomic(path, serialize_graph(graph)?.as_bytes())?;
    remember_mtime(path);
    Ok(())
}

/// Read-modify-write a graph file under its lock. Always re-reads from disk,
/// so an outside edit is never overwritten. Nothing is written when `f` fails.
pub fn with_graph_file_mut<T>(
    path: &Path,
    f: impl FnOnce(&mut GraphFile) -> Result<T, String>,
) -> Result<T, String> {
    let lock = file_lock(path);
    let _guard = lock.lock().unwrap();
    let mut graph = read_graph_file(path)?;
    let original = graph.clone();
    let result = f(&mut graph)?;
    if graph != original {
        write_graph_file(path, &graph)?;
    }
    Ok(result)
}

pub fn with_graph_mut<T>(
    app: &AppHandle,
    graph_id: &str,
    f: impl FnOnce(&mut GraphFile) -> Result<T, String>,
) -> Result<T, String> {
    ensure_poller(app);
    let path = graph_path(app, graph_id)?;
    with_graph_file_mut(&path, f)
}

pub fn load_graph(app: &AppHandle, graph_id: &str) -> Result<GraphFile, String> {
    let path = graph_path(app, graph_id)?;
    read_graph_file(&path)
}

// ============================================================================
// Change notification
// ============================================================================

/// Tell every client to refetch graph queries.
pub fn emit_graphs_changed(app: &AppHandle, also_sessions: bool) {
    let keys: &[&str] = if also_sessions {
        &["graphs", "sessions"]
    } else {
        &["graphs"]
    };
    if let Err(e) = app.emit_all("cache:invalidate", &serde_json::json!({ "keys": keys })) {
        log::error!("Failed to emit cache:invalidate: {e}");
    }
}

/// Whether any registered file changed since we last saw it. Updates the known mtimes.
fn poll_once(app: &AppHandle) -> bool {
    let Ok(entries) = load_registry(app) else {
        return false;
    };
    let mut known = KNOWN_MTIMES.lock().unwrap();
    let mut changed = false;
    for entry in entries {
        let path = PathBuf::from(entry.path);
        let current = mtime(&path);
        match known.insert(path, current) {
            Some(previous) if previous != current => changed = true,
            _ => {}
        }
    }
    changed
}

/// Sessions that ran at the last poll (`chat::registry`), sorted.
static RUNNING_SESSIONS: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// Whether the set of running sessions changed since the last call. A node's
/// `active` badge is derived from it, and a run starting or ending does not
/// touch any graph file.
fn running_sessions_changed(current: Vec<String>) -> bool {
    let mut known = RUNNING_SESSIONS.lock().unwrap();
    if *known == current {
        return false;
    }
    *known = current;
    true
}

/// Start the 2 s mtime poller once per process.
pub fn ensure_poller(app: &AppHandle) {
    // Tests use throwaway data dirs; a process-wide poller would outlive them.
    if cfg!(test) {
        return;
    }
    POLLER.call_once(|| {
        poll_once(app);
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("graph-poller".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(2));
                let running = running_sessions_changed(
                    crate::chat::registry::actively_managed_session_ids(),
                );
                if poll_once(&app) || running {
                    emit_graphs_changed(&app, false);
                }
            });
        if let Err(e) = spawned {
            log::error!("Failed to start graph poller: {e}");
        }
    });
}

#[cfg(test)]
pub(super) fn poll_once_for_test(app: &AppHandle) -> bool {
    poll_once(app)
}

#[cfg(test)]
pub(super) fn running_sessions_changed_for_test(current: Vec<String>) -> bool {
    running_sessions_changed(current)
}
