//! Move a session to another worktree, in the same or another project (#67).
//!
//! The session keeps its id, history, run logs, attachments and settings
//! (`storage::move_session`). The new worktree is another folder, so the
//! backend's context needs care:
//!
//! - Claude resumes a conversation by id from any folder, so its resume id is
//!   kept. The next turn only gets a hidden note that the paths changed.
//! - Every other backend binds its resume id to the old folder (OpenCode
//!   `?directory=`, Cursor `--workspace`, Antigravity's cwd cache) or nobody
//!   knows. The move clears those ids and the next turn replays the Splitkick
//!   history, like a fork (`HandoffKind::Moved` in `chat::commands`).
//!
//! When you add a resume id for a new backend, clear it here too (and in `fork.rs`).
//! See `docs/developer/session-forking.md`, "Moved sessions".

use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;

use super::storage;
use super::types::{PendingMove, SessionMetadata};
use crate::http_server::EmitExt;

/// What to do when the session is running a turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveWhenRunning {
    /// Refuse the move (UI: the user waits for the turn to finish).
    Refuse,
    /// Move once the turn ends (MCP: an agent often moves its own running session).
    AfterTurn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MoveStatus {
    Moved,
    Scheduled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveResult {
    pub session_id: String,
    pub source_worktree_id: String,
    pub target_worktree_id: String,
    pub target_project_id: String,
    pub status: MoveStatus,
}

/// Payload of `session:moved`, sent for every completed move (UI and MCP).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionMovedEvent<'a> {
    session_id: &'a str,
    source_worktree_id: &'a str,
    source_project_id: &'a str,
    target_worktree_id: &'a str,
    target_project_id: &'a str,
}

/// Clear what the old folder owns and mark the next turn as the first after a move.
pub(crate) fn prepare_moved_metadata(metadata: &mut SessionMetadata, from_path: &str) {
    // Claude finds its conversation by id from any folder: keep `claude_session_id`.
    metadata.codex_thread_id = None;
    metadata.codex_goal = None;
    metadata.opencode_session_id = None;
    metadata.cursor_chat_id = None;
    metadata.pi_session_id = None;
    metadata.commandcode_session_id = None;
    metadata.grok_session_id = None;
    metadata.kimi_session_id = None;
    metadata.antigravity_session_id = None;
    // A second move before any turn keeps the first path: that is the one the
    // earlier turns name.
    if metadata.pending_move.is_none() {
        metadata.pending_move = Some(PendingMove {
            from_path: from_path.to_string(),
        });
    }
}

/// The checks every move must pass, without I/O.
fn check_move(
    source_worktree_id: &str,
    target_worktree_id: &str,
    target_archived: bool,
    queued_messages: usize,
    running: bool,
    when_running: MoveWhenRunning,
) -> Result<MoveStatus, String> {
    if source_worktree_id == target_worktree_id {
        return Err("Session already belongs to the target worktree".to_string());
    }
    if target_archived {
        return Err("Target worktree is archived".to_string());
    }
    if queued_messages > 0 {
        return Err("Cannot move a session while it has queued messages".to_string());
    }
    match (running, when_running) {
        (false, _) => Ok(MoveStatus::Moved),
        (true, MoveWhenRunning::AfterTurn) => Ok(MoveStatus::Scheduled),
        (true, MoveWhenRunning::Refuse) => {
            Err("Session is running. Wait for the turn to finish, then move it.".to_string())
        }
    }
}

struct WorktreeInfo {
    path: String,
    project_id: String,
    archived: bool,
}

fn worktree_info(app: &AppHandle, worktree_id: &str) -> Result<WorktreeInfo, String> {
    let data = crate::projects::storage::load_projects_data(app)?;
    let worktree = data
        .find_worktree(worktree_id)
        .ok_or_else(|| format!("Unknown worktreeId: {worktree_id}"))?;
    Ok(WorktreeInfo {
        path: worktree.path.clone(),
        project_id: worktree.project_id.clone(),
        archived: worktree.archived_at.is_some(),
    })
}

fn load_session_metadata(app: &AppHandle, session_id: &str) -> Result<SessionMetadata, String> {
    storage::load_metadata(app, session_id)?
        .ok_or_else(|| format!("Unknown sessionId: {session_id}"))
}

/// Move `session_id` to `target_worktree_id`.
pub fn move_session_to_worktree(
    app: &AppHandle,
    session_id: &str,
    target_worktree_id: &str,
    when_running: MoveWhenRunning,
) -> Result<MoveResult, String> {
    let metadata = load_session_metadata(app, session_id)?;
    let source_worktree_id = metadata.worktree_id.clone();
    worktree_info(app, &source_worktree_id)?;
    let target = worktree_info(app, target_worktree_id)?;
    let status = check_move(
        &source_worktree_id,
        target_worktree_id,
        target.archived,
        metadata.queued_messages.len(),
        super::registry::is_session_actively_managed(session_id),
        when_running,
    )?;

    match status {
        MoveStatus::Moved => {
            perform_move(app, session_id, &source_worktree_id, target_worktree_id)?
        }
        MoveStatus::Scheduled => schedule_move(
            app,
            session_id.to_string(),
            source_worktree_id.clone(),
            target_worktree_id.to_string(),
        ),
    }

    Ok(MoveResult {
        session_id: session_id.to_string(),
        source_worktree_id,
        target_worktree_id: target_worktree_id.to_string(),
        target_project_id: target.project_id,
        status,
    })
}

