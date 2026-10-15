//! Import a copy of an existing Jean (or JeanZ) data folder.
//!
//! Splitkick has its own data folder. A user coming from Jean can take their
//! projects, sessions and settings along: the import **copies** Jean's folder,
//! never moves it and never writes to it. Worktrees stay where they are; the
//! copied `projects.json` still points at them.
//!
//! The import runs in two steps, because the running app already holds its
//! own (empty) state in memory and would write it back over imported files:
//!
//! 1. `import_from_jean` copies the source into `<data>/.import-staged/`,
//!    rewrites absolute paths and adjusts preferences, then writes the marker
//!    `<data>/.import-staged.json`. The frontend then restarts the app.
//! 2. `apply_staged_import` runs on the next start, before anything loads,
//!    and moves the staged entries into place. Entries the new install had
//!    already created are kept in `<data>/.pre-import/`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

const STAGED_DIR: &str = ".import-staged";
const STAGED_MARKER: &str = ".import-staged.json";
const PRE_IMPORT_DIR: &str = ".pre-import";

/// JeanZ shared Jean's folder and kept its own UI state and activity log.
const JEANZ_UI_STATE: &str = "ui-state_jeanz.json";
const JEANZ_ACTIVITY: &str = "activity_jeanz.jsonl";
/// Bundle identifier of JeanZ. Its `Application Support` folder holds only
/// the Tauri plugin state; its WebKit store holds its remote hosts.
const JEANZ_IDENTIFIER: &str = "com.jean.desktop.jeanz";

/// Import chain: for every item, JeanZ's copy wins over Jean's.
/// The bundle identifiers whose per-app stores (WebKit, cookies) are copied.
pub const SOURCE_IDENTIFIERS: [&str; 2] = [JEANZ_IDENTIFIER, crate::brand::JEAN_DATA_DIR_NAME];

/// Tauri plugin state kept per bundle identifier, beside the data folder.
const PLUGIN_STATE_FILES: [&str; 2] = [".window-state.json", ".persisted-scope"];

/// Jean's old defaults that the import replaces (see `adjust_preferences`).
const JEAN_DEFAULT_HTTP_PORT: u64 = 3456;
const JEAN_DEFAULT_RETENTION_DAYS: u64 = 7;

/// Top-level entries never copied: runtime files of the running Jean
/// (sockets, pids, host registries), logs, and crash recovery state.
const SKIP_TOP_LEVEL: &[&str] = &[
    "r",
    "k",
    "grok-acp",
    "pi-rpc-hosts",
    "kimi-acp-hosts",
    "grok-acp-hosts",
    "logs",
    "recovery",
    "trash",
    STAGED_DIR,
    STAGED_MARKER,
    PRE_IMPORT_DIR,
];

static IMPORT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    pub path: String,
    /// The folder holds JeanZ's own UI state, so the user ran JeanZ.
    pub has_jeanz_state: bool,
    pub project_count: usize,
    pub worktree_count: usize,
    pub session_count: usize,
    pub size_bytes: u64,
    /// Unix seconds of the last change to `projects.json`.
    pub last_modified: Option<u64>,
    /// Jean (or JeanZ) is running and may write while we copy.
    pub running: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub source_path: String,
    pub copied_files: u64,
    pub copied_bytes: u64,
    /// Settings the import changed, in plain words.
    pub changes: Vec<String>,
    /// Preference fields whose text still names Jean's MCP server.
    pub legacy_mcp_mentions: Vec<String>,
}

/// Written last by `stage_import`; its presence means the staging is complete.
#[derive(Debug, Default, Serialize, Deserialize)]
struct StagedMarker {}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))
}

/// Overrides the import source, for testing against a copy of a Jean folder.
const SOURCE_ENV: &str = "SPLITKICK_IMPORT_SOURCE";

/// Jean's data folder on this machine, if it exists.
fn jean_data_dir() -> Option<PathBuf> {
    let dir = match std::env::var_os(SOURCE_ENV) {
        Some(dir) => PathBuf::from(dir),
        None => dirs::data_dir()?.join(crate::brand::JEAN_DATA_DIR_NAME),
    };
    dir.join("projects.json").is_file().then_some(dir)
}

