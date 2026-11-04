//! Graph operations. The `pub fn ... actor` functions are shared with the MCP
//! tools; the `pub async fn` commands are the UI commands (actor = user).
//! Every write emits `cache:invalidate` itself, so UI and MCP writes refresh all clients.

use std::path::{Path, PathBuf};

use rand::Rng;
use tauri::AppHandle;
use uuid::Uuid;

use super::changes::{self, append_change, new_change};
use super::derive::{self, OtherGraph, ServingEntry};
use super::location;
use super::model::*;
use super::permissions::{find_agent, parse_permission};
use super::requests;
use super::store::{self, emit_graphs_changed};

// ============================================================================
// Helpers
// ============================================================================

const ID_CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

/// A 6-char node id `[a-z0-9]`, unique in the graph. It always holds a letter,
/// so YAML never reads it as a number.
pub fn new_node_id(graph: &GraphFile) -> String {
    let mut rng = rand::thread_rng();
    loop {
        let id: String = (0..6)
            .map(|_| ID_CHARS[rng.gen_range(0..ID_CHARS.len())] as char)
            .collect();
        if id.chars().any(|c| c.is_ascii_alphabetic()) && !graph.nodes.iter().any(|n| n.id == id) {
            return id;
        }
    }
}

fn change_summary(action: &str, before: Option<&GraphNode>, after: Option<&GraphNode>) -> String {
    match (before, after) {
        (None, Some(a)) => format!("Created \"{}\"", a.title),
        (Some(b), None) => format!("Deleted \"{}\"", b.title),
        (Some(b), Some(a)) if b.state != a.state && action == "node.state" => format!(
            "\"{}\": {} → {}",
            a.title,
            b.state.as_str(),
            a.state.as_str()
        ),
        (Some(b), Some(a)) if b.title != a.title => {
            format!("Renamed \"{}\" to \"{}\"", b.title, a.title)
        }
        (_, Some(a)) => format!("Updated \"{}\"", a.title),
        (None, None) => String::new(),
    }
}

fn validate_node(node: &GraphNode) -> Result<(), String> {
    if node.title.trim().is_empty() {
        return Err("A node needs a title".to_string());
    }
    if node.relations.iter().any(|r| r.target.trim().is_empty()) {
        return Err("A relation needs a target".to_string());
    }
    if node.attachments.iter().any(|a| a.kind.trim().is_empty()) {
        return Err("An attachment needs a kind".to_string());
    }
    Ok(())
}

// ============================================================================
// Node operations (shared with MCP; caller checks permissions)
// ============================================================================

pub fn read_node(app: &AppHandle, graph_id: &str, node_id: &str) -> Result<GraphNode, String> {
    store::load_graph(app, graph_id)?
        .nodes
        .iter()
        .find(|n| n.id == node_id)
        .map(NodeFile::to_api)
        .ok_or_else(|| format!("Unknown node: {node_id}"))
}

pub fn create_node(
    app: &AppHandle,
    graph_id: &str,
    input: NewGraphNode,
    actor: &GraphActor,
    why: Option<String>,
) -> Result<GraphNode, String> {
    let node = store::with_graph_mut(app, graph_id, |graph| {
        let node = GraphNode {
            id: new_node_id(graph),
            title: input.title.trim().to_string(),
            description: input.description.unwrap_or_default(),
            state: input.state.unwrap_or_default(),
            properties: input.properties.unwrap_or_default(),
            relations: input.relations.unwrap_or_default(),
            attachments: input.attachments.unwrap_or_default(),
        };
        validate_node(&node)?;
        let mut file = NodeFile::from_api(&node);
        // A new node writes its state explicitly, even `proposed`.
        file.state = Some(node.state);
        graph.nodes.push(file);
        Ok(node)
    })?;
    append_change(
        app,
        &new_change(
            graph_id,
            Some(&node.id),
            actor,
            "node.create",
            change_summary("node.create", None, Some(&node)),
            why,
            None,
            Some(node.clone()),
        ),
    )?;
    emit_graphs_changed(app, false);
    Ok(node)
}

