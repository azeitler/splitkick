//! Forking a Jean session.
//!
//! Three user-facing shapes share this module:
//!
//! * **new worktree** — `projects::fork_session_to_worktree` creates a git worktree
//!   at the source HEAD, copies the dirty working tree, then copies the session.
//! * **same worktree** — [`fork_session_in_place`] adds a sibling session tab next to
//!   the source, on the same working directory.
//! * **from a message** — [`fork_session_in_place`] with `from_message_id`, which
//!   truncates the copied history at that point.
//!
//! The Jean side of every fork is the same: a new session id, a copy of
//! `metadata.json` with a (possibly truncated) run list, and a copy of the matching
//! `{run_id}.jsonl` run logs. What differs is how the fork's *first send* regains the
//! backend's context — see [`PendingFork`] and [`fork_strategy`].

use std::collections::HashSet;
use std::fs;

use tauri::AppHandle;
use uuid::Uuid;

use super::storage;
use super::types::{Backend, PendingFork, RunEntry, RunStatus, Session, SessionMetadata};
use crate::http_server::EmitExt;

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ============================================================================
// Strategy
// ============================================================================

/// Decide how a fork regains the backend's context on its first send.
///
/// Claude CLI can branch its own transcript (`--resume <id> --fork-session`), which
/// beats replaying tens of thousands of characters of history into the prompt. Every
/// other backend falls back to the hidden handoff block.
///
/// A **truncated** fork can never go native: the backend would branch from the end of
/// its transcript, handing the model turns the fork deliberately dropped.
pub(crate) fn fork_strategy(backend: &Backend, truncated: bool) -> PendingFork {
    if truncated {
        return PendingFork::Handoff;
    }
    match backend {
        Backend::Claude => PendingFork::Native,
        _ => PendingFork::Handoff,
    }
}

/// Whether the fork keeps `backend`'s resume id under `strategy`.
fn keeps_resume_id(strategy: PendingFork, session_backend: &Backend, backend: &Backend) -> bool {
    strategy == PendingFork::Native && session_backend == backend
}

// ============================================================================
// Session / metadata preparation
// ============================================================================

pub(crate) fn forked_session_name(source_name: &str) -> String {
    let trimmed = source_name.trim();
    if trimmed.is_empty() {
        "Forked Session".to_string()
    } else if trimmed.starts_with("Fork of ") {
        trimmed.to_string()
    } else {
        format!("Fork of {trimmed}")
    }
}

/// Clear everything that must not survive a fork: every backend resume id (except the
/// one the native strategy deliberately reuses), every pending approval queue, and all
/// in-flight run bookkeeping.
pub(crate) fn clear_session_runtime_state(session: &mut Session, strategy: PendingFork) {
    let backend = session.backend.clone();
    if !keeps_resume_id(strategy, &backend, &Backend::Claude) {
        session.claude_session_id = None;
    }
    session.codex_thread_id = None;
    session.codex_goal = None;
    session.opencode_session_id = None;
    session.cursor_chat_id = None;
    session.pi_session_id = None;
    session.commandcode_session_id = None;
    session.grok_session_id = None;
    session.kimi_session_id = None;
    session.antigravity_session_id = None;
    session.is_reviewing = false;
    if session.status_override.as_deref() == Some("review") {
        session.status_override = None;
    }
    session.waiting_for_input = false;
    session.waiting_for_input_type = None;
    session.pending_permission_denials.clear();
    session.pending_codex_permission_requests.clear();
    session.pending_opencode_permission_requests.clear();
    session.pending_codex_command_approval_requests.clear();
    session.pending_codex_user_input_requests.clear();
    session.pending_codex_mcp_elicitation_requests.clear();
    session.pending_codex_dynamic_tool_call_requests.clear();
    session.denied_message_context = None;
    session.queued_messages.clear();
    session.scheduled_wakeup = None;
    session.last_run_status = None;
    session.last_run_execution_mode = None;
    session.last_run_started_at = None;
}