/// Whether Splitkick's own folder already holds projects (or an import).
fn target_has_data(target: &Path) -> bool {
    if target.join(STAGED_MARKER).exists() {
        return true;
    }
    let Ok(content) = fs::read_to_string(target.join("projects.json")) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<Value>(&content) else {
        return true; // unreadable: do not offer to overwrite it
    };
    ["projects", "worktrees"]
        .iter()
        .any(|key| value[key].as_array().is_some_and(|a| !a.is_empty()))
}

/// Sources Splitkick can import from. Empty when Splitkick already has data.
pub async fn detect_import_sources(app: AppHandle) -> Result<Vec<ImportSource>, String> {
    let target = data_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        if target_has_data(&target) {
            return Vec::new();
        }
        jean_data_dir()
            .filter(|source| source != &target)
            .map(|source| vec![describe_source(&source)])
            .unwrap_or_default()
    })
    .await
    .map_err(|e| format!("Import detection failed: {e}"))
}

fn describe_source(source: &Path) -> ImportSource {
    let projects: Value = fs::read_to_string(source.join("projects.json"))
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or(Value::Null);
    let count = |key: &str| projects[key].as_array().map_or(0, Vec::len);
    let session_count = fs::read_dir(source.join("sessions").join("data"))
        .map(|entries| entries.flatten().filter(|e| e.path().is_dir()).count())
        .unwrap_or(0);
    let last_modified = fs::metadata(source.join("projects.json"))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    ImportSource {
        path: source.to_string_lossy().to_string(),
        has_jeanz_state: source.join(JEANZ_UI_STATE).is_file(),
        project_count: count("projects"),
        worktree_count: count("worktrees"),
        session_count,
        size_bytes: dir_size(source),
        last_modified,
        running: source_is_running(source),
    }
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(t) if t.is_dir() => dir_size(&entry.path()),
            Ok(t) if t.is_file() => entry.metadata().map_or(0, |m| m.len()),
            _ => 0,
        })
        .sum()
}

/// A running Jean answers on its MCP socket.
#[cfg(unix)]
fn source_is_running(source: &Path) -> bool {
    std::os::unix::net::UnixStream::connect(source.join("jean-mcp.sock")).is_ok()
}

#[cfg(not(unix))]
fn source_is_running(_source: &Path) -> bool {
    false
}

/// Copy Jean's folder into the staging area. See the module docs.
pub async fn import_from_jean(
    app: AppHandle,
    source_path: String,
) -> Result<ImportSummary, String> {
    let target = data_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        let _guard = IMPORT_LOCK
            .try_lock()
            .map_err(|_| "An import is already running".to_string())?;
        let source = PathBuf::from(&source_path);
        // Only Jean's own folder: the command must not become a general copy tool.
        if Some(&source) != jean_data_dir().as_ref() {
            return Err(format!("Not a Jean data folder: {source_path}"));
        }
        if target_has_data(&target) {
            return Err("Splitkick already has projects; import only into a fresh install".into());
        }
        if source_is_running(&source) {
            return Err("Jean is running. Quit Jean (and JeanZ), then import again.".into());
        }
        stage_import(&source, &target)
    })
    .await
    .map_err(|e| format!("Import failed: {e}"))?
}

/// Copy, rewrite and adjust into `<target>/.import-staged`, then write the marker.
fn stage_import(source: &Path, target: &Path) -> Result<ImportSummary, String> {
    let staged = target.join(STAGED_DIR);
    let _ = fs::remove_dir_all(&staged);
    fs::create_dir_all(&staged).map_err(|e| format!("Failed to create staging folder: {e}"))?;

    let result = (|| {
        let mut summary = ImportSummary {
            source_path: source.to_string_lossy().to_string(),
            ..Default::default()
        };
        for entry in fs::read_dir(source).map_err(|e| format!("Failed to read {source:?}: {e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            if skip_entry(&name.to_string_lossy()) {
                continue;
            }
            copy_entry(&entry.path(), &staged.join(&name), &mut summary)?;
        }
        prefer_jeanz_state(&staged)?;
        if let Some(jeanz_dir) = source.parent().map(|parent| parent.join(JEANZ_IDENTIFIER)) {
            copy_jeanz_plugin_state(&jeanz_dir, &staged, &mut summary)?;
        }
        rewrite_paths(&staged, source, target)?;
        adjust_preferences(&staged.join("preferences.json"), &mut summary)?;
        Ok(summary)
    })();

    match result {
        Ok(summary) => {
            let marker =
                serde_json::to_string(&StagedMarker::default()).map_err(|e| e.to_string())?;
            let tmp = target.join(format!("{STAGED_MARKER}.tmp"));
            fs::write(&tmp, marker).map_err(|e| format!("Failed to write marker: {e}"))?;
            fs::rename(&tmp, target.join(STAGED_MARKER))
                .map_err(|e| format!("Failed to write marker: {e}"))?;
            Ok(summary)
        }
        Err(e) => {
            let _ = fs::remove_dir_all(&staged);
            Err(e)
        }
    }
}

