//! Artifact list per session: files and URLs the agent registered as outputs
//! through the `add_artifact` MCP tool. Every change is one operation applied
//! under the session's metadata lock, like the follow-up list.

use serde::Deserialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use super::commands::emit_worktree_sessions_cache_invalidation;
use super::storage::with_existing_metadata_mut;
use super::types::Artifact;

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ArtifactOp {
    /// Add an artifact. An existing item with the same target is updated and
    /// moved to the end instead of added twice.
    Add {
        title: String,
        target: String,
        #[serde(default)]
        note: Option<String>,
    },
    Remove {
        id: String,
    },
    Clear,
}

/// URLs stay as they are; a relative path is resolved in the worktree.
fn resolve_target(target: &str, worktree_path: &str) -> String {
    if target.contains("://") || Path::new(target).is_absolute() || worktree_path.is_empty() {
        return target.to_string();
    }
    Path::new(worktree_path)
        .join(target)
        .to_string_lossy()
        .into_owned()
}

/// Apply one operation. Returns the item an `Add` created or updated.
pub fn apply_artifact_op(
    list: &mut Vec<Artifact>,
    op: ArtifactOp,
    worktree_path: &str,
    now_ms: u64,
) -> Result<Option<Artifact>, String> {
    match op {
        ArtifactOp::Add {
            title,
            target,
            note,
        } => {
            let title = title.trim();
            if title.is_empty() {
                return Err("Artifact title is empty".to_string());
            }
            let target = target.trim();
            if target.is_empty() {
                return Err("Artifact target is empty".to_string());
            }
            let target = resolve_target(target, worktree_path);
            let note = note.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
            let id = match list.iter().position(|a| a.target == target) {
                Some(pos) => list.remove(pos).id,
                None => uuid::Uuid::new_v4().to_string(),
            };
            let item = Artifact {
                id,
                title: title.to_string(),
                target,
                note,
                created_at: now_ms,
            };
            list.push(item.clone());
            return Ok(Some(item));
        }
        ArtifactOp::Remove { id } => list.retain(|a| a.id != id),
        ArtifactOp::Clear => list.clear(),
    }
    Ok(None)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Change a session's artifact list and return the new list.
pub async fn edit_session_artifacts(
    app: AppHandle,
    worktree_id: String,
    worktree_path: String,
    session_id: String,
    op: ArtifactOp,
) -> Result<Vec<Artifact>, String> {
    let list = with_existing_metadata_mut(&app, &session_id, |metadata| {
        apply_artifact_op(&mut metadata.artifacts, op, &worktree_path, now_ms())?;
        Ok::<_, String>(metadata.artifacts.clone())
    })??;
    emit_worktree_sessions_cache_invalidation(&app, &worktree_id);
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Absolute on every OS: a hard-coded `/a` is relative on Windows.
    fn abs(name: &str) -> String {
        std::env::temp_dir()
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    fn add(title: &str, target: &str) -> ArtifactOp {
        ArtifactOp::Add {
            title: title.to_string(),
            target: target.to_string(),
            note: None,
        }
    }

    #[test]
    fn add_trims_and_appends() {
        let mut list = vec![];
        let target = abs("r.html");
        let wt = abs("wt");
        let added = apply_artifact_op(
            &mut list,
            add("  Report \n", &format!(" {target} ")),
            &wt,
            42,
        )
        .unwrap()
        .unwrap();
        assert_eq!(added.title, "Report");
        assert_eq!(added.target, target);
        assert_eq!(added.created_at, 42);
        assert_eq!(list, vec![added]);
    }

    #[test]
    fn add_rejects_empty_title_or_target() {
        let mut list = vec![];
        let wt = abs("wt");
        assert!(apply_artifact_op(&mut list, add("  ", &abs("a")), &wt, 1).is_err());
        assert!(apply_artifact_op(&mut list, add("A", " "), &wt, 1).is_err());
        assert!(list.is_empty());
    }

    #[test]
    fn relative_path_resolves_in_worktree() {
        let mut list = vec![];
        let wt = abs("wt");
        let added = apply_artifact_op(&mut list, add("Shot", "tmp/shot.png"), &wt, 1)
            .unwrap()
            .unwrap();
        let expected = Path::new(&wt).join("tmp/shot.png");
        assert_eq!(added.target, expected.to_string_lossy());
        assert!(Path::new(&added.target).is_absolute());
    }

    #[test]
    fn url_stays_unchanged() {
        let mut list = vec![];
        let wt = abs("wt");
        for url in ["https://x.dev/a", "file:///tmp/a.html"] {
            let added = apply_artifact_op(&mut list, add("Link", url), &wt, 1)
                .unwrap()
                .unwrap();
            assert_eq!(added.target, url);
        }
    }

    #[test]
    fn same_target_updates_and_moves_to_end() {
        let mut list = vec![];
        let wt = abs("wt");
        let (a, b) = (abs("a"), abs("b"));
        let first = apply_artifact_op(&mut list, add("Old", &a), &wt, 1)
            .unwrap()
            .unwrap();
        apply_artifact_op(&mut list, add("B", &b), &wt, 2).unwrap();
        let again = apply_artifact_op(
            &mut list,
            ArtifactOp::Add {
                title: "New".to_string(),
                target: a.clone(),
                note: Some("v2".to_string()),
            },
            &wt,
            3,
        )
        .unwrap()
        .unwrap();
        assert_eq!(again.id, first.id);
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].title, "New");
        assert_eq!(list[1].note.as_deref(), Some("v2"));
        assert_eq!(list[1].created_at, 3);
    }

    #[test]
    fn remove_and_clear() {
        let mut list = vec![];
        let wt = abs("wt");
        let a = apply_artifact_op(&mut list, add("A", &abs("a")), &wt, 1)
            .unwrap()
            .unwrap();
        apply_artifact_op(&mut list, add("B", &abs("b")), &wt, 1).unwrap();
        apply_artifact_op(&mut list, ArtifactOp::Remove { id: a.id }, &wt, 1).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].target, abs("b"));
        apply_artifact_op(&mut list, ArtifactOp::Clear, &wt, 1).unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn op_deserializes_from_frontend_shape() {
        let op: ArtifactOp =
            serde_json::from_value(serde_json::json!({"kind": "remove", "id": "x"})).unwrap();
        assert_eq!(
            op,
            ArtifactOp::Remove {
                id: "x".to_string()
            }
        );
    }
}
