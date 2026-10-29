//! Auto-archive a worktree after its pull request is merged (issue #50).
//!
//! The merged-PR event only says "PR #N is merged". It does not say the worktree
//! is done: a session can still run in it, or the agent may have checked out a
//! new branch. All guards live here so every client gets the same answer.

use serde::Serialize;
use tauri::AppHandle;

use super::storage::{load_projects_data, update_projects_data};
use super::types::{SessionType, Worktree};
use crate::chat::types::{RunStatus, Session};
use crate::platform::silent_command;

/// What `auto_archive_merged_worktree` did.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutoArchiveOutcome {
    Archived,
    Deleted,
    /// A session is busy or the tree has changes. A later poll tries again.
    Deferred,
    /// HEAD left the merged PR. The stale link was replaced, nothing archived.
    Relinked,
    Skipped,
}

#[derive(Debug, PartialEq, Eq)]
enum Decision {
    Skip,
    Defer,
    Relink,
    Archive,
}

/// Inputs of the auto-archive decision, gathered from disk and git.
struct Facts<'a> {
    worktree: &'a Worktree,
    pr_url: &'a str,
    session_busy: bool,
    head: Option<&'a str>,
    pr_head_oid: Option<&'a str>,
    dirty: bool,
}

fn decide(facts: &Facts) -> Decision {
    let wt = facts.worktree;
    if wt.archived_at.is_some()
        || wt.session_type == SessionType::Base
        || wt.pr_url.as_deref() != Some(facts.pr_url)
        || wt.auto_archived_pr_url.as_deref() == Some(facts.pr_url)
    {
        return Decision::Skip;
    }
    // Archiving cancels every run in the worktree.
    if facts.session_busy {
        return Decision::Defer;
    }
    match (facts.head, facts.pr_head_oid) {
        // The worktree went on to other work (new branch, new commits).
        (Some(head), Some(oid)) if head != oid => Decision::Relink,
        (Some(_), Some(_)) if !facts.dirty => Decision::Archive,
        _ => Decision::Defer,
    }
}

/// A session that runs, can resume, waits for the user, or has work queued.
fn session_is_busy(session: &Session) -> bool {
    if session.archived_at.is_some() {
        return false;
    }
    matches!(
        session.last_run_status,
        Some(RunStatus::Running | RunStatus::Resumable)
    ) || session.waiting_for_input
        || !session.queued_messages.is_empty()
        || session.scheduled_wakeup.is_some()
        || !session.pending_permission_denials.is_empty()
        || !session.pending_codex_permission_requests.is_empty()
        || !session.pending_opencode_permission_requests.is_empty()
        || !session.pending_codex_command_approval_requests.is_empty()
        || !session.pending_codex_user_input_requests.is_empty()
        || !session.pending_codex_mcp_elicitation_requests.is_empty()
        || !session.pending_codex_dynamic_tool_call_requests.is_empty()
}

