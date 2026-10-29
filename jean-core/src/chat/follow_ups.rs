//! Follow-up list per session (#46): notes for future turns that are never
//! sent automatically. Every change is one operation applied under the
//! session's metadata lock, so a change from one client (or the agent through
//! MCP) never overwrites a change from another.

use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use super::commands::emit_worktree_sessions_cache_invalidation;
use super::storage::with_existing_metadata_mut;
use super::types::FollowUp;

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FollowUpOp {
    Add {
        text: String,
    },
    Update {
        id: String,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        done: Option<bool>,
    },
    Remove {
        id: String,
    },
    /// New order. Items whose id is not listed keep their order at the end.
    Reorder {
        ids: Vec<String>,
    },
    ClearDone,
}

/// Apply one operation. Returns the item an `Add` created.
pub fn apply_follow_up_op(
    list: &mut Vec<FollowUp>,
    op: FollowUpOp,
    now_ms: u64,
) -> Result<Option<FollowUp>, String> {
    match op {
        FollowUpOp::Add { text } => {
            let text = text.trim();
            if text.is_empty() {
                return Err("Follow-up text is empty".to_string());
            }
            let item = FollowUp {
                id: uuid::Uuid::new_v4().to_string(),
                text: text.to_string(),
                done: false,
                created_at: now_ms,
            };
            list.push(item.clone());
            return Ok(Some(item));
        }
        FollowUpOp::Update { id, text, done } => {
            if let Some(item) = list.iter_mut().find(|f| f.id == id) {
                if let Some(text) = text {
                    let text = text.trim();
                    if text.is_empty() {
                        return Err("Follow-up text is empty".to_string());
                    }
                    item.text = text.to_string();
                }
                if let Some(done) = done {
                    item.done = done;
                }
            }
        }
        FollowUpOp::Remove { id } => list.retain(|f| f.id != id),
        FollowUpOp::Reorder { ids } => {
            let mut rest = std::mem::take(list);
            for id in &ids {
                if let Some(pos) = rest.iter().position(|f| &f.id == id) {
                    list.push(rest.remove(pos));
                }
            }
            list.extend(rest);
        }
        FollowUpOp::ClearDone => list.retain(|f| !f.done),
    }
    Ok(None)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Change a session's follow-up list and return the new list.
pub async fn edit_session_follow_ups(
    app: AppHandle,
    worktree_id: String,
    _worktree_path: String,
    session_id: String,
    op: FollowUpOp,
) -> Result<Vec<FollowUp>, String> {
    let list = with_existing_metadata_mut(&app, &session_id, |metadata| {
        apply_follow_up_op(&mut metadata.follow_ups, op, now_ms())?;
        Ok::<_, String>(metadata.follow_ups.clone())
    })??;
    emit_worktree_sessions_cache_invalidation(&app, &worktree_id);
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, done: bool) -> FollowUp {
        FollowUp {
            id: id.to_string(),
            text: format!("text {id}"),
            done,
            created_at: 1,
        }
    }

    fn ids(list: &[FollowUp]) -> Vec<&str> {
        list.iter().map(|f| f.id.as_str()).collect()
    }

    #[test]
    fn add_trims_and_appends() {
        let mut list = vec![item("a", false)];
        let added = apply_follow_up_op(
            &mut list,
            FollowUpOp::Add {
                text: "  check the tests \n".to_string(),
            },
            42,
        )
        .unwrap()
        .unwrap();
        assert_eq!(added.text, "check the tests");
        assert_eq!(added.created_at, 42);
        assert!(!added.done);
        assert_eq!(list.len(), 2);
        assert_eq!(list[1], added);
    }

    #[test]
    fn add_rejects_empty_text() {
        let mut list = vec![];
        let result = apply_follow_up_op(
            &mut list,
            FollowUpOp::Add {
                text: "   ".to_string(),
            },
            1,
        );
        assert!(result.is_err());
        assert!(list.is_empty());
    }

    #[test]
    fn update_changes_text_and_done() {
        let mut list = vec![item("a", false), item("b", false)];
        apply_follow_up_op(
            &mut list,
            FollowUpOp::Update {
                id: "b".to_string(),
                text: Some(" new ".to_string()),
                done: Some(true),
            },
            1,
        )
        .unwrap();
        assert_eq!(list[1].text, "new");
        assert!(list[1].done);
        assert!(!list[0].done);
    }

    #[test]
    fn update_and_remove_of_unknown_id_change_nothing() {
        let mut list = vec![item("a", false)];
        let before = list.clone();
        apply_follow_up_op(
            &mut list,
            FollowUpOp::Update {
                id: "x".to_string(),
                text: None,
                done: Some(true),
            },
            1,
        )
        .unwrap();
        apply_follow_up_op(
            &mut list,
            FollowUpOp::Remove {
                id: "x".to_string(),
            },
            1,
        )
        .unwrap();
        assert_eq!(list, before);
    }

    #[test]
    fn remove_drops_the_item() {
        let mut list = vec![item("a", false), item("b", false)];
        apply_follow_up_op(
            &mut list,
            FollowUpOp::Remove {
                id: "a".to_string(),
            },
            1,
        )
        .unwrap();
        assert_eq!(ids(&list), vec!["b"]);
    }

    #[test]
    fn reorder_keeps_unlisted_items_at_the_end() {
        let mut list = vec![item("a", false), item("b", false), item("c", false)];
        apply_follow_up_op(
            &mut list,
            FollowUpOp::Reorder {
                ids: vec!["c".to_string(), "x".to_string(), "a".to_string()],
            },
            1,
        )
        .unwrap();
        assert_eq!(ids(&list), vec!["c", "a", "b"]);
    }

    #[test]
    fn clear_done_keeps_open_items() {
        let mut list = vec![item("a", true), item("b", false), item("c", true)];
        apply_follow_up_op(&mut list, FollowUpOp::ClearDone, 1).unwrap();
        assert_eq!(ids(&list), vec!["b"]);
    }

    #[test]
    fn ops_deserialize_from_snake_case_kinds() {
        let op: FollowUpOp = serde_json::from_str(r#"{"kind":"add","text":"x"}"#).unwrap();
        assert_eq!(
            op,
            FollowUpOp::Add {
                text: "x".to_string()
            }
        );
        let op: FollowUpOp = serde_json::from_str(r#"{"kind":"clear_done"}"#).unwrap();
        assert_eq!(op, FollowUpOp::ClearDone);
        let op: FollowUpOp =
            serde_json::from_str(r#"{"kind":"update","id":"a","done":true}"#).unwrap();
        assert_eq!(
            op,
            FollowUpOp::Update {
                id: "a".to_string(),
                text: None,
                done: Some(true)
            }
        );
    }

    #[test]
    fn metadata_without_follow_ups_loads_and_empty_list_is_not_written() {
        use crate::chat::types::SessionMetadata;
        let meta = SessionMetadata::new(
            "s1".to_string(),
            "w1".to_string(),
            "Session 1".to_string(),
            0,
        );
        let json = serde_json::to_string(&meta).unwrap();
        assert!(!json.contains("follow_ups"));
        let back: SessionMetadata = serde_json::from_str(&json).unwrap();
        assert!(back.follow_ups.is_empty());

        let mut meta = back;
        meta.follow_ups.push(item("a", true));
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains(r#""follow_ups":[{"id":"a""#));
        let back: SessionMetadata = serde_json::from_str(&json).unwrap();
        assert_eq!(back.follow_ups, vec![item("a", true)]);
    }
}
