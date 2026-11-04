//! Requests from agents to the user (`requests/<graph-id>.json`).

use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;
use uuid::Uuid;

use super::changes::{append_change, new_change};
use super::model::{
    GraphActor, GraphAttachment, GraphRequest, GraphRequestAction, GraphRequestKind,
    GraphRequestStatus, NodeState,
};
use super::store::{self, graphs_dir, read_json, safe_name, write_json, APP_DATA_LOCK};

fn requests_path(app: &AppHandle, graph_id: &str) -> Result<PathBuf, String> {
    let dir = graphs_dir(app)?.join("requests");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create requests dir: {e}"))?;
    Ok(dir.join(format!("{}.json", safe_name(graph_id))))
}

fn load(app: &AppHandle, graph_id: &str) -> Result<Vec<GraphRequest>, String> {
    let _guard = APP_DATA_LOCK.lock().unwrap();
    read_json(&requests_path(app, graph_id)?)
}

fn with_requests_mut<T>(
    app: &AppHandle,
    graph_id: &str,
    f: impl FnOnce(&mut Vec<GraphRequest>) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = APP_DATA_LOCK.lock().unwrap();
    let path = requests_path(app, graph_id)?;
    let mut list: Vec<GraphRequest> = read_json(&path)?;
    let result = f(&mut list)?;
    write_json(&path, &list)?;
    Ok(result)
}

/// Requests of one graph, or of every registered graph; newest first.
pub fn list_requests(app: &AppHandle, graph_id: Option<&str>) -> Result<Vec<GraphRequest>, String> {
    let ids: Vec<String> = match graph_id {
        Some(id) => vec![id.to_string()],
        None => store::load_registry(app)?
            .into_iter()
            .map(|e| e.id)
            .collect(),
    };
    let mut all = Vec::new();
    for id in ids {
        all.extend(load(app, &id)?);
    }
    all.sort_by_key(|r| std::cmp::Reverse(r.created_at));
    Ok(all)
}

pub fn open_count(app: &AppHandle, graph_id: &str) -> usize {
    load(app, graph_id)
        .map(|l| {
            l.iter()
                .filter(|r| r.status == GraphRequestStatus::Open)
                .count()
        })
        .unwrap_or(0)
}

/// Create a request (MCP `send_request`). The node must exist.
#[allow(clippy::too_many_arguments)]
pub fn create_request(
    app: &AppHandle,
    graph_id: &str,
    node_id: &str,
    kind: GraphRequestKind,
    title: String,
    body: Option<String>,
    evidence: Vec<String>,
    options: Vec<String>,
    blocker: Option<String>,
    actor: &GraphActor,
) -> Result<GraphRequest, String> {
    if title.trim().is_empty() {
        return Err("A request needs a title".to_string());
    }
    let graph = store::load_graph(app, graph_id)?;
    if !graph.nodes.iter().any(|n| n.id == node_id) {
        return Err(format!("Unknown node: {node_id}"));
    }
    let request = GraphRequest {
        id: Uuid::new_v4().to_string(),
        graph_id: graph_id.to_string(),
        node_id: node_id.to_string(),
        kind,
        title,
        body: body.unwrap_or_default(),
        evidence,
        options,
        blocker: blocker.filter(|b| !b.trim().is_empty()),
        from_session_id: actor.session_id().map(str::to_string),
        from_session_name: actor.session_name().map(str::to_string),
        agent_id: actor.agent_id().map(str::to_string),
        created_at: store::now_ms(),
        status: GraphRequestStatus::Open,
        answer: None,
        answered_at: None,
    };
    with_requests_mut(app, graph_id, |list| {
        list.push(request.clone());
        Ok(())
    })?;
    store::emit_graphs_changed(app, false);
    Ok(request)
}

/// Answer an open request as the user. See the contract for the semantics.
pub async fn answer_request(
    app: &AppHandle,
    graph_id: &str,
    request_id: &str,
    action: GraphRequestAction,
    answer: Option<String>,
) -> Result<GraphRequest, String> {
    let request = load(app, graph_id)?
        .into_iter()
        .find(|r| r.id == request_id)
        .ok_or_else(|| format!("Unknown request: {request_id}"))?;
    if request.status != GraphRequestStatus::Open {
        return Err("This request was already answered".to_string());
    }
    let answer = answer
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty());
    let user = GraphActor::User;

    let status = match (action, request.kind) {
        (GraphRequestAction::Accept, GraphRequestKind::AcceptDone) => {
            super::commands::mutate_node(
                app,
                graph_id,
                &request.node_id,
                &user,
                answer.clone(),
                Some("request.answer"),
                |n| n.state = NodeState::Done,
            )?;
            GraphRequestStatus::Accepted
        }
        (GraphRequestAction::SendBack, _) => {
            let node = store::load_graph(app, graph_id)?
                .nodes
                .iter()
                .find(|n| n.id == request.node_id)
                .map(|n| n.title.clone())
                .unwrap_or_default();
            append_change(
                app,
                &new_change(
                    graph_id,
                    Some(&request.node_id),
                    &user,
                    "request.answer",
                    format!("Sent back \"{}\" ({node})", request.title),
                    answer.clone(),
                    None,
                    None,
                ),
            )?;
            let text = match &answer {
                Some(a) => format!("Graph request \"{}\" was sent back: {a}", request.title),
                None => format!("Graph request \"{}\" was sent back.", request.title),
            };
            add_follow_up(app, request.from_session_id.as_deref(), text).await;
            GraphRequestStatus::SentBack
        }
        (GraphRequestAction::Answer, GraphRequestKind::Decision) => {
            let a = answer
                .clone()
                .ok_or_else(|| "An answer is required".to_string())?;
            let question = request.blocker.clone().unwrap_or(request.title.clone());
            super::commands::mutate_node(
                app,
                graph_id,
                &request.node_id,
                &user,
                None,
                Some("request.answer"),
                |n| {
                    if let Some(blocker) = &request.blocker {
                        n.relations.retain(|r| {
                            !(r.kind == super::model::RelationKind::BlockedBy
                                && &r.target == blocker)
                        });
                    }
                    n.attachments.push(GraphAttachment {
                        kind: "note".to_string(),
                        value: format!("Decision: {question} → {a}"),
                    });
                },
            )?;
            add_follow_up(
                app,
                request.from_session_id.as_deref(),
                format!("Decision \"{question}\": {a}"),
            )
            .await;
            GraphRequestStatus::Answered
        }
        _ => return Err("This action does not fit the request kind".to_string()),
    };

    let updated = with_requests_mut(app, graph_id, |list| {
        let r = list
            .iter_mut()
            .find(|r| r.id == request_id)
            .ok_or_else(|| format!("Unknown request: {request_id}"))?;
        r.status = status;
        r.answer = answer;
        r.answered_at = Some(store::now_ms());
        Ok(r.clone())
    })?;
    store::emit_graphs_changed(app, false);
    Ok(updated)
}

/// Add a follow-up note to the requesting session. Never fails the answer.
async fn add_follow_up(app: &AppHandle, session_id: Option<&str>, text: String) {
    let Some(session_id) = session_id else {
        return;
    };
    let worktree_id = match crate::chat::storage::load_metadata(app, session_id) {
        Ok(Some(m)) => m.worktree_id,
        _ => return,
    };
    if let Err(e) = crate::chat::edit_session_follow_ups(
        app.clone(),
        worktree_id,
        String::new(),
        session_id.to_string(),
        crate::chat::follow_ups::FollowUpOp::Add { text },
    )
    .await
    {
        log::warn!("Failed to add graph follow-up to session {session_id}: {e}");
    }
}