/// Change one node through `f` and log it. `action` overrides the logged action
/// (default: `node.state` when only the state changed, else `node.update`).
/// Returns the node; nothing is logged or written when nothing changed.
pub fn mutate_node(
    app: &AppHandle,
    graph_id: &str,
    node_id: &str,
    actor: &GraphActor,
    why: Option<String>,
    action: Option<&str>,
    f: impl FnOnce(&mut GraphNode),
) -> Result<GraphNode, String> {
    let (before, after) = store::with_graph_mut(app, graph_id, |graph| {
        let file = graph
            .nodes
            .iter_mut()
            .find(|n| n.id == node_id)
            .ok_or_else(|| format!("Unknown node: {node_id}"))?;
        let before = file.to_api();
        let mut after = before.clone();
        f(&mut after);
        if after != before {
            validate_node(&after)?;
            file.apply_api(&after);
        }
        Ok((before, after))
    })?;
    if before == after {
        return Ok(after);
    }
    let action = action.unwrap_or_else(|| {
        let mut only_state = before.clone();
        only_state.state = after.state;
        if only_state == after {
            "node.state"
        } else {
            "node.update"
        }
    });
    let summary_action = if before.state != after.state && action != "node.update" {
        "node.state"
    } else {
        action
    };
    append_change(
        app,
        &new_change(
            graph_id,
            Some(node_id),
            actor,
            action,
            change_summary(summary_action, Some(&before), Some(&after)),
            why,
            Some(before),
            Some(after.clone()),
        ),
    )?;
    emit_graphs_changed(app, false);
    Ok(after)
}

pub fn update_node(
    app: &AppHandle,
    graph_id: &str,
    node_id: &str,
    patch: GraphNodePatch,
    actor: &GraphActor,
    why: Option<String>,
) -> Result<GraphNode, String> {
    mutate_node(app, graph_id, node_id, actor, why, None, |n| {
        if let Some(title) = patch.title {
            n.title = title.trim().to_string();
        }
        if let Some(description) = patch.description {
            n.description = description;
        }
        if let Some(state) = patch.state {
            n.state = state;
        }
        if let Some(properties) = patch.properties {
            n.properties = properties;
        }
        if let Some(relations) = patch.relations {
            n.relations = relations;
        }
        if let Some(attachments) = patch.attachments {
            n.attachments = attachments;
        }
    })
}

pub fn set_node_state(
    app: &AppHandle,
    graph_id: &str,
    node_id: &str,
    state: NodeState,
    actor: &GraphActor,
    why: Option<String>,
) -> Result<GraphNode, String> {
    mutate_node(
        app,
        graph_id,
        node_id,
        actor,
        why,
        Some("node.state"),
        |n| n.state = state,
    )
}

/// Delete a node and the same-graph relations that point to it.
pub fn delete_node(
    app: &AppHandle,
    graph_id: &str,
    node_id: &str,
    actor: &GraphActor,
    why: Option<String>,
) -> Result<(), String> {
    let before = store::with_graph_mut(app, graph_id, |graph| {
        let index = graph
            .nodes
            .iter()
            .position(|n| n.id == node_id)
            .ok_or_else(|| format!("Unknown node: {node_id}"))?;
        let removed = graph.nodes.remove(index).to_api();
        let qualified = format!("{graph_id}#{node_id}");
        for file in &mut graph.nodes {
            let mut node = file.to_api();
            let count = node.relations.len();
            node.relations
                .retain(|r| r.target != node_id && r.target != qualified);
            if node.relations.len() != count {
                file.set_relations(&node.relations);
            }
        }
        Ok(removed)
    })?;
    append_change(
        app,
        &new_change(
            graph_id,
            Some(node_id),
            actor,
            "node.delete",
            change_summary("node.delete", Some(&before), None),
            why,
            Some(before),
            None,
        ),
    )?;
    emit_graphs_changed(app, false);
    Ok(())
}

// ============================================================================
// Summaries and detail
// ============================================================================

fn summary_for(app: &AppHandle, entry: &RegistryEntry) -> GraphSummary {
    let path = Path::new(&entry.path);
    let missing = !path.is_file();
    let (graph, error) = if missing {
        (None, None)
    } else {
        match store::read_graph_file(path) {
            Ok(g) => (Some(g), None),
            Err(e) => (None, Some(e)),
        }
    };
    build_summary(app, entry, graph.as_ref(), missing, error)
}