fn skip_entry(name: &str) -> bool {
    SKIP_TOP_LEVEL.contains(&name)
        || name.ends_with(".sock")
        || name.ends_with(".pid")
        || name.starts_with("codex-app-server.")
        || name.ends_with("-versions-cache.json")
}

/// Copy a file, symlink or directory tree. Sockets and other special files are skipped.
pub fn copy_entry(from: &Path, to: &Path, summary: &mut ImportSummary) -> Result<(), String> {
    let meta = fs::symlink_metadata(from).map_err(|e| format!("{from:?}: {e}"))?;
    let kind = meta.file_type();
    if kind.is_symlink() {
        #[cfg(unix)]
        {
            let link = fs::read_link(from).map_err(|e| format!("{from:?}: {e}"))?;
            std::os::unix::fs::symlink(link, to).map_err(|e| format!("{to:?}: {e}"))?;
        }
    } else if kind.is_dir() {
        fs::create_dir_all(to).map_err(|e| format!("{to:?}: {e}"))?;
        for entry in fs::read_dir(from).map_err(|e| format!("{from:?}: {e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_entry(&entry.path(), &to.join(entry.file_name()), summary)?;
        }
    } else if kind.is_file() {
        let bytes = fs::copy(from, to).map_err(|e| format!("Failed to copy {from:?}: {e}"))?;
        summary.copied_files += 1;
        summary.copied_bytes += bytes;
    }
    Ok(())
}

/// JeanZ's UI state and activity log win over Jean's when both exist.
fn prefer_jeanz_state(staged: &Path) -> Result<(), String> {
    for (jeanz, plain) in [
        (JEANZ_UI_STATE, "ui-state.json"),
        (JEANZ_ACTIVITY, "activity.jsonl"),
    ] {
        let jeanz = staged.join(jeanz);
        if jeanz.exists() {
            fs::rename(&jeanz, staged.join(plain)).map_err(|e| format!("{jeanz:?}: {e}"))?;
        }
    }
    Ok(())
}

/// JeanZ's window geometry and file grants live in its own
/// `Application Support/com.jean.desktop.jeanz`; they win over Jean's copies.
fn copy_jeanz_plugin_state(
    jeanz_dir: &Path,
    staged: &Path,
    summary: &mut ImportSummary,
) -> Result<(), String> {
    for name in PLUGIN_STATE_FILES {
        let from = jeanz_dir.join(name);
        if from.is_file() {
            let to = staged.join(name);
            let _ = fs::remove_file(&to);
            copy_entry(&from, &to, summary)?;
        }
    }
    Ok(())
}

/// Sessions reference pasted images, texts and contexts by absolute path
/// inside Jean's folder. Point them at the copies. Only the exact folder
/// prefix is replaced, in JSON, JSONL and Markdown files outside the managed
/// CLI folders.
fn rewrite_paths(staged: &Path, source: &Path, target: &Path) -> Result<(), String> {
    let from = format!("{}/", source.to_string_lossy());
    let to = format!("{}/", target.to_string_lossy());
    rewrite_in_dir(staged, &from, &to, true)
}

fn rewrite_in_dir(dir: &Path, from: &str, to: &str, top: bool) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("{dir:?}: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if kind.is_dir() {
            // Managed CLI installs (`claude-cli/`, `gh-cli/`, …) hold binaries.
            if top && name.ends_with("-cli") {
                continue;
            }
            rewrite_in_dir(&path, from, to, false)?;
        } else if kind.is_file()
            && [".json", ".jsonl", ".md"]
                .iter()
                .any(|ext| name.ends_with(ext))
        {
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            if content.contains(from) {
                fs::write(&path, content.replace(from, to))
                    .map_err(|e| format!("Failed to rewrite {path:?}: {e}"))?;
            }
        }
    }
    Ok(())
}

