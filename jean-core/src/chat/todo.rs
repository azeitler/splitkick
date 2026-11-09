//! To-Do mark per session (#125): "I still have to do something here".
//!
//! The mark lives on the session metadata (`todo_at`), so web access, remote
//! instances and agents see it. It changes only through `set_session_todo`,
//! under the session's metadata lock. Marking the session Completed does not
//! clear it, archiving keeps it, a move keeps it, and a fork does not copy it.

use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use super::commands::emit_worktree_sessions_cache_invalidation;
use super::storage::with_existing_metadata_mut;

/// The new mark. Marking a marked session keeps its first time, so the list
/// order does not jump when two clients mark it at the same time.
pub fn apply_todo(current: Option<u64>, todo: bool, now_secs: u64) -> Option<u64> {
    if todo {
        Some(current.unwrap_or(now_secs))
    } else {
        None
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Set or clear a session's To-Do mark. Returns the new `todo_at`.
pub async fn set_session_todo(
    app: AppHandle,
    worktree_id: String,
    session_id: String,
    todo: bool,
) -> Result<Option<u64>, String> {
    let todo_at = with_existing_metadata_mut(&app, &session_id, |metadata| {
        metadata.todo_at = apply_todo(metadata.todo_at, todo, now_secs());
        metadata.todo_at
    })?;
    emit_worktree_sessions_cache_invalidation(&app, &worktree_id);
    Ok(todo_at)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::types::SessionMetadata;

    #[test]
    fn marking_sets_the_time() {
        assert_eq!(apply_todo(None, true, 100), Some(100));
    }

    #[test]
    fn marking_again_keeps_the_first_time() {
        assert_eq!(apply_todo(Some(50), true, 100), Some(50));
    }

    #[test]
    fn clearing_removes_the_mark() {
        assert_eq!(apply_todo(Some(50), false, 100), None);
        assert_eq!(apply_todo(None, false, 100), None);
    }

    #[test]
    fn the_mark_round_trips_through_the_metadata_file() {
        let mut metadata = SessionMetadata::new("s-1".into(), "w-1".into(), "S".into(), 0);
        metadata.todo_at = Some(1_700_000_000);
        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("\"todo_at\":1700000000"));
        let back: SessionMetadata = serde_json::from_str(&json).unwrap();
        assert_eq!(back.todo_at, Some(1_700_000_000));
        assert_eq!(back.to_session().todo_at, Some(1_700_000_000));
    }

    #[test]
    fn an_unmarked_session_writes_no_key_and_reads_old_files() {
        let metadata = SessionMetadata::new("s-1".into(), "w-1".into(), "S".into(), 0);
        let json = serde_json::to_string(&metadata).unwrap();
        assert!(!json.contains("todo_at"));
        let back: SessionMetadata = serde_json::from_str(&json).unwrap();
        assert_eq!(back.todo_at, None);
    }

    #[test]
    fn a_stale_session_from_a_client_does_not_change_the_mark() {
        let mut metadata = SessionMetadata::new("s-1".into(), "w-1".into(), "S".into(), 0);
        let stale = metadata.to_session();
        metadata.todo_at = Some(42);
        metadata.update_from_session(&stale);
        assert_eq!(metadata.todo_at, Some(42));
    }
}
