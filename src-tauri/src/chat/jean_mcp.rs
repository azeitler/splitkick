//! Jean MCP server injection helper.
//!
//! Builds the `mcpServers.jean` entry and merges it into a CLI's MCP config
//! so that spawned Claude/Cursor processes can call back into the running
//! Jean app over HTTP at `/mcp`.

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use crate::http_server::server::HttpServerHandle;

/// Env var carrying the recursive depth from parent CLI to child CLI.
/// Each Jean-spawned CLI bumps this by 1. Used to cap runaway recursion.
pub const JEAN_MCP_DEPTH_ENV: &str = "JEAN_MCP_DEPTH";

/// Current process's Jean MCP recursion depth (0 if not spawned by another Jean CLI).
pub fn current_depth() -> u32 {
    std::env::var(JEAN_MCP_DEPTH_ENV)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

/// Depth to set on a child CLI being spawned from the current process.
pub fn next_depth() -> u32 {
    current_depth().saturating_add(1)
}

/// Build the `{"jean": {...}}` MCP server entry for injection.
/// Returns None when the pref is off, the HTTP server isn't running,
/// or required state is unavailable.
pub async fn build_jean_mcp_entry(app: &AppHandle, session_id: &str) -> Option<Value> {
    let prefs = crate::load_preferences(app.clone()).await.ok()?;
    if !prefs.jean_mcp_enabled {
        return None;
    }

    let handle_state = app.try_state::<Arc<Mutex<Option<HttpServerHandle>>>>()?;
    let guard = handle_state.lock().await;
    let handle = guard.as_ref()?;

    let depth = next_depth();
    let url = format!("http://127.0.0.1:{}/mcp", handle.port);

    let mut headers = serde_json::Map::new();
    if handle.token_required && !handle.token.is_empty() {
        headers.insert(
            "Authorization".to_string(),
            Value::String(format!("Bearer {}", handle.token)),
        );
    }
    headers.insert(
        "X-Jean-Session".to_string(),
        Value::String(session_id.to_string()),
    );
    headers.insert(
        "X-Jean-Mcp-Depth".to_string(),
        Value::String(depth.to_string()),
    );

    Some(json!({
        "jean": {
            "type": "http",
            "url": url,
            "headers": headers,
        }
    }))
}

/// Merge the Jean MCP entry into an existing `--mcp-config` JSON string.
///
/// Accepts the user's existing config (as a JSON string) — may be None or empty.
/// Returns Some(new_json_string) when injection happened, or None when the
/// pref is off / server isn't running, in which case the caller should keep
/// the existing config unchanged.
pub async fn merge_into_mcp_config(
    app: &AppHandle,
    session_id: &str,
    existing: Option<&str>,
) -> Option<String> {
    let entry = build_jean_mcp_entry(app, session_id).await?;
    let entry_obj = entry.as_object()?.clone();

    let mut config: Value = match existing {
        Some(s) if !s.trim().is_empty() => {
            serde_json::from_str(s).unwrap_or_else(|_| json!({ "mcpServers": {} }))
        }
        _ => json!({ "mcpServers": {} }),
    };

    let mcp_servers = config
        .as_object_mut()
        .and_then(|root| {
            if !root.contains_key("mcpServers") {
                root.insert(
                    "mcpServers".to_string(),
                    Value::Object(serde_json::Map::new()),
                );
            }
            root.get_mut("mcpServers")
        })
        .and_then(|v| v.as_object_mut())?;

    for (k, v) in entry_obj {
        mcp_servers.insert(k, v);
    }

    serde_json::to_string(&config).ok()
}

/// Return the env var pair (key, value) to set on a spawned child process so
/// it knows its Jean MCP recursion depth. Always set when Jean MCP is enabled
/// so the depth chain stays accurate even when the child doesn't itself spawn.
pub fn child_depth_env() -> (String, String) {
    (JEAN_MCP_DEPTH_ENV.to_string(), next_depth().to_string())
}
