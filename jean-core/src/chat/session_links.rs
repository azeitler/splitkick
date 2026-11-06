//! Parent/child links between sessions (#62).
//!
//! When an agent starts another session through the Splitkick MCP, the child
//! records the calling session in `SessionMetadata.started_by_session_id`.
//! Only the child stores the link: the parent's side is the MCP tool call in its
//! own transcript, whose result holds the child id. The chat reads names and
//! archive state live through `get_session_link`, so renames and archiving show.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use tauri::AppHandle;

use super::storage;
use super::types::{Session, SessionMetadata};

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

/// One session in a session network (#77), with where it lives.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNetworkNode {
    /// Session summary (no messages), same shape as the sidebar lists.
    pub session: Session,
    /// Parent within this network. `None` for the root.
    pub parent_id: Option<String>,
    pub project_id: String,
    pub project_name: String,
    pub worktree_id: String,
    pub worktree_name: String,
    pub worktree_path: String,
    pub worktree_archived: bool,
}

/// The tree around one session: its root (found through `started_by`) and
/// every descendant, across worktrees and projects. `nodes` is depth-first,
/// root first; children follow their parent in creation order.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNetwork {
    pub root_id: String,
    /// The root names a parent that is not on this instance (deleted, or on
    /// another device). Splitkick cannot show it.
    pub root_parent_missing: bool,
    pub nodes: Vec<SessionNetworkNode>,
}

/// Build the network of `session_id` from every known session. Pure, so it
/// can be tested without storage. `None` when `session_id` is not in `all`.
fn build_network(session_id: &str, all: Vec<SessionNetworkNode>) -> Option<SessionNetwork> {
    let index: HashMap<String, usize> = all
        .iter()
        .enumerate()
        .map(|(i, node)| (node.session.id.clone(), i))
        .collect();
    let mut current = *index.get(session_id)?;

    // Walk up. `seen` stops a cycle in damaged metadata.
    let mut seen = HashSet::from([current]);
    let mut root_parent_missing = false;
    while let Some(parent_id) = all[current].session.started_by_session_id.as_deref() {
        match index.get(parent_id) {
            Some(&parent) if seen.insert(parent) => current = parent,
            Some(_) => break,
            None => {
                root_parent_missing = true;
                break;
            }
        }
    }
    let root = current;

    let mut children: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, node) in all.iter().enumerate() {
        if let Some(parent_id) = node.session.started_by_session_id.as_deref() {
            children.entry(parent_id).or_default().push(i);
        }
    }
    for list in children.values_mut() {
        list.sort_by_key(|&i| (all[i].session.created_at, all[i].session.order));
    }

    // Depth-first walk down from the root.
    let mut order = Vec::new();
    let mut visited = HashSet::new();
    let mut stack = vec![root];
    while let Some(i) = stack.pop() {
        if !visited.insert(i) {
            continue;
        }
        order.push(i);
        if let Some(kids) = children.get(all[i].session.id.as_str()) {
            stack.extend(kids.iter().rev().copied());
        }
    }

    let mut slots: Vec<Option<SessionNetworkNode>> = all.into_iter().map(Some).collect();
    let mut nodes: Vec<_> = order.into_iter().filter_map(|i| slots[i].take()).collect();
    // Every other node was reached from its parent; only the root can point
    // outside the tree (missing parent, or a cycle).
    nodes[0].parent_id = None;
    Some(SessionNetwork {
        root_id: nodes[0].session.id.clone(),
        root_parent_missing,
        nodes,
    })
}

/// The session network around `session_id` (#77). Reads the session index of
/// every worktree, archived ones too, so archived children still show. Session
/// summaries come from the mtime cache in `storage`, so a repeat call only
/// stats the metadata files. `None` when the session is unknown here.
pub async fn get_session_network(
    app: AppHandle,
    session_id: String,
) -> Result<Option<SessionNetwork>, String> {
    let data = crate::projects::storage::load_projects_data(&app)?;
    let mut all = Vec::new();
    for worktree in &data.worktrees {
        // `load_index` writes a default index when none exists; skip those.
        if !storage::get_index_path(&app, &worktree.id)?.exists() {
            continue;
        }
        let Ok(index) = storage::load_index(&app, &worktree.id) else {
            continue;
        };
        let project_name = data
            .find_project(&worktree.project_id)
            .map(|p| p.name.clone())
            .unwrap_or_default();
        for entry in &index.sessions {
            let Ok(Some((session, _))) = storage::load_session_summary(&app, &entry.id) else {
                continue;
            };
            all.push(SessionNetworkNode {
                parent_id: session.started_by_session_id.clone(),
                session,
                project_id: worktree.project_id.clone(),
                project_name: project_name.clone(),
                worktree_id: worktree.id.clone(),
                worktree_name: worktree.name.clone(),
                worktree_path: worktree.path.clone(),
                worktree_archived: worktree.archived_at.is_some(),
            });
        }
    }
    Ok(build_network(&session_id, all))
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

    fn node(id: &str, parent: Option<&str>, created_at: u64) -> SessionNetworkNode {
        let mut m = SessionMetadata::new(id.into(), "wt".into(), id.into(), 0);
        m.started_by_session_id = parent.map(Into::into);
        m.created_at = created_at;
        SessionNetworkNode {
            session: m.to_session(),
            parent_id: parent.map(Into::into),
            project_id: "p".into(),
            project_name: "P".into(),
            worktree_id: "wt".into(),
            worktree_name: "W".into(),
            worktree_path: "/w".into(),
            worktree_archived: false,
        }
    }

    fn ids(network: &SessionNetwork) -> Vec<&str> {
        network
            .nodes
            .iter()
            .map(|n| n.session.id.as_str())
            .collect()
    }

    #[test]
    fn network_walks_up_to_the_root_and_down_to_every_descendant() {
        let all = vec![
            node("other", None, 0),
            node("leaf", Some("child-b"), 4),
            node("child-b", Some("root"), 3),
            node("root", None, 1),
            node("child-a", Some("root"), 2),
        ];
        let network = build_network("leaf", all).unwrap();
        assert_eq!(network.root_id, "root");
        assert!(!network.root_parent_missing);
        assert_eq!(ids(&network), ["root", "child-a", "child-b", "leaf"]);
        assert_eq!(network.nodes[0].parent_id, None);
        assert_eq!(network.nodes[3].parent_id.as_deref(), Some("child-b"));
    }

    #[test]
    fn network_of_a_lone_session_is_just_that_session() {
        let network = build_network("a", vec![node("a", None, 0)]).unwrap();
        assert_eq!(ids(&network), ["a"]);
    }

    #[test]
    fn network_marks_a_parent_that_is_not_here() {
        let all = vec![node("a", Some("gone"), 0), node("b", Some("a"), 1)];
        let network = build_network("b", all).unwrap();
        assert_eq!(network.root_id, "a");
        assert!(network.root_parent_missing);
        assert_eq!(network.nodes[0].parent_id, None);
    }

    #[test]
    fn network_survives_a_cycle() {
        let all = vec![node("a", Some("b"), 0), node("b", Some("a"), 1)];
        let network = build_network("a", all).unwrap();
        assert_eq!(network.nodes.len(), 2);
        assert_eq!(network.nodes[0].parent_id, None);
    }

    #[test]
    fn network_of_an_unknown_session_is_none() {
        assert!(build_network("x", vec![node("a", None, 0)]).is_none());
    }
}