pub(crate) fn prepare_forked_session(
    source: &Session,
    order: u32,
    created_at: u64,
    strategy: PendingFork,
) -> Session {
    let mut forked = source.clone();
    forked.id = Uuid::new_v4().to_string();
    forked.name = forked_session_name(&source.name);
    forked.order = order;
    forked.created_at = created_at;
    forked.updated_at = created_at;
    forked.last_opened_at = Some(created_at);
    forked.archived_at = None;
    forked.archived_by_base_close = None;
    forked.session_naming_completed = false;
    clear_session_runtime_state(&mut forked, strategy);
    forked
}

/// Strip state that only made sense in the source session from a copied run.
///
/// `checkpoint_id` points into the *source* worktree's checkpoint store, so restoring
/// it from the fork would revert against a snapshot the fork never took. `pid` and
/// `codex_turn_id` describe processes and turns that belong to the source. A run left
/// `Running` or `Resumable` would make `run_log::start_run` refuse the fork's very
/// first send, since it rejects a second concurrent `Running` run.
pub(crate) fn sanitize_forked_run(run: &mut RunEntry, now_ts: u64) {
    run.checkpoint_id = None;
    run.pid = None;
    run.codex_turn_id = None;
    if matches!(run.status, RunStatus::Running | RunStatus::Resumable) {
        run.status = RunStatus::Crashed;
        if run.ended_at.is_none() {
            run.ended_at = Some(now_ts);
        }
    }
}

/// Keep the runs a fork should inherit, given the message the user forked from.
///
/// * `None` — keep every run (a plain fork of the whole session).
/// * an **assistant** message id — keep that run, so the fork ends with that answer.
/// * a **user** message id — drop that run and everything after it, so the fork ends
///   just before that prompt and the user can ask something different there.
pub(crate) fn truncate_runs_at_message(
    runs: &[RunEntry],
    message_id: Option<&str>,
) -> Result<Vec<RunEntry>, String> {
    let Some(message_id) = message_id else {
        return Ok(runs.to_vec());
    };

    for (index, run) in runs.iter().enumerate() {
        if run.assistant_message_id.as_deref() == Some(message_id) {
            return Ok(runs[..=index].to_vec());
        }
        if run.user_message_id == message_id {
            return Ok(runs[..index].to_vec());
        }
    }

    Err(format!(
        "Cannot fork: message {message_id} is not part of this session's history"
    ))
}

/// Number of visible chat messages the kept runs render to.
///
/// `WorktreeIndex` stores this per session and `with_sessions_mut` takes it from
/// `Session::message_count`, which a fork inherits from its source. Without recomputing
/// it, a fork truncated at a message would advertise the source's full count.
pub(crate) fn rendered_message_count(runs: &[RunEntry]) -> u32 {
    runs.iter().map(RunEntry::rendered_message_count).sum()
}

pub(crate) fn prepare_forked_metadata(
    source: Option<SessionMetadata>,
    forked_session: &Session,
    source_session_id: &str,
    new_worktree_id: &str,
    kept_runs: Vec<RunEntry>,
    strategy: PendingFork,
) -> SessionMetadata {
    let mut metadata = source.unwrap_or_else(|| {
        SessionMetadata::new(
            forked_session.id.clone(),
            new_worktree_id.to_string(),
            forked_session.name.clone(),
            forked_session.order,
        )
    });
    metadata.id = forked_session.id.clone();
    metadata.worktree_id = new_worktree_id.to_string();
    metadata.name = forked_session.name.clone();
    metadata.order = forked_session.order;
    metadata.created_at = forked_session.created_at;
    metadata.runs = kept_runs;

    if !keeps_resume_id(strategy, &metadata.backend, &Backend::Claude) {
        metadata.claude_session_id = None;
    }
    metadata.codex_thread_id = None;
    metadata.codex_goal = None;
    metadata.opencode_session_id = None;
    metadata.cursor_chat_id = None;
    metadata.pi_session_id = None;
    metadata.commandcode_session_id = None;
    metadata.grok_session_id = None;
    metadata.kimi_session_id = None;
    metadata.antigravity_session_id = None;

    metadata.session_naming_completed = false;
    metadata.archived_at = None;
    metadata.archived_by_base_close = None;
    metadata.pending_permission_denials.clear();
    metadata.pending_codex_permission_requests.clear();
    metadata.pending_opencode_permission_requests.clear();
    metadata.pending_codex_command_approval_requests.clear();
    metadata.pending_codex_user_input_requests.clear();
    metadata.pending_codex_mcp_elicitation_requests.clear();
    metadata.pending_codex_dynamic_tool_call_requests.clear();
    metadata.denied_message_context = None;
    metadata.is_reviewing = false;
    if metadata.status_override.as_deref() == Some("review") {
        metadata.status_override = None;
    }
    metadata.waiting_for_input = false;
    metadata.waiting_for_input_type = None;
    metadata.queued_messages.clear();
    metadata.scheduled_wakeup = None;

    metadata.forked_from_session_id = Some(source_session_id.to_string());
    metadata.pending_fork = Some(strategy);
    metadata
}