fn git_stdout(worktree_path: &str, args: &[&str]) -> Option<String> {
    let output = silent_command("git")
        .args(args)
        .current_dir(worktree_path)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn any_session_busy(app: &AppHandle, worktree_id: &str) -> bool {
    crate::chat::storage::load_sessions_by_id(app, worktree_id)
        .map(|sessions| {
            sessions.sessions.iter().any(|s| {
                crate::chat::registry::is_session_actively_managed(&s.id) || session_is_busy(s)
            })
        })
        .unwrap_or(false)
}

/// Archive (or delete) a worktree whose linked PR `pr_url` is merged, but only
/// when nothing in it is still going on. See [`decide`] for the guards.
pub async fn auto_archive_merged_worktree(
    app: AppHandle,
    worktree_id: String,
    pr_url: String,
    head_oid: Option<String>,
    delete: bool,
) -> Result<AutoArchiveOutcome, String> {
    let data = load_projects_data(&app)?;
    let Some(worktree) = data.worktrees.iter().find(|w| w.id == worktree_id) else {
        return Ok(AutoArchiveOutcome::Skipped);
    };

    let session_busy = any_session_busy(&app, &worktree_id);
    let head = git_stdout(&worktree.path, &["rev-parse", "HEAD"]);
    let dirty = git_stdout(&worktree.path, &["status", "--porcelain"])
        .map(|s| !s.is_empty())
        // Unknown state: do not archive.
        .unwrap_or(true);

    let decision = decide(&Facts {
        worktree,
        pr_url: &pr_url,
        session_busy,
        head: head.as_deref(),
        pr_head_oid: head_oid.as_deref(),
        dirty,
    });
    let worktree_path = worktree.path.clone();

    match decision {
        Decision::Skip => Ok(AutoArchiveOutcome::Skipped),
        Decision::Defer => {
            log::info!("Auto-archive of worktree {worktree_id} deferred (session busy or changes)");
            Ok(AutoArchiveOutcome::Deferred)
        }
        Decision::Relink => {
            log::info!(
                "Worktree {worktree_id} moved past merged PR {pr_url}; relinking instead of archiving"
            );
            super::clear_worktree_pr(app.clone(), worktree_id.clone()).await?;
            super::detect_and_link_pr(app, worktree_id, worktree_path).await?;
            Ok(AutoArchiveOutcome::Relinked)
        }
        Decision::Archive => {
            // Write the marker first: a crash between the two steps must not
            // archive the same PR again after the user unarchives.
            update_projects_data(&app, |data| {
                let Some(wt) = data.worktrees.iter_mut().find(|w| w.id == worktree_id) else {
                    return false;
                };
                wt.auto_archived_pr_url = Some(pr_url.clone());
                true
            })?;
            if delete {
                super::delete_worktree(app, worktree_id).await?;
                Ok(AutoArchiveOutcome::Deleted)
            } else {
                super::archive_worktree(app, worktree_id).await?;
                Ok(AutoArchiveOutcome::Archived)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PR: &str = "https://github.com/owner/repo/pull/2";
    const OID: &str = "abc123";

    fn worktree() -> Worktree {
        serde_json::from_value(serde_json::json!({
            "id": "wt-1",
            "project_id": "p-1",
            "name": "feature",
            "path": "/tmp/wt-1",
            "branch": "feature",
            "created_at": 1,
            "pr_number": 2,
            "pr_url": PR,
            "order": 0
        }))
        .unwrap()
    }

    fn facts(worktree: &Worktree) -> Facts<'_> {
        Facts {
            worktree,
            pr_url: PR,
            session_busy: false,
            head: Some(OID),
            pr_head_oid: Some(OID),
            dirty: false,
        }
    }

    fn session(value: serde_json::Value) -> Session {
        let mut base = serde_json::json!({
            "id": "s-1",
            "name": "Session 1",
            "order": 0,
            "created_at": 1,
            "updated_at": 1,
            "messages": []
        });
        base.as_object_mut()
            .unwrap()
            .extend(value.as_object().unwrap().clone());
        serde_json::from_value(base).unwrap()
    }

    #[test]
    fn archives_a_clean_idle_worktree_at_the_merged_head() {
        let wt = worktree();
        assert_eq!(decide(&facts(&wt)), Decision::Archive);
    }

    #[test]
    fn defers_while_a_session_is_busy() {
        let wt = worktree();
        let f = Facts {
            session_busy: true,
            ..facts(&wt)
        };
        assert_eq!(decide(&f), Decision::Defer);
    }

    #[test]
    fn busy_session_wins_over_a_moved_head() {
        // Relinking is harmless, but nothing may touch a busy worktree first.
        let wt = worktree();
        let f = Facts {
            session_busy: true,
            head: Some("other"),
            ..facts(&wt)
        };
        assert_eq!(decide(&f), Decision::Defer);
    }

    #[test]
    fn relinks_when_head_left_the_merged_pr() {
        let wt = worktree();
        let f = Facts {
            head: Some("def456"),
            dirty: true,
            ..facts(&wt)
        };
        assert_eq!(decide(&f), Decision::Relink);
    }

    #[test]
    fn defers_with_uncommitted_changes_at_the_merged_head() {
        let wt = worktree();
        let f = Facts {
            dirty: true,
            ..facts(&wt)
        };
        assert_eq!(decide(&f), Decision::Defer);
    }

    #[test]
    fn defers_when_the_pr_head_commit_is_unknown() {
        let wt = worktree();
        let f = Facts {
            pr_head_oid: None,
            ..facts(&wt)
        };
        assert_eq!(decide(&f), Decision::Defer);
    }

    #[test]
    fn skips_a_pr_that_was_already_auto_archived_once() {
        let mut wt = worktree();
        wt.auto_archived_pr_url = Some(PR.to_string());
        assert_eq!(decide(&facts(&wt)), Decision::Skip);
    }

    #[test]
    fn archives_again_for_a_different_merged_pr() {
        let mut wt = worktree();
        wt.auto_archived_pr_url = Some("https://github.com/owner/repo/pull/1".to_string());
        assert_eq!(decide(&facts(&wt)), Decision::Archive);
    }

    #[test]
    fn skips_when_the_event_is_for_a_pr_no_longer_linked() {
        let mut wt = worktree();
        wt.pr_url = Some("https://github.com/owner/repo/pull/3".to_string());
        assert_eq!(decide(&facts(&wt)), Decision::Skip);
    }

    #[test]
    fn skips_archived_and_base_worktrees() {
        let mut archived = worktree();
        archived.archived_at = Some(5);
        assert_eq!(decide(&facts(&archived)), Decision::Skip);

        let mut base = worktree();
        base.session_type = SessionType::Base;
        assert_eq!(decide(&facts(&base)), Decision::Skip);
    }

    #[test]
    fn idle_session_is_not_busy() {
        assert!(!session_is_busy(&session(serde_json::json!({
            "last_run_status": "completed"
        }))));
    }

    #[test]
    fn running_resumable_and_waiting_sessions_are_busy() {
        for value in [
            serde_json::json!({ "last_run_status": "running" }),
            serde_json::json!({ "last_run_status": "resumable" }),
            serde_json::json!({ "waiting_for_input": true }),
            serde_json::json!({ "queued_messages": [{ "id": "q" }] }),
        ] {
            assert!(session_is_busy(&session(value.clone())), "{value}");
        }
    }

    #[test]
    fn archived_session_is_not_busy() {
        assert!(!session_is_busy(&session(serde_json::json!({
            "waiting_for_input": true,
            "archived_at": 5
        }))));
    }
}
