//! Jean MCP server endpoint.
//!
//! Speaks the Streamable-HTTP variant of the Model Context Protocol so that
//! Claude / Cursor / Codex / OpenCode CLIs spawned by Jean can call back into
//! the running app and orchestrate Jean-level operations (list projects,
//! create worktrees, start sessions, send chat messages, etc.).
//!
//! The endpoint is mounted at `POST /mcp` on the existing Axum HTTP server
//! (see `server.rs`). Authentication uses the same bearer token as the rest
//! of the HTTP API. Tool calls are translated to `dispatch_command` calls
//! against existing handlers — no business logic lives here.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::auth;
use super::dispatch::dispatch_command;
use super::server::AppState;

/// MCP protocol version we advertise. Matches the 2024-11-05 spec.
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// Rate-limit window for session-spawning tools.
const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);

/// Tools that count against the rate limit (anything that can spawn or fan-out).
const RATE_LIMITED_TOOLS: &[&str] = &["create_session", "send_chat_message", "create_worktree"];

/// Per-source rate-limit buckets. Key = X-Jean-Session header (or "anon").
static RATE_BUCKETS: Lazy<Mutex<HashMap<String, VecDeque<Instant>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// ============================================================================
// Public entry point
// ============================================================================

pub(super) async fn mcp_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Response {
    // Auth: token is mandatory whenever the bind is non-loopback, otherwise
    // honor the user's `token_required` preference.
    let needs_token = state.token_required || !state.localhost_only;
    if needs_token {
        let provided = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "))
            .unwrap_or("");
        if !auth::validate_token(provided, &state.token) {
            return jsonrpc_error(body.get("id").cloned(), -32001, "Unauthorized").into_response();
        }
    }

    let id = body.get("id").cloned();
    let method = body
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let params = body.get("params").cloned().unwrap_or(Value::Null);

    match method.as_str() {
        "initialize" => jsonrpc_ok(id, initialize_result()).into_response(),
        "notifications/initialized" => StatusCode::NO_CONTENT.into_response(),
        "tools/list" => jsonrpc_ok(id, tools_list_result()).into_response(),
        "tools/call" => match call_tool(&state, &headers, params).await {
            Ok(result) => jsonrpc_ok(id, result).into_response(),
            Err(e) => jsonrpc_error(id, e.code, &e.message).into_response(),
        },
        // Capability negotiation no-ops we silently accept.
        "ping" => jsonrpc_ok(id, json!({})).into_response(),
        _ => jsonrpc_error(id, -32601, &format!("Method not found: {method}")).into_response(),
    }
}

// ============================================================================
// MCP method results
// ============================================================================

fn initialize_result() -> Value {
    json!({
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "capabilities": { "tools": {} },
        "serverInfo": {
            "name": "jean",
            "version": env!("CARGO_PKG_VERSION"),
        },
    })
}

fn tools_list_result() -> Value {
    json!({ "tools": tool_registry() })
}