/// Replace Jean's old defaults that clash with Splitkick: the Web Access port
/// (both apps can run at once) and the settings that deleted history.
/// Values the user chose themselves are kept.
fn adjust_preferences(path: &Path, summary: &mut ImportSummary) -> Result<(), String> {
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(());
    };
    let mut prefs: Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid Jean preferences: {e}"))?;

    if prefs["http_server_port"].as_u64() == Some(JEAN_DEFAULT_HTTP_PORT) {
        prefs["http_server_port"] = crate::brand::DEFAULT_HTTP_PORT.into();
        summary.changes.push(format!(
            "Web Access port {JEAN_DEFAULT_HTTP_PORT} → {} (Jean keeps {JEAN_DEFAULT_HTTP_PORT})",
            crate::brand::DEFAULT_HTTP_PORT
        ));
    }
    if prefs["archive_retention_days"].as_u64() == Some(JEAN_DEFAULT_RETENTION_DAYS) {
        prefs["archive_retention_days"] = 0.into();
        summary
            .changes
            .push("Archived items: deleted after 7 days → kept for ever".into());
    }
    if prefs["removal_behavior"].as_str() == Some("delete") {
        prefs["removal_behavior"] = "archive".into();
        summary
            .changes
            .push("Closing a session or worktree: delete → archive".into());
    }

    collect_mcp_mentions(&prefs, "", &mut summary.legacy_mcp_mentions);

    let json = serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| format!("Failed to write preferences: {e}"))
}

fn collect_mcp_mentions(value: &Value, path: &str, out: &mut Vec<String>) {
    match value {
        Value::String(text) if text.contains("mcp__jean") || text.contains("Jean MCP") => {
            out.push(path.to_string());
        }
        Value::Object(map) => {
            for (key, child) in map {
                let child_path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                collect_mcp_mentions(child, &child_path, out);
            }
        }
        _ => {}
    }
}

/// Move a staged import into place. Call on startup, before anything reads
/// the data folder. Returns true when an import was applied; the caller then
/// copies the per-app stores (see [`SOURCE_IDENTIFIERS`]).
pub fn apply_staged_import(data_dir: &Path) -> bool {
    let marker_path = data_dir.join(STAGED_MARKER);
    let staged = data_dir.join(STAGED_DIR);
    if !marker_path.is_file() {
        return false;
    }
    if !staged.is_dir() {
        let _ = fs::remove_file(&marker_path);
        return false;
    }

    let pre_import = data_dir.join(PRE_IMPORT_DIR);
    let Ok(entries) = fs::read_dir(&staged) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let dest = data_dir.join(&name);
        if fs::symlink_metadata(&dest).is_ok() {
            let _ = fs::create_dir_all(&pre_import);
            let kept = unique_path(&pre_import.join(&name));
            if let Err(e) = fs::rename(&dest, &kept) {
                eprintln!("Import: could not set aside {dest:?}: {e}");
                continue;
            }
        }
        if let Err(e) = fs::rename(entry.path(), &dest) {
            eprintln!("Import: could not move {name:?} into place: {e}");
        }
    }
    let _ = fs::remove_dir_all(&staged);
    let _ = fs::remove_file(&marker_path);
    true
}

/// The first of `candidates` that exists: the import chain for one item.
pub fn first_existing(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| path.exists())
}