// ============================================================================
// File copying
// ============================================================================

/// Copy the run logs the fork inherits.
///
/// Only `{run_id}.jsonl` for a kept run is copied. `{run_id}.input.jsonl` is a consumed
/// stdin payload that the source deletes after its run, so the fork has no use for it.
pub(crate) fn copy_session_run_files(
    app: &AppHandle,
    source_session_id: &str,
    target_session_id: &str,
    kept_run_ids: &[String],
) -> Result<(), String> {
    let source_dir = storage::get_session_dir(app, source_session_id)?;
    if !source_dir.exists() {
        return Ok(());
    }
    let kept: HashSet<&str> = kept_run_ids.iter().map(String::as_str).collect();
    let target_dir = storage::get_session_dir(app, target_session_id)?;
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create forked session log directory: {e}"))?;

    for entry in fs::read_dir(&source_dir)
        .map_err(|e| format!("Failed to read source session log directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read source session log entry: {e}"))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to read session log entry type: {e}"))?;
        if !file_type.is_file() {
            continue;
        }
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        let Some(run_id) = name.strip_suffix(".jsonl") else {
            continue;
        };
        // Skip `{run_id}.input.jsonl` — a consumed stdin payload.
        if run_id.ends_with(".input") || !kept.contains(run_id) {
            continue;
        }
        fs::copy(entry.path(), target_dir.join(&file_name))
            .map_err(|e| format!("Failed to copy session log file: {e}"))?;
    }
    Ok(())
}

/// Copy the data that hangs off a session id rather than living in its directory:
/// attached saved contexts and GitHub/Linear/Sentry/advisory references.
///
/// Best effort. The fork itself has already succeeded by the time this runs, so a
/// failure here is logged rather than propagated.
pub(crate) fn copy_session_side_data(
    app: &AppHandle,
    source_session_id: &str,
    target_session_id: &str,
) {
    if let Err(e) = copy_attached_contexts(app, source_session_id, target_session_id) {
        log::warn!("Fork: failed to copy attached contexts for {source_session_id}: {e}");
    }
    if let Err(e) = copy_context_references(app, source_session_id, target_session_id) {
        log::warn!("Fork: failed to copy context references for {source_session_id}: {e}");
    }
}

fn copy_attached_contexts(
    app: &AppHandle,
    source_session_id: &str,
    target_session_id: &str,
) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?
        .join("session-context");
    if !dir.exists() {
        return Ok(());
    }

    let prefix = format!("{source_session_id}-context-");
    for entry in
        fs::read_dir(&dir).map_err(|e| format!("Failed to read session-context directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read session-context entry: {e}"))?;
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        let Some(suffix) = name.strip_prefix(prefix.as_str()) else {
            continue;
        };
        let target = dir.join(format!("{target_session_id}-context-{suffix}"));
        if target.exists() {
            continue;
        }
        fs::copy(entry.path(), &target)
            .map_err(|e| format!("Failed to copy attached context {name}: {e}"))?;
    }
    Ok(())
}

