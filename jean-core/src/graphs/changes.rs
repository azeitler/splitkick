//! Per-graph change log (`changes/<graph-id>.jsonl`), seen state and revert.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::AppHandle;
use uuid::Uuid;

use super::model::{GraphActor, GraphChange, GraphNode, NodeFile};
use super::store::{
    self, graphs_dir, read_json, safe_name, write_atomic, write_json, APP_DATA_LOCK,
};

fn changes_path(app: &AppHandle, graph_id: &str) -> Result<PathBuf, String> {
    let dir = graphs_dir(app)?.join("changes");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create changes dir: {e}"))?;
    Ok(dir.join(format!("{}.jsonl", safe_name(graph_id))))
}

fn seen_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(graphs_dir(app)?.join("seen.json"))
}

fn read_changes(path: &Path) -> Result<Vec<GraphChange>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read changes: {e}"))?;
    Ok(content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| match serde_json::from_str::<GraphChange>(l) {
            Ok(c) => Some(c),
            Err(e) => {
                log::warn!("Skipping bad graph change line: {e}");
                None
            }
        })
        .collect())
}

fn write_changes(path: &Path, changes: &[GraphChange]) -> Result<(), String> {
    let mut out = String::new();
    for c in changes {
        out.push_str(&serde_json::to_string(c).map_err(|e| format!("Serialize change: {e}"))?);
        out.push('\n');
    }
    write_atomic(path, out.as_bytes())
}

/// Build a change entry (not yet stored).
pub fn new_change(
    graph_id: &str,
    node_id: Option<&str>,
    actor: &GraphActor,
    action: &str,
    summary: String,
    why: Option<String>,
    before: Option<GraphNode>,
    after: Option<GraphNode>,
) -> GraphChange {
    GraphChange {
        id: Uuid::new_v4().to_string(),
        graph_id: graph_id.to_string(),
        node_id: node_id.map(str::to_string),
        at: store::now_ms(),
        actor: actor.clone(),
        action: action.to_string(),
        summary,
        why: why.filter(|w| !w.trim().is_empty()),
        before,
        after,
        reverted_by: None,
        seen: false,
    }
}

/// Append one change to the graph's log.
pub fn append_change(app: &AppHandle, change: &GraphChange) -> Result<(), String> {
    let _guard = APP_DATA_LOCK.lock().unwrap();
    let path = changes_path(app, &change.graph_id)?;
    let line = serde_json::to_string(change).map_err(|e| format!("Serialize change: {e}"))?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open change log: {e}"))?;
    writeln!(file, "{line}").map_err(|e| format!("Failed to append change: {e}"))
}

fn load_seen(app: &AppHandle) -> Result<HashMap<String, Vec<String>>, String> {
    read_json(&seen_path(app)?)
}

/// All changes of a graph, newest first, with `seen` computed.
pub fn list_changes(app: &AppHandle, graph_id: &str) -> Result<Vec<GraphChange>, String> {
    let _guard = APP_DATA_LOCK.lock().unwrap();
    let mut changes = read_changes(&changes_path(app, graph_id)?)?;
    let seen: HashSet<String> = load_seen(app)?
        .remove(graph_id)
        .unwrap_or_default()
        .into_iter()
        .collect();
    for c in &mut changes {
        c.seen = c.actor.is_user() || seen.contains(&c.id);
    }
    changes.reverse();
    Ok(changes)
}

pub fn unseen_count(app: &AppHandle, graph_id: &str) -> usize {
    list_changes(app, graph_id)
        .map(|c| c.iter().filter(|c| !c.seen).count())
        .unwrap_or(0)
}

/// Mark the given changes (or all when `None`) as seen.
pub fn mark_seen(
    app: &AppHandle,
    graph_id: &str,
    change_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let _guard = APP_DATA_LOCK.lock().unwrap();
    let ids = match change_ids {
        Some(ids) => ids,
        None => read_changes(&changes_path(app, graph_id)?)?
            .into_iter()
            .filter(|c| !c.actor.is_user())
            .map(|c| c.id)
            .collect(),
    };
    let path = seen_path(app)?;
    let mut seen: HashMap<String, Vec<String>> = read_json(&path)?;
    let list = seen.entry(graph_id.to_string()).or_default();
    for id in ids {
        if !list.contains(&id) {
            list.push(id);
        }
    }
    write_json(&path, &seen)
}

/// Undo one node change. Refuses when the node no longer matches the change's
/// `after`. The revert is itself a change (`action: "revert"`).
pub fn revert_change(app: &AppHandle, graph_id: &str, change_id: &str) -> Result<(), String> {
    let changes = list_changes(app, graph_id)?;
    let change = changes
        .iter()
        .find(|c| c.id == change_id)
        .ok_or_else(|| format!("Unknown change: {change_id}"))?
        .clone();
    if change.reverted_by.is_some() {
        return Err("This change was already reverted".to_string());
    }
    let node_id = change
        .node_id
        .clone()
        .filter(|_| change.before.is_some() || change.after.is_some())
        .ok_or_else(|| "Only node changes can be reverted".to_string())?;

    let (current, target) = store::with_graph_mut(app, graph_id, |graph| {
        let index = graph.nodes.iter().position(|n| n.id == node_id);
        let current = index.map(|i| graph.nodes[i].to_api());
        if current != change.after {
            return Err(format!(
                "Cannot revert: node {node_id} changed after this change"
            ));
        }
        match (&change.before, index) {
            (None, Some(i)) => {
                graph.nodes.remove(i);
            }
            (Some(before), Some(i)) => graph.nodes[i].apply_api(before),
            (Some(before), None) => graph.nodes.push(NodeFile::from_api(before)),
            (None, None) => {}
        }
        Ok((current, change.before.clone()))
    })?;

    let title = target
        .as_ref()
        .or(current.as_ref())
        .map(|n| n.title.clone())
        .unwrap_or_default();
    let revert = new_change(
        graph_id,
        Some(&node_id),
        &GraphActor::User,
        "revert",
        format!("Reverted: {} ({title})", change.summary),
        None,
        current,
        target,
    );
    append_change(app, &revert)?;

    let _guard = APP_DATA_LOCK.lock().unwrap();
    let path = changes_path(app, graph_id)?;
    let mut all = read_changes(&path)?;
    for c in &mut all {
        if c.id == change_id {
            c.reverted_by = Some(revert.id.clone());
        }
    }
    write_changes(&path, &all)?;
    drop(_guard);
    // Reverting is acting on the change: it no longer waits in "unseen".
    mark_seen(app, graph_id, Some(vec![change_id.to_string()]))
}