fn unique_path(path: &Path) -> PathBuf {
    let mut candidate = path.to_path_buf();
    let mut n = 1;
    while fs::symlink_metadata(&candidate).is_ok() {
        candidate = path.with_file_name(format!(
            "{}.{n}",
            path.file_name().unwrap_or_default().to_string_lossy()
        ));
        n += 1;
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    /// A Jean folder as JeanZ left it.
    fn jean_fixture(root: &Path) -> PathBuf {
        let src = root.join("com.jean.desktop");
        let s = src.to_string_lossy().to_string();
        write(
            &src.join("projects.json"),
            r#"{"projects":[{"id":"p"}],"worktrees":[{"id":"w","path":"/Users/x/jean/p/w"}]}"#,
        );
        write(
            &src.join("preferences.json"),
            r#"{"http_server_port":3456,"archive_retention_days":7,"removal_behavior":"delete","magic_prompts":{"x":"call mcp__jean__get_current_context"}}"#,
        );
        write(&src.join("ui-state.json"), r#"{"who":"jean"}"#);
        write(&src.join(JEANZ_UI_STATE), r#"{"who":"jeanz"}"#);
        write(
            &src.join("sessions/data/s1/metadata.json"),
            &format!(r#"{{"img":"{s}/pasted-images/a.png"}}"#),
        );
        write(
            &src.join("sessions/data/s1/r1.jsonl"),
            &format!("{{\"text\":\"[Image attached: {s}/pasted-images/a.png]\"}}\n"),
        );
        write(&src.join("pasted-images/a.png"), "png");
        write(
            &src.join("gh-cli/meta.json"),
            &format!(r#"{{"p":"{s}/x"}}"#),
        );
        write(&src.join("logs/app.log"), "log");
        write(&src.join("codex-app-server.pid"), "1");
        // Stable Jean's plugin state in the shared folder; JeanZ's beside it.
        write(&src.join(".window-state.json"), "jean-window");
        write(
            &root.join(JEANZ_IDENTIFIER).join(".window-state.json"),
            "jeanz-window",
        );
        src
    }

    #[test]
    fn stages_a_copy_and_never_touches_the_source() {
        let temp = tempfile::tempdir().unwrap();
        let src = jean_fixture(temp.path());
        let target = temp.path().join("app.splitkick.desktop");
        fs::create_dir_all(&target).unwrap();
        let before = fs::read_to_string(src.join("preferences.json")).unwrap();

        let summary = stage_import(&src, &target).unwrap();

        // Source unchanged
        assert_eq!(
            fs::read_to_string(src.join("preferences.json")).unwrap(),
            before
        );
        assert!(src.join(JEANZ_UI_STATE).exists());

        let staged = target.join(STAGED_DIR);
        // Runtime files and logs are not copied
        assert!(!staged.join("logs").exists());
        assert!(!staged.join("codex-app-server.pid").exists());
        // JeanZ wins over Jean: UI state, and the window state from
        // JeanZ's own Application Support folder
        assert_eq!(
            fs::read_to_string(staged.join("ui-state.json")).unwrap(),
            r#"{"who":"jeanz"}"#
        );
        assert!(!staged.join(JEANZ_UI_STATE).exists());
        assert_eq!(
            fs::read_to_string(staged.join(".window-state.json")).unwrap(),
            "jeanz-window"
        );
        // Paths point at the copy, but not inside managed CLI folders
        let t = target.to_string_lossy();
        let meta = fs::read_to_string(staged.join("sessions/data/s1/metadata.json")).unwrap();
        assert!(meta.contains(&format!("{t}/pasted-images/a.png")), "{meta}");
        let run = fs::read_to_string(staged.join("sessions/data/s1/r1.jsonl")).unwrap();
        assert!(run.contains(&format!("{t}/pasted-images/a.png")), "{run}");
        let cli = fs::read_to_string(staged.join("gh-cli/meta.json")).unwrap();
        assert!(cli.contains(&src.to_string_lossy().to_string()));
        // Worktree paths are kept
        let projects = fs::read_to_string(staged.join("projects.json")).unwrap();
        assert!(projects.contains("/Users/x/jean/p/w"));
        // Old defaults replaced
        let prefs: Value =
            serde_json::from_str(&fs::read_to_string(staged.join("preferences.json")).unwrap())
                .unwrap();
        assert_eq!(prefs["http_server_port"], 3460);
        assert_eq!(prefs["archive_retention_days"], 0);
        assert_eq!(prefs["removal_behavior"], "archive");
        assert_eq!(summary.changes.len(), 3);
        assert_eq!(
            summary.legacy_mcp_mentions,
            vec!["magic_prompts.x".to_string()]
        );
        assert!(target.join(STAGED_MARKER).exists());
    }

    #[test]
    fn without_jeanz_the_chain_falls_back_to_jean() {
        let temp = tempfile::tempdir().unwrap();
        let src = jean_fixture(temp.path());
        fs::remove_file(src.join(JEANZ_UI_STATE)).unwrap();
        fs::remove_dir_all(temp.path().join(JEANZ_IDENTIFIER)).unwrap();
        write(
            &src.join("preferences.json"),
            r#"{"http_server_port":4000,"archive_retention_days":14,"removal_behavior":"archive"}"#,
        );
        let target = temp.path().join("app.splitkick.desktop");
        fs::create_dir_all(&target).unwrap();

        let summary = stage_import(&src, &target).unwrap();

        let staged = target.join(STAGED_DIR);
        assert_eq!(
            fs::read_to_string(staged.join("ui-state.json")).unwrap(),
            r#"{"who":"jean"}"#
        );
        assert_eq!(
            fs::read_to_string(staged.join(".window-state.json")).unwrap(),
            "jean-window"
        );
        let prefs: Value =
            serde_json::from_str(&fs::read_to_string(staged.join("preferences.json")).unwrap())
                .unwrap();
        assert_eq!(prefs["http_server_port"], 4000);
        assert_eq!(prefs["archive_retention_days"], 14);
        assert!(summary.changes.is_empty());
    }

    #[test]
    fn applies_the_staged_import_and_keeps_what_was_there() {
        let temp = tempfile::tempdir().unwrap();
        let src = jean_fixture(temp.path());
        let target = temp.path().join("app.splitkick.desktop");
        write(&target.join("preferences.json"), r#"{"fresh":true}"#);
        stage_import(&src, &target).unwrap();

        assert!(apply_staged_import(&target));
        assert!(target.join("projects.json").exists());
        assert!(target.join("sessions/data/s1/metadata.json").exists());
        assert!(fs::read_to_string(target.join("preferences.json"))
            .unwrap()
            .contains("3460"));
        assert_eq!(
            fs::read_to_string(target.join(PRE_IMPORT_DIR).join("preferences.json")).unwrap(),
            r#"{"fresh":true}"#
        );
        assert!(!target.join(STAGED_DIR).exists());
        assert!(!target.join(STAGED_MARKER).exists());
        // Nothing to apply the second time
        assert!(!apply_staged_import(&target));
    }

    #[test]
    fn the_chain_takes_the_first_existing_store() {
        let temp = tempfile::tempdir().unwrap();
        let jeanz = temp.path().join(JEANZ_IDENTIFIER);
        let jean = temp.path().join("com.jean.desktop");
        let chain = || {
            SOURCE_IDENTIFIERS
                .iter()
                .map(|id| temp.path().join(id))
                .collect::<Vec<_>>()
        };
        assert_eq!(first_existing(chain()), None);
        fs::create_dir_all(&jean).unwrap();
        assert_eq!(first_existing(chain()), Some(jean));
        fs::create_dir_all(&jeanz).unwrap();
        assert_eq!(first_existing(chain()), Some(jeanz));
    }

    #[test]
    fn a_target_with_projects_is_not_offered_an_import() {
        let temp = tempfile::tempdir().unwrap();
        assert!(!target_has_data(temp.path()));
        write(
            &temp.path().join("projects.json"),
            r#"{"projects":[],"worktrees":[]}"#,
        );
        assert!(!target_has_data(temp.path()));
        write(
            &temp.path().join("projects.json"),
            r#"{"projects":[{"id":"p"}],"worktrees":[]}"#,
        );
        assert!(target_has_data(temp.path()));
    }

    /// Run against a copy of a real Jean folder:
    /// `JEAN_IMPORT_FIXTURE=<copy> SPLITKICK_IMPORT_TARGET=<empty dir> cargo test --lib real_jean_folder -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_jean_folder_imports() {
        let src = PathBuf::from(std::env::var("JEAN_IMPORT_FIXTURE").expect("JEAN_IMPORT_FIXTURE"));
        let target = PathBuf::from(
            std::env::var("SPLITKICK_IMPORT_TARGET").expect("SPLITKICK_IMPORT_TARGET"),
        );
        fs::create_dir_all(&target).unwrap();
        let summary = stage_import(&src, &target).unwrap();
        println!("{summary:#?}");
        assert!(apply_staged_import(&target));
        let source_prefix = format!("{}/", src.to_string_lossy());
        let mut leftovers = 0;
        for entry in fs::read_dir(target.join("sessions/data"))
            .unwrap()
            .flatten()
        {
            let meta = fs::read_to_string(entry.path().join("metadata.json")).unwrap_or_default();
            if meta.contains(&source_prefix) {
                leftovers += 1;
            }
        }
        println!("sessions still pointing at the source: {leftovers}");
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn a_failed_stage_leaves_no_marker() {
        let temp = tempfile::tempdir().unwrap();
        let src = jean_fixture(temp.path());
        write(&src.join("preferences.json"), "{ not json");
        let target = temp.path().join("app.splitkick.desktop");
        fs::create_dir_all(&target).unwrap();

        assert!(stage_import(&src, &target).is_err());
        assert!(!target.join(STAGED_MARKER).exists());
        assert!(!target.join(STAGED_DIR).exists());
    }
}