fn copy_context_references(
    app: &AppHandle,
    source_session_id: &str,
    target_session_id: &str,
) -> Result<(), String> {
    use crate::projects::github_issues::{load_context_references, save_context_references};

    let mut refs = load_context_references(app)?;
    let mut changed = false;

    for map in [
        &mut refs.issues,
        &mut refs.prs,
        &mut refs.security,
        &mut refs.advisories,
        &mut refs.linear,
        &mut refs.sentry,
    ] {
        for entry in map.values_mut() {
            if entry.sessions.iter().any(|s| s == source_session_id)
                && !entry.sessions.iter().any(|s| s == target_session_id)
            {
                entry.sessions.push(target_session_id.to_string());
                entry.orphaned_at = None;
                changed = true;
            }
        }
    }

    if changed {
        save_context_references(app, &refs)?;
    }
    Ok(())
}

// ============================================================================
// Command
// ============================================================================

/// Fork a session into a sibling session in the **same** worktree.
///
/// `from_message_id` truncates the copied history — see [`truncate_runs_at_message`].
/// The source session is never modified.
pub async fn fork_session_in_place(
    app: AppHandle,
    worktree_id: String,
    session_id: String,
    from_message_id: Option<String>,
) -> Result<Session, String> {
    log::trace!("Forking session {session_id} in place (worktree {worktree_id})");

    if super::registry::is_session_actively_managed(&session_id) {
        return Err("Cannot fork a session while it is running. Wait for the turn to finish, or cancel it first.".to_string());
    }

    let sessions = storage::load_sessions_by_id(&app, &worktree_id)?;
    let source_session = sessions
        .find_session(&session_id)
        .cloned()
        .ok_or_else(|| format!("Session not found: {session_id}"))?;

    let source_metadata = storage::load_metadata(&app, &session_id)?;
    let source_runs = source_metadata
        .as_ref()
        .map(|m| m.runs.clone())
        .unwrap_or_default();

    let created_at = now();
    let mut kept_runs = truncate_runs_at_message(&source_runs, from_message_id.as_deref())?;
    for run in &mut kept_runs {
        sanitize_forked_run(run, created_at);
    }
    let kept_run_ids: Vec<String> = kept_runs.iter().map(|r| r.run_id.clone()).collect();

    let strategy = fork_strategy(&source_session.backend, from_message_id.is_some());
    let order = sessions.sessions.len() as u32;
    let mut forked_session = prepare_forked_session(&source_session, order, created_at, strategy);
    forked_session.message_count = Some(rendered_message_count(&kept_runs));
    let forked_id = forked_session.id.clone();

    copy_session_run_files(&app, &session_id, &forked_id, &kept_run_ids)?;
    let forked_metadata = prepare_forked_metadata(
        source_metadata,
        &forked_session,
        &session_id,
        &worktree_id,
        kept_runs,
        strategy,
    );

    // Write the metadata first. `with_sessions_mut` rewrites every session's metadata
    // through `update_from_session`, which mutates in place — so it preserves the runs
    // and the fork markers written here. Doing it the other way round would briefly
    // leave a run-less metadata file on disk.
    storage::save_metadata(&app, &forked_metadata)?;
    let saved_session = storage::with_sessions_mut(&app, "", &worktree_id, |sessions| {
        let mut forked = forked_session.clone();
        forked.order = sessions.sessions.len() as u32;
        sessions.sessions.push(forked.clone());
        sessions.active_session_id = Some(forked.id.clone());
        Ok(forked)
    })?;

    copy_session_side_data(&app, &session_id, &forked_id);

    let _ = app.emit_all(
        "cache:invalidate",
        &serde_json::json!({ "keys": ["sessions", "session"] }),
    );

    log::info!(
        "Forked session {session_id} -> {forked_id} in worktree {worktree_id} (runs={}, strategy={strategy:?})",
        kept_run_ids.len()
    );
    Ok(saved_session)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(run_id: &str, user_message_id: &str, assistant_message_id: Option<&str>) -> RunEntry {
        RunEntry {
            run_id: run_id.to_string(),
            user_message_id: user_message_id.to_string(),
            user_message: format!("prompt for {run_id}"),
            model: None,
            execution_mode: None,
            thinking_level: None,
            effort_level: None,
            backend: None,
            custom_profile_name: None,
            started_at: 0,
            ended_at: Some(1),
            status: RunStatus::Completed,
            assistant_message_id: assistant_message_id.map(str::to_string),
            cancelled: false,
            recovered: false,
            claude_session_id: None,
            pid: None,
            usage: None,
            codex_thread_id: None,
            codex_turn_id: None,
            cursor_chat_id: None,
            grok_session_id: None,
            kimi_session_id: None,
            antigravity_session_id: None,
            checkpoint_id: None,
        }
    }

    fn three_runs() -> Vec<RunEntry> {
        vec![
            run("r1", "u1", Some("a1")),
            run("r2", "u2", Some("a2")),
            run("r3", "u3", Some("a3")),
        ]
    }

    // ---- fork_strategy --------------------------------------------------

    #[test]
    fn fork_strategy_is_native_only_for_a_full_claude_fork() {
        assert_eq!(
            fork_strategy(&Backend::Claude, false),
            PendingFork::Native,
            "a full Claude fork can use --fork-session"
        );
        assert_eq!(
            fork_strategy(&Backend::Claude, true),
            PendingFork::Handoff,
            "a truncated fork must not branch from the end of the transcript"
        );
        for backend in [
            Backend::Codex,
            Backend::Opencode,
            Backend::Cursor,
            Backend::Pi,
            Backend::Commandcode,
            Backend::Grok,
            Backend::Kimi,
            Backend::Antigravity,
        ] {
            assert_eq!(fork_strategy(&backend, false), PendingFork::Handoff);
            assert_eq!(fork_strategy(&backend, true), PendingFork::Handoff);
        }
    }

    // ---- clear_session_runtime_state / prepare_forked_session -----------

    fn session_with_every_resume_id(backend: Backend) -> Session {
        let mut source = Session::new("Build auth".to_string(), 3, backend);
        source.claude_session_id = Some("claude-1".to_string());
        source.codex_thread_id = Some("codex-1".to_string());
        source.codex_goal = Some("ship the feature".to_string());
        source.opencode_session_id = Some("opencode-1".to_string());
        source.cursor_chat_id = Some("cursor-1".to_string());
        source.pi_session_id = Some("pi-1".to_string());
        source.commandcode_session_id = Some("command-1".to_string());
        source.grok_session_id = Some("grok-1".to_string());
        source.kimi_session_id = Some("kimi-1".to_string());
        source.antigravity_session_id = Some("antigravity-1".to_string());
        source.waiting_for_input = true;
        source.is_reviewing = true;
        source
    }

    #[test]
    fn prepare_forked_session_clears_backend_resume_ids_and_runtime_state() {
        let source = session_with_every_resume_id(Backend::Codex);

        let forked = prepare_forked_session(&source, 0, 1234, PendingFork::Handoff);

        assert_ne!(forked.id, source.id);
        assert_eq!(forked.name, "Fork of Build auth");
        assert_eq!(forked.order, 0);
        assert_eq!(forked.created_at, 1234);
        assert_eq!(forked.updated_at, 1234);
        assert_eq!(forked.backend, Backend::Codex);
        assert_eq!(forked.claude_session_id, None);
        assert_eq!(forked.codex_thread_id, None);
        assert_eq!(forked.codex_goal, None);
        assert_eq!(forked.opencode_session_id, None);
        assert_eq!(forked.cursor_chat_id, None);
        assert_eq!(forked.pi_session_id, None);
        assert_eq!(forked.commandcode_session_id, None);
        assert_eq!(forked.grok_session_id, None);
        assert_eq!(forked.kimi_session_id, None);
        assert_eq!(
            forked.antigravity_session_id, None,
            "an Antigravity fork must not resume the source conversation"
        );
        assert!(!forked.waiting_for_input);
        assert!(!forked.is_reviewing);
        assert!(forked.pending_codex_permission_requests.is_empty());
        assert!(forked.queued_messages.is_empty());
    }

    #[test]
    fn native_fork_keeps_only_the_claude_resume_id() {
        let source = session_with_every_resume_id(Backend::Claude);

        let forked = prepare_forked_session(&source, 0, 1234, PendingFork::Native);

        assert_eq!(
            forked.claude_session_id.as_deref(),
            Some("claude-1"),
            "the native strategy resumes the source transcript with --fork-session"
        );
        assert_eq!(forked.codex_thread_id, None);
        assert_eq!(forked.antigravity_session_id, None);
        assert_eq!(forked.pi_session_id, None);
    }

    #[test]
    fn native_fork_on_a_non_claude_session_still_clears_claude() {
        let source = session_with_every_resume_id(Backend::Codex);

        let forked = prepare_forked_session(&source, 0, 1234, PendingFork::Native);

        assert_eq!(forked.claude_session_id, None);
    }

    #[test]
    fn forked_session_name_does_not_stack_prefixes() {
        assert_eq!(forked_session_name("Build auth"), "Fork of Build auth");
        assert_eq!(
            forked_session_name("Fork of Build auth"),
            "Fork of Build auth"
        );
        assert_eq!(forked_session_name("   "), "Forked Session");
    }

    // ---- truncate_runs_at_message --------------------------------------

    #[test]
    fn truncate_without_a_message_keeps_every_run() {
        let runs = three_runs();
        let kept = truncate_runs_at_message(&runs, None).expect("kept");
        assert_eq!(kept.len(), 3);
    }

    #[test]
    fn truncate_at_an_assistant_message_keeps_that_answer() {
        let runs = three_runs();
        let kept = truncate_runs_at_message(&runs, Some("a2")).expect("kept");
        assert_eq!(
            kept.iter().map(|r| r.run_id.as_str()).collect::<Vec<_>>(),
            vec!["r1", "r2"]
        );
    }

    #[test]
    fn truncate_at_a_user_message_drops_that_prompt_and_everything_after() {
        let runs = three_runs();
        let kept = truncate_runs_at_message(&runs, Some("u2")).expect("kept");
        assert_eq!(
            kept.iter().map(|r| r.run_id.as_str()).collect::<Vec<_>>(),
            vec!["r1"]
        );
    }

    #[test]
    fn truncate_at_the_first_user_message_keeps_nothing() {
        let runs = three_runs();
        let kept = truncate_runs_at_message(&runs, Some("u1")).expect("kept");
        assert!(kept.is_empty());
    }

    #[test]
    fn truncate_at_an_unknown_message_is_an_error() {
        let runs = three_runs();
        let error = truncate_runs_at_message(&runs, Some("nope")).expect_err("unknown id");
        assert!(error.contains("nope"), "{error}");
    }

    // ---- sanitize_forked_run -------------------------------------------

    #[test]
    fn sanitize_clears_source_only_run_state() {
        let mut entry = run("r1", "u1", Some("a1"));
        entry.checkpoint_id = Some("checkpoint-1".to_string());
        entry.pid = Some(4242);
        entry.codex_turn_id = Some("turn-1".to_string());

        sanitize_forked_run(&mut entry, 99);

        assert_eq!(entry.checkpoint_id, None);
        assert_eq!(entry.pid, None);
        assert_eq!(entry.codex_turn_id, None);
        assert_eq!(entry.status, RunStatus::Completed, "status is untouched");
    }

    #[test]
    fn sanitize_settles_an_in_flight_run_so_the_fork_can_send() {
        for status in [RunStatus::Running, RunStatus::Resumable] {
            let mut entry = run("r1", "u1", None);
            entry.status = status;
            entry.ended_at = None;

            sanitize_forked_run(&mut entry, 99);

            assert_eq!(entry.status, RunStatus::Crashed);
            assert_eq!(entry.ended_at, Some(99));
        }
    }

    // ---- prepare_forked_metadata ---------------------------------------

    fn metadata_with_every_resume_id(backend: Backend) -> SessionMetadata {
        let mut metadata = SessionMetadata::new(
            "source-session".to_string(),
            "source-worktree".to_string(),
            "Build auth".to_string(),
            3,
        );
        metadata.backend = backend;
        metadata.claude_session_id = Some("claude-1".to_string());
        metadata.codex_thread_id = Some("codex-1".to_string());
        metadata.opencode_session_id = Some("opencode-1".to_string());
        metadata.cursor_chat_id = Some("cursor-1".to_string());
        metadata.pi_session_id = Some("pi-1".to_string());
        metadata.commandcode_session_id = Some("command-1".to_string());
        metadata.grok_session_id = Some("grok-1".to_string());
        metadata.kimi_session_id = Some("kimi-1".to_string());
        metadata.antigravity_session_id = Some("antigravity-1".to_string());
        metadata.runs = three_runs();
        metadata
    }

    #[test]
    fn rendered_message_count_follows_the_truncation() {
        let runs = three_runs();
        assert_eq!(
            rendered_message_count(&runs),
            6,
            "three user+assistant pairs"
        );

        let kept = truncate_runs_at_message(&runs, Some("a1")).expect("kept");
        assert_eq!(rendered_message_count(&kept), 2);

        let kept = truncate_runs_at_message(&runs, Some("u1")).expect("kept");
        assert_eq!(rendered_message_count(&kept), 0);
    }

    #[test]
    fn prepare_forked_metadata_records_provenance_and_the_strategy() {
        let source = metadata_with_every_resume_id(Backend::Codex);
        let forked_session =
            prepare_forked_session(&source.to_session(), 1, 1234, PendingFork::Handoff);

        let metadata = prepare_forked_metadata(
            Some(source),
            &forked_session,
            "source-session",
            "target-worktree",
            three_runs(),
            PendingFork::Handoff,
        );

        assert_eq!(metadata.id, forked_session.id);
        assert_eq!(metadata.worktree_id, "target-worktree");
        assert_eq!(
            metadata.forked_from_session_id.as_deref(),
            Some("source-session")
        );
        assert_eq!(metadata.pending_fork, Some(PendingFork::Handoff));
        assert_eq!(metadata.runs.len(), 3);
        assert_eq!(metadata.claude_session_id, None);
        assert_eq!(metadata.codex_thread_id, None);
        assert_eq!(
            metadata.antigravity_session_id, None,
            "an Antigravity fork must not resume the source conversation"
        );
        assert!(!metadata.session_naming_completed);
    }

    #[test]
    fn prepare_forked_metadata_keeps_claude_resume_id_for_a_native_fork() {
        let source = metadata_with_every_resume_id(Backend::Claude);
        let forked_session =
            prepare_forked_session(&source.to_session(), 1, 1234, PendingFork::Native);

        let metadata = prepare_forked_metadata(
            Some(source),
            &forked_session,
            "source-session",
            "target-worktree",
            three_runs(),
            PendingFork::Native,
        );

        assert_eq!(metadata.claude_session_id.as_deref(), Some("claude-1"));
        assert_eq!(metadata.pending_fork, Some(PendingFork::Native));
        assert_eq!(metadata.antigravity_session_id, None);
    }

    #[test]
    fn prepare_forked_metadata_stores_the_truncated_run_list() {
        let source = metadata_with_every_resume_id(Backend::Claude);
        let forked_session =
            prepare_forked_session(&source.to_session(), 1, 1234, PendingFork::Handoff);
        let kept = truncate_runs_at_message(&three_runs(), Some("a1")).expect("kept");

        let metadata = prepare_forked_metadata(
            Some(source),
            &forked_session,
            "source-session",
            "target-worktree",
            kept,
            PendingFork::Handoff,
        );

        assert_eq!(
            metadata
                .runs
                .iter()
                .map(|r| r.run_id.as_str())
                .collect::<Vec<_>>(),
            vec!["r1"]
        );
    }
}