fn build_summary(
    app: &AppHandle,
    entry: &RegistryEntry,
    graph: Option<&GraphFile>,
    missing: bool,
    error: Option<String>,
) -> GraphSummary {
    let loc = location::location_info(app, &entry.path);
    let fallback_title = Path::new(&entry.path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    GraphSummary {
        id: entry.id.clone(),
        title: graph
            .map(|g| g.title.clone())
            .filter(|t| !t.is_empty())
            .unwrap_or(fallback_title),
        graph_type: graph.map(|g| g.graph_type.clone()).unwrap_or_default(),
        path: entry.path.clone(),
        location_kind: loc.location_kind,
        repo_root: loc.repo_root,
        project_id: loc.project_id,
        project_name: loc.project_name,
        branch: loc.branch,
        default_branch: loc.default_branch,
        off_default_branch: loc.off_default_branch,
        missing,
        error,
        node_count: graph.map(|g| g.nodes.len()).unwrap_or(0),
        unseen_changes: changes::unseen_count(app, &entry.id),
        open_requests: requests::open_count(app, &entry.id),
    }
}

fn registry_entry(app: &AppHandle, graph_id: &str) -> Result<RegistryEntry, String> {
    store::load_registry(app)?
        .into_iter()
        .find(|e| e.id == graph_id)
        .ok_or_else(|| format!("Unknown graph: {graph_id}"))
}

/// The status label of a session as shown on a node.
fn session_status(session: &crate::chat::types::Session) -> String {
    let running = crate::chat::registry::is_session_actively_managed(&session.id);
    let label = crate::chat::run_status_label(running, session.last_run_status.as_ref());
    if running {
        label.to_string()
    } else if session.waiting_for_input {
        "waiting".to_string()
    } else if session.status_override.as_deref() == Some("review") {
        "review".to_string()
    } else {
        label.to_string()
    }
}

async fn serving_entries(app: &AppHandle) -> Vec<ServingEntry> {
    let all = match crate::chat::list_all_sessions(app.clone()).await {
        Ok(all) => all,
        Err(e) => {
            log::warn!("Graph serving: failed to list sessions: {e}");
            return Vec::new();
        }
    };
    let mut out = Vec::new();
    for entry in all.entries {
        for s in entry.sessions {
            if s.serves.is_empty() || s.archived_at.is_some() {
                continue;
            }
            out.push(ServingEntry {
                serves: s.serves.clone(),
                session: ServingSession {
                    session_id: s.id.clone(),
                    session_name: s.name.clone(),
                    project_id: entry.project_id.clone(),
                    worktree_id: entry.worktree_id.clone(),
                    worktree_name: entry.worktree_name.clone(),
                    status: session_status(&s),
                    agent_id: s.agent_id.clone(),
                },
            });
        }
    }
    out
}

fn other_graphs(app: &AppHandle, graph_id: &str) -> Vec<OtherGraph> {
    store::load_registry(app)
        .unwrap_or_default()
        .into_iter()
        .filter(|e| e.id != graph_id)
        .filter_map(|e| {
            let g = store::read_graph_file(Path::new(&e.path)).ok()?;
            Some(OtherGraph {
                id: e.id,
                title: g.title,
                nodes: g.nodes.iter().map(NodeFile::to_api).collect(),
            })
        })
        .collect()
}

// ============================================================================
// UI commands
// ============================================================================

pub async fn list_graphs(app: AppHandle) -> Result<Vec<GraphSummary>, String> {
    store::ensure_poller(&app);
    Ok(store::load_registry(&app)?
        .iter()
        .map(|e| summary_for(&app, e))
        .collect())
}

pub async fn get_graph(app: AppHandle, graph_id: String) -> Result<GraphDetail, String> {
    store::ensure_poller(&app);
    let entry = registry_entry(&app, &graph_id)?;
    let path = PathBuf::from(&entry.path);
    if !path.is_file() {
        return Err(format!("Graph file not found: {}", entry.path));
    }
    let graph = store::read_graph_file(&path)?;
    let nodes: Vec<GraphNode> = graph.nodes.iter().map(NodeFile::to_api).collect();
    let others = other_graphs(&app, &graph_id);
    let serving = serving_entries(&app).await;
    let d = derive::derive(&graph_id, &nodes, &others, &serving);
    Ok(GraphDetail {
        summary: build_summary(&app, &entry, Some(&graph), false, None),
        nodes,
        derived: d.derived,
        incoming: d.incoming,
        external: d.external,
        graph_serving: d.graph_serving,
    })
}

pub async fn get_graph_location_info(
    app: AppHandle,
    path: String,
) -> Result<GraphLocationInfo, String> {
    Ok(location::location_info(&app, &path))
}

fn register(app: &AppHandle, id: &str, path: &str) -> Result<RegistryEntry, String> {
    store::with_registry_mut(app, |entries| {
        if let Some(other) = entries.iter().find(|e| e.id == id && e.path != path) {
            if Path::new(&other.path).exists() {
                return Err(format!(
                    "A graph with id {id} is already registered at {}",
                    other.path
                ));
            }
        }
        // Same id (the file moved) or same path: replace the old entry.
        entries.retain(|e| e.id != id && e.path != path);
        let entry = RegistryEntry {
            id: id.to_string(),
            path: path.to_string(),
        };
        entries.push(entry.clone());
        Ok(entry)
    })
}

pub async fn create_graph(
    app: AppHandle,
    title: String,
    graph_type: String,
    path: String,
) -> Result<GraphSummary, String> {
    store::ensure_poller(&app);
    let file = Path::new(&path);
    if !file.is_absolute() {
        return Err("The graph path must be absolute".to_string());
    }
    if !matches!(
        file.extension().and_then(|e| e.to_str()),
        Some("yml") | Some("yaml")
    ) {
        return Err("The graph file must end in .yml".to_string());
    }
    if file.exists() {
        return Err(format!("{path} already exists"));
    }
    if title.trim().is_empty() {
        return Err("A graph needs a title".to_string());
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create folder: {e}"))?;
    }
    let graph = GraphFile {
        id: Uuid::new_v4().to_string(),
        title: title.trim().to_string(),
        graph_type: graph_type.trim().to_string(),
        nodes: Vec::new(),
        extra: Default::default(),
    };
    store::write_graph_file(file, &graph)?;
    let entry = register(&app, &graph.id, &path)?;
    emit_graphs_changed(&app, false);
    Ok(build_summary(&app, &entry, Some(&graph), false, None))
}

pub async fn open_graph_file(app: AppHandle, path: String) -> Result<GraphSummary, String> {
    store::ensure_poller(&app);
    let file = Path::new(&path);
    if !file.is_absolute() {
        return Err("The graph path must be absolute".to_string());
    }
    if !file.is_file() {
        return Err(format!("{path} does not exist"));
    }
    let graph = store::with_graph_file_mut(file, |g| {
        if g.id.trim().is_empty() {
            g.id = Uuid::new_v4().to_string();
        }
        Ok(g.clone())
    })?;
    let entry = register(&app, &graph.id, &path)?;
    emit_graphs_changed(&app, false);
    Ok(build_summary(&app, &entry, Some(&graph), false, None))
}

pub async fn remove_graph(app: AppHandle, graph_id: String) -> Result<(), String> {
    store::with_registry_mut(&app, |entries| {
        entries.retain(|e| e.id != graph_id);
        Ok(())
    })?;
    emit_graphs_changed(&app, false);
    Ok(())
}

pub async fn update_graph(
    app: AppHandle,
    graph_id: String,
    title: Option<String>,
    graph_type: Option<String>,
) -> Result<GraphSummary, String> {
    let (old, new) = store::with_graph_mut(&app, &graph_id, |g| {
        let old = (g.title.clone(), g.graph_type.clone());
        if let Some(t) = &title {
            if t.trim().is_empty() {
                return Err("A graph needs a title".to_string());
            }
            g.title = t.trim().to_string();
        }
        if let Some(t) = &graph_type {
            g.graph_type = t.trim().to_string();
        }
        Ok((old, (g.title.clone(), g.graph_type.clone())))
    })?;
    if old != new {
        let mut parts = Vec::new();
        if old.0 != new.0 {
            parts.push(format!("Renamed graph \"{}\" to \"{}\"", old.0, new.0));
        }
        if old.1 != new.1 {
            parts.push(format!("Type \"{}\" → \"{}\"", old.1, new.1));
        }
        append_change(
            &app,
            &new_change(
                &graph_id,
                None,
                &GraphActor::User,
                "graph.update",
                parts.join("; "),
                None,
                None,
                None,
            ),
        )?;
        emit_graphs_changed(&app, false);
    }
    let entry = registry_entry(&app, &graph_id)?;
    Ok(summary_for(&app, &entry))
}

pub async fn create_graph_node(
    app: AppHandle,
    graph_id: String,
    node: NewGraphNode,
    why: Option<String>,
) -> Result<GraphNode, String> {
    create_node(&app, &graph_id, node, &GraphActor::User, why)
}

pub async fn update_graph_node(
    app: AppHandle,
    graph_id: String,
    node_id: String,
    patch: GraphNodePatch,
    why: Option<String>,
) -> Result<GraphNode, String> {
    update_node(&app, &graph_id, &node_id, patch, &GraphActor::User, why)
}

pub async fn delete_graph_node(
    app: AppHandle,
    graph_id: String,
    node_id: String,
    why: Option<String>,
) -> Result<(), String> {
    delete_node(&app, &graph_id, &node_id, &GraphActor::User, why)
}

pub async fn list_graph_changes(
    app: AppHandle,
    graph_id: String,
) -> Result<Vec<GraphChange>, String> {
    changes::list_changes(&app, &graph_id)
}

pub async fn mark_graph_changes_seen(
    app: AppHandle,
    graph_id: String,
    change_ids: Option<Vec<String>>,
) -> Result<(), String> {
    changes::mark_seen(&app, &graph_id, change_ids)?;
    emit_graphs_changed(&app, false);
    Ok(())
}

pub async fn revert_graph_change(
    app: AppHandle,
    graph_id: String,
    change_id: String,
) -> Result<(), String> {
    changes::revert_change(&app, &graph_id, &change_id)?;
    emit_graphs_changed(&app, false);
    Ok(())
}

pub async fn list_graph_requests(
    app: AppHandle,
    graph_id: Option<String>,
) -> Result<Vec<GraphRequest>, String> {
    requests::list_requests(&app, graph_id.as_deref())
}

pub async fn answer_graph_request(
    app: AppHandle,
    graph_id: String,
    request_id: String,
    action: GraphRequestAction,
    answer: Option<String>,
) -> Result<GraphRequest, String> {
    requests::answer_request(&app, &graph_id, &request_id, action, answer).await
}

pub async fn commit_graph(
    app: AppHandle,
    graph_id: String,
    message: Option<String>,
) -> Result<String, String> {
    let path = store::graph_path(&app, &graph_id)?;
    let message = match message
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
    {
        Some(m) => m,
        None => {
            let title = store::read_graph_file(&path)?.title;
            format!("graph: update {title}")
        }
    };
    let sha = location::commit_file(&path, &message)?;
    emit_graphs_changed(&app, false);
    Ok(sha)
}

// ============================================================================
// Session metadata
// ============================================================================

fn emit_session_change(app: &AppHandle, worktree_id: &str) {
    emit_graphs_changed(app, true);
    crate::chat::emit_worktree_sessions_cache_invalidation(app, worktree_id);
}

pub async fn set_session_serves(
    app: AppHandle,
    session_id: String,
    serves: Vec<String>,
) -> Result<(), String> {
    let mut clean: Vec<String> = Vec::new();
    for s in serves {
        let s = s.trim().to_string();
        if !s.is_empty() && !clean.contains(&s) {
            clean.push(s);
        }
    }
    let worktree_id = crate::chat::storage::with_existing_metadata_mut(&app, &session_id, |m| {
        m.serves = clean;
        m.worktree_id.clone()
    })?;
    emit_session_change(&app, &worktree_id);
    Ok(())
}

pub async fn set_session_agent(
    app: AppHandle,
    session_id: String,
    agent_id: Option<String>,
    permission: Option<GraphPermission>,
) -> Result<(), String> {
    if let Some(id) = &agent_id {
        let agent = find_agent(&app, id).ok_or_else(|| format!("Unknown agent: {id}"))?;
        let level = parse_permission(&agent.permission)?;
        if permission.is_some_and(|p| p > level) {
            return Err(format!(
                "The permission cannot exceed the agent's level ({})",
                level.as_str()
            ));
        }
    }
    let worktree_id = crate::chat::storage::with_existing_metadata_mut(&app, &session_id, |m| {
        m.agent_id = agent_id;
        m.graph_permission = permission.map(|p| p.as_str().to_string());
        m.worktree_id.clone()
    })?;
    emit_session_change(&app, &worktree_id);
    Ok(())
}

pub async fn set_session_graph_permission(
    app: AppHandle,
    session_id: String,
    permission: GraphPermission,
) -> Result<(), String> {
    let worktree_id = crate::chat::storage::with_existing_metadata_mut(&app, &session_id, |m| {
        m.graph_permission = Some(permission.as_str().to_string());
        m.worktree_id.clone()
    })?;
    emit_session_change(&app, &worktree_id);
    Ok(())
}

/// System prompt parts for a session: the agent persona and a short graph
/// context (served nodes with refs and file, permission level, tools).
/// Empty when the session has no agent and serves nothing.
pub fn session_prompt_parts(app: &AppHandle, session_id: &str) -> Vec<String> {
    let Ok(Some(metadata)) = crate::chat::storage::load_metadata(app, session_id) else {
        return Vec::new();
    };
    let agent = metadata
        .agent_id
        .as_deref()
        .and_then(|id| find_agent(app, id));
    if agent.is_none() && metadata.serves.is_empty() {
        return Vec::new();
    }
    let mut parts = Vec::new();
    if let Some(agent) = &agent {
        let mut persona = format!("You act as the Splitkick agent \"{}\".", agent.name);
        if !agent.persona.trim().is_empty() {
            persona.push_str("\n\n");
            persona.push_str(agent.persona.trim());
        }
        parts.push(persona);
    }

    let mut lines = vec!["## Splitkick graph".to_string()];
    if metadata.serves.is_empty() {
        lines.push(
            "This session serves no graph node yet. Use list_graphs, then set_serves to point it at one."
                .to_string(),
        );
    } else {
        lines.push("This session serves:".to_string());
    }
    for r in &metadata.serves {
        let (graph_id, node_id) = match r.split_once('#') {
            Some((g, n)) => (g, Some(n)),
            None => (r.as_str(), None),
        };
        let graph = store::load_graph(app, graph_id).ok();
        let graph_title = graph
            .as_ref()
            .map(|g| g.title.clone())
            .unwrap_or_else(|| graph_id.to_string());
        let file = store::graph_path(app, graph_id)
            .map(|p| format!(", file {}", p.display()))
            .unwrap_or_default();
        let line = match node_id {
            Some(n) => match graph
                .as_ref()
                .and_then(|g| g.nodes.iter().find(|x| x.id == n))
            {
                Some(node) => format!(
                    "- node \"{}\" ({r}, {}) in graph \"{graph_title}\"{file}",
                    node.title,
                    node.state().as_str()
                ),
                None => format!("- node {r} in graph \"{graph_title}\"{file} (node not found)"),
            },
            None => format!("- the whole graph \"{graph_title}\" ({r}){file}"),
        };
        lines.push(line);
    }
    let permission = super::permissions::effective_permission(app, session_id);
    lines.push(format!(
        "Your graph permission is {}. read: list_graphs, read_graph. \
         write: also create_node, update_node, send_request, and set_node_state to proposed. \
         manage: also set_node_state to committed, done or dropped. \
         Without manage, ask for done with send_request kind accept-done.",
        permission.as_str()
    ));
    lines.push(
        "Use the Splitkick graph tools (read_graph, update_node, set_node_state, send_request) \
         to read and change the graph, not edits to the YAML file, so every change is logged. \
         Node refs are <graphId>#<nodeId>. Give a short why for every change."
            .to_string(),
    );
    parts.push(lines.join("\n"));
    parts
}