fn tool_registry() -> Value {
    json!([
        {
            "name": "list_projects",
            "description": "List all Jean projects (id, name, path, default_branch).",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "list_worktrees",
            "description": "List all worktrees for a project.",
            "inputSchema": {
                "type": "object",
                "properties": { "projectId": {"type": "string"} },
                "required": ["projectId"],
                "additionalProperties": false
            }
        },
        {
            "name": "get_worktree",
            "description": "Get a single worktree by id (path, branch, status, etc.).",
            "inputSchema": {
                "type": "object",
                "properties": { "worktreeId": {"type": "string"} },
                "required": ["worktreeId"],
                "additionalProperties": false
            }
        },
        {
            "name": "list_github_issues",
            "description": "List GitHub issues for a project. Pass projectId; the server resolves the repo path.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "state": {"type": "string", "enum": ["open", "closed", "all"], "default": "open"}
                },
                "required": ["projectId"],
                "additionalProperties": false
            }
        },
        {
            "name": "create_worktree",
            "description": "Create a new worktree for a project. If issueNumber is provided, the issue body is fetched and packed into the worktree's issue context so the spawned session knows what to investigate.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "baseBranch": {"type": "string"},
                    "customName": {"type": "string"},
                    "issueNumber": {"type": "integer", "minimum": 1}
                },
                "required": ["projectId"],
                "additionalProperties": false
            }
        },
        {
            "name": "create_session",
            "description": "Create a new chat session in an existing worktree. Returns the session id needed for send_chat_message.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "worktreeId": {"type": "string"},
                    "name": {"type": "string"},
                    "backend": {"type": "string", "enum": ["claude", "codex", "cursor", "opencode"]}
                },
                "required": ["worktreeId"],
                "additionalProperties": false
            }
        },
        {
            "name": "send_chat_message",
            "description": "Send a message to an existing session. Fire-and-forget: returns immediately as the session begins processing. Use this to kick off investigations.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string"},
                    "message": {"type": "string"},
                    "model": {"type": "string"},
                    "executionMode": {"type": "string", "enum": ["plan", "build", "yolo"]}
                },
                "required": ["sessionId", "message"],
                "additionalProperties": false
            }
        },
        {
            "name": "read_session_messages",
            "description": "Read recent messages from a session (most recent first). Use limit to cap returned messages.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50}
                },
                "required": ["sessionId"],
                "additionalProperties": false
            }
        },
        {
            "name": "get_current_context",
            "description": "Return the calling session's context: sessionId, worktreeId, projectId, projectPath, projectName. Use this so Claude knows what 'this project' refers to without guessing.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }
    ])
}

// ============================================================================
// Tool dispatch
// ============================================================================

struct ToolError {
    code: i32,
    message: String,
}

impl ToolError {
    fn invalid_params(msg: impl Into<String>) -> Self {
        ToolError {
            code: -32602,
            message: msg.into(),
        }
    }
    fn internal(msg: impl Into<String>) -> Self {
        ToolError {
            code: -32000,
            message: msg.into(),
        }
    }
}

async fn call_tool(
    state: &AppState,
    headers: &HeaderMap,
    params: Value,
) -> Result<Value, ToolError> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ToolError::invalid_params("missing 'name'"))?
        .to_string();
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let prefs = crate::load_preferences(state.app.clone())
        .await
        .map_err(ToolError::internal)?;
    if !prefs.jean_mcp_enabled {
        return Err(ToolError::internal(
            "Jean MCP server is disabled. Enable it in Preferences > MCP Servers.",
        ));
    }

    // Recursion depth + rate limit guard (only for spawning tools).
    let depth = headers
        .get("x-jean-mcp-depth")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    let source = headers
        .get("x-jean-session")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("anon")
        .to_string();

    if RATE_LIMITED_TOOLS.contains(&name.as_str()) {
        if depth > prefs.jean_mcp_max_depth {
            return Err(ToolError::internal(format!(
                "Jean MCP recursion depth {depth} exceeds limit {}",
                prefs.jean_mcp_max_depth
            )));
        }
        if !rate_check(&source, prefs.jean_mcp_rate_limit_per_minute) {
            return Err(ToolError::internal(format!(
                "Jean MCP rate limit exceeded ({} calls/min for source {source})",
                prefs.jean_mcp_rate_limit_per_minute
            )));
        }
    }

    let result_json = run_tool(&state.app, &name, arguments, &source).await?;

    Ok(json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result_json).unwrap_or_else(|_| "null".to_string()),
        }],
        "isError": false,
    }))
}