fn perform_move(
    app: &AppHandle,
    session_id: &str,
    source_worktree_id: &str,
    target_worktree_id: &str,
) -> Result<(), String> {
    let source = worktree_info(app, source_worktree_id)?;
    let target = worktree_info(app, target_worktree_id)?;
    storage::move_session(
        app,
        source_worktree_id,
        target_worktree_id,
        session_id,
        |metadata| prepare_moved_metadata(metadata, &source.path),
    )?;

    super::emit_sessions_cache_invalidation(app);
    if let Err(e) = app.emit_all(
        "session:moved",
        &SessionMovedEvent {
            session_id,
            source_worktree_id,
            source_project_id: &source.project_id,
            target_worktree_id,
            target_project_id: &target.project_id,
        },
    ) {
        log::error!("Failed to emit session:moved: {e}");
    }
    log::info!(
        "Session moved: session={session_id} source={source_worktree_id} target={target_worktree_id}"
    );
    Ok(())
}

/// Move the session once its current turn ends. The checks run again then:
/// a message queued or a target archived in the meantime cancels the move.
fn schedule_move(
    app: &AppHandle,
    session_id: String,
    source_worktree_id: String,
    target_worktree_id: String,
) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while super::registry::is_session_actively_managed(&session_id) {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        let result = load_session_metadata(&app, &session_id).and_then(|metadata| {
            let target = worktree_info(&app, &target_worktree_id)?;
            check_move(
                &metadata.worktree_id,
                &target_worktree_id,
                target.archived,
                metadata.queued_messages.len(),
                false,
                MoveWhenRunning::Refuse,
            )?;
            perform_move(&app, &session_id, &source_worktree_id, &target_worktree_id)
        });

        if let Err(error) = result {
            log::warn!(
                "Deferred session move failed: session={session_id} source={source_worktree_id} target={target_worktree_id}: {error}"
            );
            if let Err(e) = app.emit_all(
                "session:move-failed",
                &serde_json::json!({ "sessionId": session_id, "error": error }),
            ) {
                log::error!("Failed to emit session:move-failed: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::types::{Backend, Session};
    use crate::projects::types::{ProjectsData, Worktree};
    use crate::runtime::RuntimeContext;

    /// The loader archives a worktree whose folder is missing, so each gets one.
    fn worktree(temp: &tempfile::TempDir, id: &str, project_id: &str) -> Worktree {
        let path = temp.path().join("worktrees").join(id);
        std::fs::create_dir_all(&path).unwrap();
        serde_json::from_value(serde_json::json!({
            "id": id,
            "project_id": project_id,
            "name": id,
            "path": path.to_string_lossy(),
            "branch": "main",
            "created_at": 0,
        }))
        .expect("worktree json")
    }

    /// A Claude session in project A that also ran Codex once.
    fn app_with_session(temp: &tempfile::TempDir) -> (AppHandle, String) {
        let app = RuntimeContext::new(temp.path().into(), temp.path().into()).unwrap();
        let data = ProjectsData {
            projects: vec![],
            worktrees: vec![
                worktree(temp, "wt-a", "project-a"),
                worktree(temp, "wt-b", "project-b"),
            ],
        };
        crate::projects::storage::save_projects_data(&app, &data).unwrap();

        let session = storage::with_sessions_mut(&app, "", "wt-a", |sessions| {
            let session = Session::new("Build auth".to_string(), 0, Backend::Claude);
            sessions.sessions.push(session.clone());
            Ok(session)
        })
        .unwrap();
        storage::with_metadata_mut(&app, &session.id, "wt-a", "Build auth", 0, |m| {
            m.backend = Backend::Claude;
            m.claude_session_id = Some("claude-1".to_string());
            m.codex_thread_id = Some("codex-1".to_string());
            Ok(())
        })
        .unwrap();
        (app, session.id)
    }

    #[test]
    fn a_session_moves_to_a_worktree_of_another_project() {
        let temp = tempfile::tempdir().unwrap();
        let (app, session_id) = app_with_session(&temp);

        let result =
            move_session_to_worktree(&app, &session_id, "wt-b", MoveWhenRunning::Refuse).unwrap();

        assert_eq!(result.status, MoveStatus::Moved);
        assert_eq!(result.source_worktree_id, "wt-a");
        assert_eq!(result.target_project_id, "project-b");
        let source = storage::load_sessions(&app, "", "wt-a").unwrap();
        let target = storage::load_sessions(&app, "", "wt-b").unwrap();
        assert!(source.sessions.iter().all(|s| s.id != session_id));
        assert!(target.sessions.iter().any(|s| s.id == session_id));
        assert_eq!(
            target.active_session_id.as_deref(),
            Some(session_id.as_str())
        );

        let metadata = load_session_metadata(&app, &session_id).unwrap();
        assert_eq!(metadata.worktree_id, "wt-b");
        assert_eq!(metadata.claude_session_id.as_deref(), Some("claude-1"));
        assert_eq!(metadata.codex_thread_id, None);
        let from_path = temp.path().join("worktrees").join("wt-a");
        assert_eq!(
            metadata.pending_move.map(|moved| moved.from_path),
            Some(from_path.to_string_lossy().to_string())
        );
    }

    #[test]
    fn a_session_with_queued_messages_stays() {
        let temp = tempfile::tempdir().unwrap();
        let (app, session_id) = app_with_session(&temp);
        storage::with_metadata_mut(&app, &session_id, "wt-a", "Build auth", 0, |m| {
            m.queued_messages
                .push(serde_json::json!({ "id": "q1", "message": "next" }));
            Ok(())
        })
        .unwrap();

        let error = move_session_to_worktree(&app, &session_id, "wt-b", MoveWhenRunning::Refuse)
            .unwrap_err();

        assert!(error.contains("queued messages"), "{error}");
        assert_eq!(
            load_session_metadata(&app, &session_id)
                .unwrap()
                .worktree_id,
            "wt-a"
        );
    }

    fn metadata_with_every_resume_id() -> SessionMetadata {
        let mut metadata = SessionMetadata::new(
            "session-1".to_string(),
            "source-worktree".to_string(),
            "Session 1".to_string(),
            0,
        );
        metadata.backend = Backend::Claude;
        metadata.claude_session_id = Some("claude-1".to_string());
        metadata.codex_thread_id = Some("codex-1".to_string());
        metadata.opencode_session_id = Some("opencode-1".to_string());
        metadata.cursor_chat_id = Some("cursor-1".to_string());
        metadata.pi_session_id = Some("pi-1".to_string());
        metadata.commandcode_session_id = Some("command-1".to_string());
        metadata.grok_session_id = Some("grok-1".to_string());
        metadata.kimi_session_id = Some("kimi-1".to_string());
        metadata.antigravity_session_id = Some("antigravity-1".to_string());
        metadata
    }

    #[test]
    fn a_move_keeps_the_claude_id_and_clears_every_folder_bound_id() {
        let mut metadata = metadata_with_every_resume_id();

        prepare_moved_metadata(&mut metadata, "/old/worktree");

        assert_eq!(metadata.claude_session_id.as_deref(), Some("claude-1"));
        assert_eq!(metadata.codex_thread_id, None);
        assert_eq!(metadata.opencode_session_id, None);
        assert_eq!(metadata.cursor_chat_id, None);
        assert_eq!(metadata.pi_session_id, None);
        assert_eq!(metadata.commandcode_session_id, None);
        assert_eq!(metadata.grok_session_id, None);
        assert_eq!(metadata.kimi_session_id, None);
        assert_eq!(metadata.antigravity_session_id, None);
        assert_eq!(
            metadata.pending_move,
            Some(PendingMove {
                from_path: "/old/worktree".to_string()
            })
        );
    }

    #[test]
    fn a_second_move_before_any_turn_keeps_the_first_path() {
        let mut metadata = metadata_with_every_resume_id();

        prepare_moved_metadata(&mut metadata, "/first/worktree");
        prepare_moved_metadata(&mut metadata, "/second/worktree");

        assert_eq!(
            metadata
                .pending_move
                .map(|moved| moved.from_path)
                .as_deref(),
            Some("/first/worktree")
        );
    }

    #[test]
    fn an_idle_session_moves_now() {
        assert_eq!(
            check_move("a", "b", false, 0, false, MoveWhenRunning::Refuse),
            Ok(MoveStatus::Moved)
        );
        assert_eq!(
            check_move("a", "b", false, 0, false, MoveWhenRunning::AfterTurn),
            Ok(MoveStatus::Moved)
        );
    }

    #[test]
    fn a_running_session_is_refused_or_scheduled() {
        assert!(
            check_move("a", "b", false, 0, true, MoveWhenRunning::Refuse)
                .unwrap_err()
                .contains("running")
        );
        assert_eq!(
            check_move("a", "b", false, 0, true, MoveWhenRunning::AfterTurn),
            Ok(MoveStatus::Scheduled)
        );
    }

    #[test]
    fn invalid_moves_are_refused() {
        assert!(
            check_move("a", "a", false, 0, false, MoveWhenRunning::AfterTurn)
                .unwrap_err()
                .contains("already belongs")
        );
        assert!(
            check_move("a", "b", true, 0, false, MoveWhenRunning::AfterTurn)
                .unwrap_err()
                .contains("archived")
        );
        assert!(
            check_move("a", "b", false, 2, false, MoveWhenRunning::AfterTurn)
                .unwrap_err()
                .contains("queued messages")
        );
    }
}
