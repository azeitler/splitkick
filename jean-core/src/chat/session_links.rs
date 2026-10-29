//! Parent/child links between sessions (#62).
//!
//! When an agent starts another session through the Splitkick MCP, the child
//! records the calling session in `SessionMetadata.started_by_session_id`.
//! Only the child stores the link: the parent's side is the MCP tool call in its
//! own transcript, whose result holds the child id. The chat reads names and
//! archive state live through `get_session_link`, so renames and archiving show.

use serde::Serialize;
use tauri::AppHandle;

use super::storage;
use super::types::SessionMetadata;

/// MCP `source` value for calls that do not come from a Splitkick session.
const ANON_SOURCE: &str = "anon";

/// Whether `parent_id` should be recorded as the parent of `child`.
/// First wins; `only_if_unstarted` also skips a child that already ran.
fn should_record(child: &SessionMetadata, parent_id: &str, only_if_unstarted: bool) -> bool {
    parent_id != ANON_SOURCE
        && !parent_id.is_empty()
        && parent_id != child.id
        && child.started_by_session_id.is_none()
        && (!only_if_unstarted || child.runs.is_empty())
}

/// Record that `parent_id` started `child_id`. Never fails the caller: the
/// link is a convenience, so errors are only logged.
pub fn record_started_by(
    app: &AppHandle,
    child_id: &str,
    parent_id: &str,
    only_if_unstarted: bool,
) {
    if parent_id == ANON_SOURCE || parent_id == child_id {
        return;
    }
    match storage::load_metadata(app, parent_id) {
        Ok(Some(_)) => {}
        _ => return,
    }
    let result = storage::with_existing_metadata_mut(app, child_id, |child| {
        if should_record(child, parent_id, only_if_unstarted) {
            child.started_by_session_id = Some(parent_id.to_string());
        }
    });
    if let Err(e) = result {
        log::warn!("record_started_by(child={child_id}, parent={parent_id}) failed: {e}");
    }
}

/// What the chat needs to show and open a linked session.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionLink {
    pub session_id: String,
    pub name: String,
    pub worktree_id: String,
    pub project_id: String,
    /// The session or its worktree is archived.
    pub archived: bool,
    pub started_by_session_id: Option<String>,
}

/// Resolve a session id to its current name and location. `None` when the
/// session or its worktree no longer exists (or the id is from another instance).
pub async fn get_session_link(
    app: AppHandle,
    session_id: String,
) -> Result<Option<SessionLink>, String> {
    let Some(metadata) = storage::load_metadata(&app, &session_id)? else {
        return Ok(None);
    };
    let data = crate::projects::storage::load_projects_data(&app)?;
    let Some(worktree) = data.find_worktree(&metadata.worktree_id) else {
        return Ok(None);
    };
    Ok(Some(SessionLink {
        session_id: metadata.id,
        name: metadata.name,
        worktree_id: worktree.id.clone(),
        project_id: worktree.project_id.clone(),
        archived: metadata.archived_at.is_some() || worktree.archived_at.is_some(),
        started_by_session_id: metadata.started_by_session_id,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::types::{RunEntry, RunStatus};

    fn child() -> SessionMetadata {
        SessionMetadata::new("child".into(), "wt".into(), "Child".into(), 0)
    }

    fn run() -> RunEntry {
        serde_json::from_value(serde_json::json!({
            "run_id": "r1",
            "user_message_id": "u1",
            "user_message": "hi",
            "started_at": 1,
            "status": "completed",
        }))
        .unwrap()
    }

    #[test]
    fn records_a_parent_on_a_fresh_child() {
        assert!(should_record(&child(), "parent", false));
        assert!(should_record(&child(), "parent", true));
    }

    #[test]
    fn first_parent_wins() {
        let mut c = child();
        c.started_by_session_id = Some("first".into());
        assert!(!should_record(&c, "second", false));
    }

    #[test]
    fn skips_anon_empty_and_self() {
        assert!(!should_record(&child(), ANON_SOURCE, false));
        assert!(!should_record(&child(), "", false));
        assert!(!should_record(&child(), "child", false));
    }

    #[test]
    fn only_if_unstarted_skips_a_child_that_already_ran() {
        let mut c = child();
        c.runs.push(run());
        assert_eq!(c.runs[0].status, RunStatus::Completed);
        assert!(!should_record(&c, "parent", true));
        assert!(should_record(&c, "parent", false));
    }

    #[test]
    fn old_metadata_without_the_field_still_loads() {
        let json = serde_json::to_value(child()).unwrap();
        assert!(json.get("started_by_session_id").is_none());
        let back: SessionMetadata = serde_json::from_value(json).unwrap();
        assert_eq!(back.started_by_session_id, None);
    }

    #[test]
    fn to_session_carries_both_links_and_sync_back_keeps_them() {
        let mut m = child();
        m.started_by_session_id = Some("parent".into());
        m.forked_from_session_id = Some("source".into());
        let mut session = m.to_session();
        assert_eq!(session.started_by_session_id.as_deref(), Some("parent"));
        assert_eq!(session.forked_from_session_id.as_deref(), Some("source"));

        // A stale frontend Session must not erase the link.
        session.started_by_session_id = None;
        m.update_from_session(&session);
        assert_eq!(m.started_by_session_id.as_deref(), Some("parent"));
    }
}