async fn run_tool(
    app: &AppHandle,
    name: &str,
    args: Value,
    source: &str,
) -> Result<Value, ToolError> {
    match name {
        "list_projects" => dispatch_command(app, "list_projects", json!({}))
            .await
            .map_err(ToolError::internal),

        "list_worktrees" => {
            let project_id = require_str(&args, "projectId")?;
            dispatch_command(app, "list_worktrees", json!({ "projectId": project_id }))
                .await
                .map_err(ToolError::internal)
        }

        "get_worktree" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            dispatch_command(app, "get_worktree", json!({ "worktreeId": worktree_id }))
                .await
                .map_err(ToolError::internal)
        }

        "list_github_issues" => {
            let project_id = require_str(&args, "projectId")?;
            let state = args.get("state").and_then(|v| v.as_str()).unwrap_or("open");
            let project_path = resolve_project_path(app, &project_id)?;
            dispatch_command(
                app,
                "list_github_issues",
                json!({ "projectPath": project_path, "state": state }),
            )
            .await
            .map_err(ToolError::internal)
        }

        "create_worktree" => {
            let project_id = require_str(&args, "projectId")?;
            let mut payload = serde_json::Map::new();
            payload.insert("projectId".to_string(), Value::String(project_id.clone()));

            if let Some(base) = args.get("baseBranch").and_then(|v| v.as_str()) {
                payload.insert("baseBranch".to_string(), Value::String(base.to_string()));
            }
            if let Some(name) = args.get("customName").and_then(|v| v.as_str()) {
                payload.insert("customName".to_string(), Value::String(name.to_string()));
            }

            // If an issue number is provided, fetch the issue body and pack it
            // into IssueContext so the worktree's auto-prompt has the context.
            if let Some(issue_number) = args.get("issueNumber").and_then(|v| v.as_u64()) {
                let project_path = resolve_project_path(app, &project_id)?;
                let detail = dispatch_command(
                    app,
                    "get_github_issue",
                    json!({ "projectPath": project_path, "issueNumber": issue_number }),
                )
                .await
                .map_err(ToolError::internal)?;

                let context = json!({
                    "number": detail.get("number").cloned().unwrap_or(json!(issue_number)),
                    "title": detail.get("title").cloned().unwrap_or(Value::Null),
                    "body": detail.get("body").cloned().unwrap_or(Value::Null),
                    "comments": detail.get("comments").cloned().unwrap_or(json!([])),
                });
                payload.insert("issueContext".to_string(), context);
            }

            dispatch_command(app, "create_worktree", Value::Object(payload))
                .await
                .map_err(ToolError::internal)
        }

        "create_session" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let worktree_path = resolve_worktree_path(app, &worktree_id)?;
            let mut payload = serde_json::Map::new();
            payload.insert("worktreeId".to_string(), Value::String(worktree_id));
            payload.insert("worktreePath".to_string(), Value::String(worktree_path));
            if let Some(n) = args.get("name").and_then(|v| v.as_str()) {
                payload.insert("name".to_string(), Value::String(n.to_string()));
            }
            if let Some(b) = args.get("backend").and_then(|v| v.as_str()) {
                payload.insert("backend".to_string(), Value::String(b.to_string()));
            }
            dispatch_command(app, "create_session", Value::Object(payload))
                .await
                .map_err(ToolError::internal)
        }

        "send_chat_message" => {
            let session_id = require_str(&args, "sessionId")?;
            let message = require_str(&args, "message")?;
            let (worktree_id, worktree_path) = resolve_session_worktree(app, &session_id)?;

            let mut payload = serde_json::Map::new();
            payload.insert("sessionId".to_string(), Value::String(session_id.clone()));
            payload.insert("worktreeId".to_string(), Value::String(worktree_id));
            payload.insert("worktreePath".to_string(), Value::String(worktree_path));
            payload.insert("message".to_string(), Value::String(message));
            if let Some(m) = args.get("model").and_then(|v| v.as_str()) {
                payload.insert("model".to_string(), Value::String(m.to_string()));
            }
            if let Some(em) = args.get("executionMode").and_then(|v| v.as_str()) {
                payload.insert("executionMode".to_string(), Value::String(em.to_string()));
            }

            // Fire-and-forget: spawn the dispatch on a background task and
            // return immediately. Errors are logged but not surfaced (the
            // caller will see them in the chat stream).
            let app_clone = app.clone();
            let payload_clone = Value::Object(payload);
            let source_clone = source.to_string();
            tokio::spawn(async move {
                if let Err(e) =
                    dispatch_command(&app_clone, "send_chat_message", payload_clone).await
                {
                    log::warn!("Jean MCP send_chat_message (source={source_clone}) failed: {e}");
                }
            });

            Ok(json!({
                "sessionId": session_id,
                "status": "started",
            }))
        }

        "read_session_messages" => {
            let session_id = require_str(&args, "sessionId")?;
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(50)
                .min(200) as usize;
            let (worktree_id, worktree_path) = resolve_session_worktree(app, &session_id)?;
            dispatch_command(
                app,
                "get_session",
                json!({
                    "sessionId": session_id,
                    "worktreeId": worktree_id,
                    "worktreePath": worktree_path,
                    "limit": limit,
                }),
            )
            .await
            .map_err(ToolError::internal)
        }

        "get_current_context" => {
            if source == "anon" {
                return Err(ToolError::internal(
                    "No X-Jean-Session header present. This tool only works for sessions spawned by Jean.",
                ));
            }
            let (worktree_id, worktree_path) = resolve_session_worktree(app, source)?;
            let (project_id, project_name, project_path) =
                resolve_worktree_project(app, &worktree_id)?;
            Ok(json!({
                "sessionId": source,
                "worktreeId": worktree_id,
                "worktreePath": worktree_path,
                "projectId": project_id,
                "projectName": project_name,
                "projectPath": project_path,
            }))
        }

        other => Err(ToolError::invalid_params(format!("Unknown tool: {other}"))),
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn require_str(args: &Value, key: &str) -> Result<String, ToolError> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ToolError::invalid_params(format!("missing or non-string '{key}'")))
}

