//! Transferring a session, with its history, to another Jean instance.
//!
//! A transfer is a fork across machines. The source exports a [`SessionBundle`]
//! (`export_session_bundle`); the frontend posts it to the target through
//! `POST /api/invoke`, which runs `import_session_bundle` there. The source session
//! is never modified.
//!
//! Backend resume ids point into the source machine's `~/.claude`, `~/.codex`, …, so
//! the imported session always uses [`PendingFork::Handoff`]: its first send prepends
//! the hidden `<jean_fork_handoff>` block built from the copied run logs.
//!
//! Not transferred (v1): git-context references, checkpoints and the code itself.
//! The user pushes and pulls the branch.

use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::fork::{
    drop_in_flight_run, prepare_forked_metadata, prepare_forked_session, rendered_message_count,
    sanitize_forked_run,
};
use super::storage;
use super::types::{PendingFork, RunEntry, Session, SessionMetadata};
use crate::http_server::EmitExt;

/// Bump when the bundle shape changes incompatibly. Import rejects other versions.
pub const SESSION_BUNDLE_FORMAT_VERSION: u32 = 1;

/// Everything a target Jean needs to recreate a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBundle {
    pub format_version: u32,
    pub session: Session,
    /// The source metadata, with `runs` reduced to the finished runs that ship.
    pub metadata: Option<SessionMetadata>,
    /// `{run_id}.jsonl` run logs.
    pub run_logs: Vec<BundleFile>,
    /// Attached saved contexts, named `context-…` (the source session id prefix is
    /// stripped, the target adds its own).
    pub contexts: Vec<BundleFile>,
    /// Pasted images and text files that the runs reference.
    pub attachments: Vec<BundleAttachment>,
    /// The source's pasted-file directories, so the target can rewrite the paths
    /// inside the run logs and user messages.
    pub source_dirs: BundleDirs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundleFile {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AttachmentDir {
    PastedImages,
    PastedTexts,
}

impl AttachmentDir {
    fn dir_name(self) -> &'static str {
        match self {
            Self::PastedImages => "pasted-images",
            Self::PastedTexts => "pasted-texts",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundleAttachment {
    pub dir: AttachmentDir,
    pub file_name: String,
    /// File bytes, base64 (standard alphabet).
    pub base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundleDirs {
    pub pasted_images: String,
    pub pasted_texts: String,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))
}

fn local_dirs(app: &AppHandle) -> Result<BundleDirs, String> {
    let base = app_data_dir(app)?;
    Ok(BundleDirs {
        pasted_images: base.join("pasted-images").to_string_lossy().into_owned(),
        pasted_texts: base.join("pasted-texts").to_string_lossy().into_owned(),
    })
}

/// A bundle names files; it must never name a path. Rejects separators, `..` and
/// anything else that is not one plain file name.
fn is_plain_file_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\'])
        && Path::new(name).file_name().and_then(|n| n.to_str()) == Some(name)
}

// ============================================================================
// Export
// ============================================================================

/// Pack a session for another Jean: metadata, finished run logs, attached saved
/// contexts and the pasted files the runs reference.
///
/// A turn still in flight is left out (see `drop_in_flight_run`), so the target
/// never shows a half-written answer.
pub async fn export_session_bundle(
    app: AppHandle,
    worktree_id: String,
    session_id: String,
) -> Result<SessionBundle, String> {
    let sessions = storage::load_sessions_by_id(&app, &worktree_id)?;
    let mut session = sessions
        .find_session(&session_id)
        .cloned()
        .ok_or_else(|| format!("Session not found: {session_id}"))?;
    // History lives in the run logs; inline messages would only double the payload.
    session.messages.clear();

    let mut metadata = storage::load_metadata(&app, &session_id)?;
    let mut runs = metadata
        .as_ref()
        .map(|m| m.runs.clone())
        .unwrap_or_default();
    drop_in_flight_run(&mut runs);
    if let Some(metadata) = metadata.as_mut() {
        metadata.runs = runs.clone();
    }

    let run_logs = read_run_logs(&app, &session_id, &runs)?;
    let contexts = read_attached_contexts(&app, &session_id)?;
    let source_dirs = local_dirs(&app)?;
    let attachments = read_attachments(&runs, &source_dirs)?;

    log::info!(
        "Exported session {session_id} for transfer (runs={}, contexts={}, attachments={})",
        run_logs.len(),
        contexts.len(),
        attachments.len()
    );

    Ok(SessionBundle {
        format_version: SESSION_BUNDLE_FORMAT_VERSION,
        session,
        metadata,
        run_logs,
        contexts,
        attachments,
        source_dirs,
    })
}

/// Read `{run_id}.jsonl` for each run. `{run_id}.input.jsonl` is a consumed stdin
/// payload and is skipped, the same rule as `copy_session_run_files`.
fn read_run_logs(
    app: &AppHandle,
    session_id: &str,
    runs: &[RunEntry],
) -> Result<Vec<BundleFile>, String> {
    let dir = storage::get_session_dir(app, session_id)?;
    let mut files = Vec::new();
    for run in runs {
        let name = format!("{}.jsonl", run.run_id);
        let path = dir.join(&name);
        if !path.is_file() {
            continue;
        }
        let content =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read run log {name}: {e}"))?;
        files.push(BundleFile { name, content });
    }
    Ok(files)
}

fn read_attached_contexts(app: &AppHandle, session_id: &str) -> Result<Vec<BundleFile>, String> {
    let dir = app_data_dir(app)?.join("session-context");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let prefix = format!("{session_id}-context-");
    let mut files = Vec::new();
    for entry in
        fs::read_dir(&dir).map_err(|e| format!("Failed to read session-context directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read session-context entry: {e}"))?;
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if !name.starts_with(&prefix) {
            continue;
        }
        let content = fs::read_to_string(entry.path())
            .map_err(|e| format!("Failed to read attached context {name}: {e}"))?;
        files.push(BundleFile {
            // Keep `context-…`; the target prefixes its own session id.
            name: name[session_id.len() + 1..].to_string(),
            content,
        });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

/// Pasted files the runs reference. Only files directly inside the pasted-images
/// and pasted-texts directories ship; any other path stays a dangling reference.
fn read_attachments(runs: &[RunEntry], dirs: &BundleDirs) -> Result<Vec<BundleAttachment>, String> {
    let mut paths: Vec<String> = runs
        .iter()
        .flat_map(|run| {
            let mut paths = super::commands::extract_image_paths(&run.user_message);
            paths.extend(super::commands::extract_text_file_paths(&run.user_message));
            paths
        })
        .collect();
    paths.sort();
    paths.dedup();

    let images = Path::new(&dirs.pasted_images);
    let texts = Path::new(&dirs.pasted_texts);
    let mut attachments = Vec::new();
    for path in paths {
        let path = PathBuf::from(path);
        let dir = match path.parent() {
            Some(parent) if parent == images => AttachmentDir::PastedImages,
            Some(parent) if parent == texts => AttachmentDir::PastedTexts,
            _ => continue,
        };
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            // Deleted since: the run still renders, just without the file.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("Failed to read {}: {e}", path.display())),
        };
        attachments.push(BundleAttachment {
            dir,
            file_name: file_name.to_string(),
            base64: STANDARD.encode(bytes),
        });
    }
    Ok(attachments)
}

// ============================================================================
// Import
// ============================================================================

/// Recreate a transferred session in `worktree_id` and make it the active tab.
///
/// The new session gets a fresh id, no backend resume ids and
/// `pending_fork = Handoff`, so its first send hands the copied history to the model.
pub async fn import_session_bundle(
    app: AppHandle,
    worktree_id: String,
    bundle: SessionBundle,
) -> Result<Session, String> {
    if bundle.format_version != SESSION_BUNDLE_FORMAT_VERSION {
        return Err(format!(
            "Unsupported session bundle version {} (this Splitkick reads version {SESSION_BUNDLE_FORMAT_VERSION}). Update both instances to the same version.",
            bundle.format_version
        ));
    }
    ensure_active_worktree(&app, &worktree_id)?;
    validate_bundle_names(&bundle)?;

    let local = local_dirs(&app)?;
    write_attachments(&app, &bundle.attachments)?;

    let created_at = now();
    let strategy = PendingFork::Handoff;
    let mut runs = bundle
        .metadata
        .as_ref()
        .map(|m| m.runs.clone())
        .unwrap_or_default();
    for run in &mut runs {
        sanitize_forked_run(run, created_at);
        run.user_message = rewrite_paths(&run.user_message, &bundle.source_dirs, &local, false);
    }

    let mut session = prepare_forked_session(&bundle.session, 0, created_at, strategy);
    // A transfer is the same conversation on another machine, not a "Fork of".
    session.name = bundle.session.name.clone();
    session.message_count = Some(rendered_message_count(&runs));
    let new_id = session.id.clone();

    let session_dir = storage::get_session_dir(&app, &new_id)?;
    for log in &bundle.run_logs {
        let content = rewrite_paths(&log.content, &bundle.source_dirs, &local, true);
        fs::write(session_dir.join(&log.name), content)
            .map_err(|e| format!("Failed to write run log {}: {e}", log.name))?;
    }

    let mut metadata = prepare_forked_metadata(
        bundle.metadata.clone(),
        &session,
        &bundle.session.id,
        &worktree_id,
        runs,
        strategy,
    );
    // The source session id does not exist on this machine.
    metadata.forked_from_session_id = None;

    // Same write order as `fork_session_in_place`: metadata first, so
    // `with_sessions_mut` never sees a run-less metadata file.
    storage::save_metadata(&app, &metadata)?;
    let saved = storage::with_sessions_mut(&app, "", &worktree_id, |sessions| {
        let mut imported = session.clone();
        imported.order = sessions.sessions.len() as u32;
        sessions.sessions.push(imported.clone());
        sessions.active_session_id = Some(imported.id.clone());
        Ok(imported)
    })?;

    if let Err(e) = write_contexts(&app, &new_id, &bundle.contexts) {
        log::warn!("Transfer: failed to write attached contexts for {new_id}: {e}");
    }

    let _ = app.emit_all(
        "cache:invalidate",
        &serde_json::json!({ "keys": ["sessions", "session"] }),
    );

    log::info!(
        "Imported transferred session {} -> {new_id} in worktree {worktree_id} (runs={}, attachments={})",
        bundle.session.id,
        bundle.run_logs.len(),
        bundle.attachments.len()
    );
    Ok(saved)
}

fn ensure_active_worktree(app: &AppHandle, worktree_id: &str) -> Result<(), String> {
    let data = crate::projects::storage::load_projects_data(app)?;
    match data.find_worktree(worktree_id) {
        None => Err(format!("Worktree not found: {worktree_id}")),
        Some(worktree) if worktree.archived_at.is_some() => {
            Err(format!("Worktree {} is archived", worktree.name))
        }
        Some(_) => Ok(()),
    }
}

/// Reject a bundle before anything is written if one of its file names could
/// escape the directory it is written to.
fn validate_bundle_names(bundle: &SessionBundle) -> Result<(), String> {
    for log in &bundle.run_logs {
        let valid = is_plain_file_name(&log.name)
            && log.name.ends_with(".jsonl")
            && !log.name.ends_with(".input.jsonl");
        if !valid {
            return Err(format!("Invalid run log name in bundle: {}", log.name));
        }
    }
    for context in &bundle.contexts {
        if !is_plain_file_name(&context.name) || !context.name.starts_with("context-") {
            return Err(format!("Invalid context name in bundle: {}", context.name));
        }
    }
    for attachment in &bundle.attachments {
        if !is_plain_file_name(&attachment.file_name) {
            return Err(format!(
                "Invalid attachment name in bundle: {}",
                attachment.file_name
            ));
        }
    }
    Ok(())
}

/// Write pasted files under their original name. Pasted names are unique (a
/// timestamp and random suffix), so an existing file is the same file and is kept.
fn write_attachments(app: &AppHandle, attachments: &[BundleAttachment]) -> Result<(), String> {
    let base = app_data_dir(app)?;
    for attachment in attachments {
        let dir = base.join(attachment.dir.dir_name());
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
        let path = dir.join(&attachment.file_name);
        if path.exists() {
            continue;
        }
        let bytes = STANDARD
            .decode(&attachment.base64)
            .map_err(|e| format!("Invalid attachment {}: {e}", attachment.file_name))?;
        fs::write(&path, bytes).map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    }
    Ok(())
}

fn write_contexts(
    app: &AppHandle,
    session_id: &str,
    contexts: &[BundleFile],
) -> Result<(), String> {
    if contexts.is_empty() {
        return Ok(());
    }
    let dir = app_data_dir(app)?.join("session-context");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create session-context: {e}"))?;
    for context in contexts {
        let path = dir.join(format!("{session_id}-{}", context.name));
        fs::write(&path, &context.content)
            .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    }
    Ok(())
}

/// Point pasted-file paths at this machine's directories.
///
/// `json_escaped` is for run log lines, where a path sits inside a JSON string: a
/// Windows path's backslashes are escaped there, so both sides are escaped the same
/// way before the replace. On macOS and Linux both forms are equal.
fn rewrite_paths(text: &str, from: &BundleDirs, to: &BundleDirs, json_escaped: bool) -> String {
    let form = |dir: &str| -> String {
        if json_escaped {
            let quoted = serde_json::to_string(dir).unwrap_or_default();
            quoted.trim_matches('"').to_string()
        } else {
            dir.to_string()
        }
    };
    let mut text = text.to_string();
    for (source, target) in [
        (&from.pasted_images, &to.pasted_images),
        (&from.pasted_texts, &to.pasted_texts),
    ] {
        if source.is_empty() || source == target {
            continue;
        }
        text = text.replace(&form(source), &form(target));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::types::{Backend, RunStatus};
    use crate::projects::types::{ProjectsData, Worktree};
    use crate::runtime::RuntimeContext;

    fn run(run_id: &str, status: RunStatus, user_message: &str) -> RunEntry {
        RunEntry {
            run_id: run_id.to_string(),
            user_message_id: format!("u-{run_id}"),
            user_message: user_message.to_string(),
            model: None,
            execution_mode: None,
            thinking_level: None,
            effort_level: None,
            backend: None,
            custom_profile_name: None,
            started_at: 0,
            ended_at: Some(1),
            status,
            assistant_message_id: Some(format!("a-{run_id}")),
            cancelled: false,
            recovered: false,
            claude_session_id: None,
            pid: Some(42),
            usage: None,
            codex_thread_id: None,
            codex_turn_id: None,
            cursor_chat_id: None,
            grok_session_id: None,
            kimi_session_id: None,
            antigravity_session_id: None,
            checkpoint_id: Some("checkpoint".to_string()),
            limit_hit: None,
        }
    }

    /// The loader archives a worktree whose folder is missing, so each gets one.
    fn worktree(temp: &tempfile::TempDir, id: &str, archived: bool) -> Worktree {
        let path = temp.path().join("worktrees").join(id);
        fs::create_dir_all(&path).unwrap();
        serde_json::from_value(serde_json::json!({
            "id": id,
            "project_id": "project-1",
            "name": id,
            "path": path.to_string_lossy(),
            "branch": "main",
            "created_at": 0,
            "archived_at": if archived { Some(5) } else { None },
        }))
        .expect("worktree json")
    }

    fn app_with_worktrees(temp: &tempfile::TempDir) -> AppHandle {
        let app = RuntimeContext::new(temp.path().into(), temp.path().into()).unwrap();
        let data = ProjectsData {
            projects: vec![],
            worktrees: vec![
                worktree(temp, "wt-target", false),
                worktree(temp, "wt-archived", true),
            ],
        };
        crate::projects::storage::save_projects_data(&app, &data).unwrap();
        app
    }

    /// A source session with two finished turns (the first with a pasted image),
    /// one turn still running, every resume id set and one attached context.
    fn seed_source(app: &AppHandle) -> (String, String) {
        let worktree_id = "wt-source".to_string();
        let dirs = local_dirs(app).unwrap();
        fs::create_dir_all(&dirs.pasted_images).unwrap();
        let image = Path::new(&dirs.pasted_images).join("image-1.png");
        fs::write(&image, b"png-bytes").unwrap();
        let image_ref = format!(
            "look [Image attached: {} - Use the Read tool to view this image]",
            image.display()
        );

        let session = storage::with_sessions_mut(app, "", &worktree_id, |sessions| {
            let mut session = Session::new("Build auth".to_string(), 0, Backend::Claude);
            session.claude_session_id = Some("claude-1".to_string());
            session.codex_thread_id = Some("codex-1".to_string());
            sessions.sessions.push(session.clone());
            Ok(session)
        })
        .unwrap();
        let session_id = session.id.clone();

        storage::with_metadata_mut(app, &session_id, &worktree_id, "Build auth", 0, |m| {
            m.backend = Backend::Claude;
            m.claude_session_id = Some("claude-1".to_string());
            m.runs = vec![
                run("r1", RunStatus::Completed, &image_ref),
                run("r2", RunStatus::Completed, "second"),
                run("r3", RunStatus::Running, "in flight"),
            ];
            Ok(())
        })
        .unwrap();

        let session_dir = storage::get_session_dir(app, &session_id).unwrap();
        let image_json = serde_json::to_string(&image.display().to_string()).unwrap();
        fs::write(
            session_dir.join("r1.jsonl"),
            format!("{{\"path\":{image_json}}}\n"),
        )
        .unwrap();
        fs::write(session_dir.join("r2.jsonl"), "{\"n\":2}\n").unwrap();
        fs::write(session_dir.join("r3.jsonl"), "{\"n\":3}\n").unwrap();
        fs::write(session_dir.join("r1.input.jsonl"), "stdin").unwrap();

        let context_dir = temp_context_dir(app);
        fs::write(
            context_dir.join(format!("{session_id}-context-notes.md")),
            "saved context",
        )
        .unwrap();
        (worktree_id, session_id)
    }

    fn temp_context_dir(app: &AppHandle) -> PathBuf {
        let dir = app_data_dir(app).unwrap().join("session-context");
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("test runtime")
            .block_on(future)
    }

    #[test]
    fn export_ships_finished_runs_contexts_and_referenced_attachments() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_with_worktrees(&temp);
        let (worktree_id, session_id) = seed_source(&app);

        let bundle = block_on(export_session_bundle(app.clone(), worktree_id, session_id)).unwrap();

        assert_eq!(bundle.format_version, 1);
        let names: Vec<&str> = bundle.run_logs.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["r1.jsonl", "r2.jsonl"],
            "the running turn and the stdin payload never ship"
        );
        assert_eq!(bundle.metadata.as_ref().unwrap().runs.len(), 2);
        assert_eq!(bundle.contexts.len(), 1);
        assert_eq!(bundle.contexts[0].name, "context-notes.md");
        assert_eq!(bundle.attachments.len(), 1);
        assert_eq!(bundle.attachments[0].dir, AttachmentDir::PastedImages);
        assert_eq!(bundle.attachments[0].file_name, "image-1.png");
        assert_eq!(
            STANDARD.decode(&bundle.attachments[0].base64).unwrap(),
            b"png-bytes"
        );
    }

    #[test]
    fn import_recreates_the_session_as_a_handoff_fork() {
        let source_temp = tempfile::tempdir().unwrap();
        let source = app_with_worktrees(&source_temp);
        let (worktree_id, session_id) = seed_source(&source);
        let bundle = block_on(export_session_bundle(
            source.clone(),
            worktree_id,
            session_id.clone(),
        ))
        .unwrap();
        // The bundle crosses the wire as JSON.
        let bundle: SessionBundle =
            serde_json::from_str(&serde_json::to_string(&bundle).unwrap()).unwrap();

        let target_temp = tempfile::tempdir().unwrap();
        let target = app_with_worktrees(&target_temp);
        let imported = block_on(import_session_bundle(
            target.clone(),
            "wt-target".to_string(),
            bundle,
        ))
        .unwrap();

        assert_ne!(imported.id, session_id);
        assert_eq!(imported.name, "Build auth", "no \"Fork of\" prefix");
        assert_eq!(
            imported.claude_session_id, None,
            "even Claude must not resume"
        );
        assert_eq!(imported.codex_thread_id, None);
        assert_eq!(imported.message_count, Some(4));

        let metadata = storage::load_metadata(&target, &imported.id)
            .unwrap()
            .unwrap();
        assert_eq!(metadata.pending_fork, Some(PendingFork::Handoff));
        assert_eq!(metadata.forked_from_session_id, None);
        assert_eq!(metadata.claude_session_id, None);
        assert_eq!(metadata.worktree_id, "wt-target");
        assert_eq!(metadata.runs.len(), 2);
        assert!(metadata
            .runs
            .iter()
            .all(|r| r.pid.is_none() && r.checkpoint_id.is_none()));

        // Pasted paths point at the target's directories, in the run entry and the log.
        let target_dirs = local_dirs(&target).unwrap();
        let target_image = Path::new(&target_dirs.pasted_images).join("image-1.png");
        assert_eq!(fs::read(&target_image).unwrap(), b"png-bytes");
        assert!(metadata.runs[0]
            .user_message
            .contains(&target_image.display().to_string()));
        let log = fs::read_to_string(
            storage::get_session_dir(&target, &imported.id)
                .unwrap()
                .join("r1.jsonl"),
        )
        .unwrap();
        assert!(log.contains(&target_image.display().to_string()), "{log}");
        assert!(
            !log.contains(&source_temp.path().display().to_string()),
            "{log}"
        );

        let context = temp_context_dir(&target).join(format!("{}-context-notes.md", imported.id));
        assert_eq!(fs::read_to_string(context).unwrap(), "saved context");

        let sessions = storage::load_sessions_by_id(&target, "wt-target").unwrap();
        assert_eq!(
            sessions.active_session_id.as_deref(),
            Some(imported.id.as_str())
        );
    }

    #[test]
    fn import_settles_a_running_run_from_a_foreign_bundle() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_with_worktrees(&temp);
        let mut metadata = SessionMetadata::new("s".into(), "w".into(), "n".into(), 0);
        metadata.runs = vec![run("r1", RunStatus::Running, "hi")];
        let bundle = SessionBundle {
            format_version: 1,
            session: Session::new("n".into(), 0, Backend::Codex),
            metadata: Some(metadata),
            run_logs: vec![],
            contexts: vec![],
            attachments: vec![],
            source_dirs: BundleDirs::default(),
        };

        let imported = block_on(import_session_bundle(
            app.clone(),
            "wt-target".into(),
            bundle,
        ))
        .unwrap();

        let metadata = storage::load_metadata(&app, &imported.id).unwrap().unwrap();
        assert_eq!(metadata.runs[0].status, RunStatus::Crashed);
    }

    fn empty_bundle() -> SessionBundle {
        SessionBundle {
            format_version: 1,
            session: Session::new("n".into(), 0, Backend::Claude),
            metadata: None,
            run_logs: vec![],
            contexts: vec![],
            attachments: vec![],
            source_dirs: BundleDirs::default(),
        }
    }

    #[test]
    fn import_rejects_an_unknown_bundle_version() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_with_worktrees(&temp);
        let mut bundle = empty_bundle();
        bundle.format_version = 2;

        let error = block_on(import_session_bundle(app, "wt-target".into(), bundle))
            .expect_err("version 2");
        assert!(error.contains("version 2"), "{error}");
    }

    #[test]
    fn import_rejects_unknown_and_archived_worktrees() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_with_worktrees(&temp);

        let error = block_on(import_session_bundle(
            app.clone(),
            "nope".into(),
            empty_bundle(),
        ))
        .expect_err("unknown");
        assert!(error.contains("not found"), "{error}");

        let error = block_on(import_session_bundle(
            app,
            "wt-archived".into(),
            empty_bundle(),
        ))
        .expect_err("archived");
        assert!(error.contains("archived"), "{error}");
    }

    #[test]
    fn import_rejects_file_names_that_escape_their_directory() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_with_worktrees(&temp);
        for (field, name) in [
            ("run", "../../evil.jsonl"),
            ("run", "r1.input.jsonl"),
            ("context", "../context-x.md"),
            ("attachment", "/etc/passwd"),
            ("attachment", ".."),
        ] {
            let mut bundle = empty_bundle();
            let file = BundleFile {
                name: name.to_string(),
                content: String::new(),
            };
            match field {
                "run" => bundle.run_logs.push(file),
                "context" => bundle.contexts.push(file),
                _ => bundle.attachments.push(BundleAttachment {
                    dir: AttachmentDir::PastedTexts,
                    file_name: name.to_string(),
                    base64: String::new(),
                }),
            }
            let error = block_on(import_session_bundle(
                app.clone(),
                "wt-target".into(),
                bundle,
            ))
            .expect_err(name);
            assert!(error.contains("Invalid"), "{name}: {error}");
        }
    }

    #[test]
    fn rewrite_paths_handles_json_escaped_windows_paths() {
        let from = BundleDirs {
            pasted_images: r"C:\Users\a\pasted-images".into(),
            pasted_texts: r"C:\Users\a\pasted-texts".into(),
        };
        let to = BundleDirs {
            pasted_images: "/home/b/pasted-images".into(),
            pasted_texts: "/home/b/pasted-texts".into(),
        };
        let line = serde_json::json!({ "p": r"C:\Users\a\pasted-images\x.png" }).to_string();

        let rewritten = rewrite_paths(&line, &from, &to, true);

        assert!(
            rewritten.contains(r"/home/b/pasted-images\\x.png"),
            "{rewritten}"
        );
        assert_eq!(
            rewrite_paths(r"C:\Users\a\pasted-texts\t.txt", &from, &to, false),
            r"/home/b/pasted-texts\t.txt"
        );
    }
}