fn resolve_project_path(app: &AppHandle, project_id: &str) -> Result<String, ToolError> {
    let data = crate::projects::storage::load_projects_data(app)
        .map_err(|e| ToolError::internal(format!("load_projects_data: {e}")))?;
    data.find_project(project_id)
        .map(|p| p.path.clone())
        .ok_or_else(|| ToolError::invalid_params(format!("Unknown projectId: {project_id}")))
}

fn resolve_worktree_path(app: &AppHandle, worktree_id: &str) -> Result<String, ToolError> {
    let data = crate::projects::storage::load_projects_data(app)
        .map_err(|e| ToolError::internal(format!("load_projects_data: {e}")))?;
    data.find_worktree(worktree_id)
        .map(|w| w.path.clone())
        .ok_or_else(|| ToolError::invalid_params(format!("Unknown worktreeId: {worktree_id}")))
}

fn resolve_worktree_project(
    app: &AppHandle,
    worktree_id: &str,
) -> Result<(String, String, String), ToolError> {
    let data = crate::projects::storage::load_projects_data(app)
        .map_err(|e| ToolError::internal(format!("load_projects_data: {e}")))?;
    let wt = data
        .find_worktree(worktree_id)
        .ok_or_else(|| ToolError::invalid_params(format!("Unknown worktreeId: {worktree_id}")))?;
    let project = data.find_project(&wt.project_id).ok_or_else(|| {
        ToolError::internal(format!("Worktree {worktree_id} has no parent project"))
    })?;
    Ok((
        project.id.clone(),
        project.name.clone(),
        project.path.clone(),
    ))
}

fn resolve_session_worktree(
    app: &AppHandle,
    session_id: &str,
) -> Result<(String, String), ToolError> {
    let metadata = crate::chat::storage::load_metadata(app, session_id)
        .map_err(|e| ToolError::internal(format!("load_metadata: {e}")))?
        .ok_or_else(|| ToolError::invalid_params(format!("Unknown sessionId: {session_id}")))?;
    let worktree_path = resolve_worktree_path(app, &metadata.worktree_id)?;
    Ok((metadata.worktree_id, worktree_path))
}

fn rate_check(source: &str, limit_per_minute: u32) -> bool {
    if limit_per_minute == 0 {
        return true; // Disabled
    }
    let now = Instant::now();
    let mut buckets = match RATE_BUCKETS.lock() {
        Ok(b) => b,
        Err(p) => p.into_inner(),
    };
    let bucket = buckets.entry(source.to_string()).or_default();
    while let Some(t) = bucket.front() {
        if now.duration_since(*t) > RATE_LIMIT_WINDOW {
            bucket.pop_front();
        } else {
            break;
        }
    }
    if bucket.len() as u32 >= limit_per_minute {
        return false;
    }
    bucket.push_back(now);
    true
}

// ============================================================================
// JSON-RPC envelope helpers
// ============================================================================

fn jsonrpc_ok(id: Option<Value>, result: Value) -> Json<Value> {
    Json(json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "result": result,
    }))
}

fn jsonrpc_error(id: Option<Value>, code: i32, message: &str) -> Json<Value> {
    Json(json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": { "code": code, "message": message },
    }))
}
