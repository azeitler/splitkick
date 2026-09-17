//! Jean MCP runtime helper.
//!
//! Builds the `mcpServers.jean` entry and merges it into a CLI's MCP config
//! for callers that explicitly opt into runtime config assembly. Normal Jean
//! CLI sessions use the persistent config writers in `jean_mcp_config` so the
//! server is visible to users. The stdio helper proxies over a Jean-owned local
//! local IPC; no HTTP listener/port is required.

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::jean_mcp_core::{
    next_depth, JEAN_MCP_DEPTH_ENV, JEAN_MCP_DIALOG_ARG, JEAN_MCP_SESSION_ENV, JEAN_MCP_SOCKET_ENV,
    JEAN_MCP_STDIO_ARG, JEAN_MCP_TOKEN_ENV, PERMISSION_PROMPT_TOOL,
};

/// Build the `{"jean": {...}}` MCP server entry for injection.
/// Returns None when the pref is off or the stdio socket isn't running.
pub async fn build_jean_mcp_entry(app: &AppHandle, session_id: &str) -> Option<Value> {
    let prefs = crate::load_preferences(app.clone()).await.ok()?;
    if !prefs.jean_mcp_enabled {
        return None;
    }

    let (running, socket_path, token) =
        crate::jean_mcp_socket::get_socket_status(app.clone()).await;
    if !running {
        return None;
    }

    let command = crate::jean_mcp_config::get_stable_launcher_command();
    let depth = next_depth().to_string();
    let socket_path = socket_path?;
    let token = token?;

    let server_name = crate::jean_mcp_config::current_mode().server_name();

    Some(json!({
        server_name.to_string(): {
            "type": "stdio",
            "command": command,
            "args": [JEAN_MCP_STDIO_ARG],
            "env": {
                JEAN_MCP_SOCKET_ENV: socket_path,
                JEAN_MCP_TOKEN_ENV: token,
                JEAN_MCP_SESSION_ENV: session_id,
                JEAN_MCP_DEPTH_ENV: depth,
            }
        }
    }))
}

/// MCP server name for the internal dialog server.
///
/// Distinct from the user-facing `jean` server so `jean_mcp_enabled` keeps
/// meaning exactly what it means today, and so the model's tool list does not
/// grow by ~40 tools for users who turned the Jean server off.
pub const JEAN_DIALOG_SERVER: &str = "jean-dialog";

/// Per-server MCP tool-call timeout for the dialog server, in milliseconds.
///
/// This is the hard bound on how long a question may park. It also raises the
/// CLI's idle-abort threshold, which is why the dialog path needs no progress
/// notifications: without an explicit `timeout` the CLI aborts a silent MCP
/// call and the question dies before anyone can answer it.
const DIALOG_TOOL_TIMEOUT_MS: u64 = 30 * 60 * 1000;

/// Fully-qualified tool name for `--permission-prompt-tool`.
pub fn dialog_permission_prompt_tool() -> String {
    format!("mcp__{JEAN_DIALOG_SERVER}__{PERMISSION_PROMPT_TOOL}")
}

/// Build the `{"jean-dialog": {...}}` MCP entry that restores Claude's
/// `AskUserQuestion` / `EnterPlanMode` / `ExitPlanMode` tools.
///
/// Deliberately does **not** consult `jean_mcp_enabled`: pointing
/// `--permission-prompt-tool` at a tool that cannot be resolved kills the run
/// with `exit=1` at the first permission check, so a user disabling the
/// user-facing Jean MCP server must not take Claude's chat down with it.
/// Returns None only when the socket is unavailable, in which case the caller
/// must also omit the flag.
pub async fn build_jean_dialog_mcp_entry(app: &AppHandle, session_id: &str) -> Option<Value> {
    let (running, socket_path, token) =
        crate::jean_mcp_socket::get_socket_status(app.clone()).await;
    if !running {
        return None;
    }

    let command = crate::jean_mcp_config::get_stable_launcher_command();
    let socket_path = socket_path?;
    let token = token?;

    Some(json!({
        JEAN_DIALOG_SERVER: {
            "type": "stdio",
            "command": command,
            "args": [JEAN_MCP_STDIO_ARG, JEAN_MCP_DIALOG_ARG],
            "timeout": DIALOG_TOOL_TIMEOUT_MS,
            "env": {
                JEAN_MCP_SOCKET_ENV: socket_path,
                JEAN_MCP_TOKEN_ENV: token,
                JEAN_MCP_SESSION_ENV: session_id,
                // Depth is meaningless for the dialog server (it cannot start
                // nested Jean work), but the shim reads it unconditionally.
                JEAN_MCP_DEPTH_ENV: "0",
            }
        }
    }))
}

/// Merge the Jean MCP entry into an existing `--mcp-config` JSON string.
pub async fn merge_into_mcp_config(
    app: &AppHandle,
    session_id: &str,
    existing: Option<&str>,
) -> Option<String> {
    let entry = build_jean_mcp_entry(app, session_id).await?;
    merge_entry_into_mcp_config(entry, existing)
}

/// Merge the dialog entry into an existing `--mcp-config` JSON string.
pub async fn merge_dialog_into_mcp_config(
    app: &AppHandle,
    session_id: &str,
    existing: Option<&str>,
) -> Option<String> {
    let entry = build_jean_dialog_mcp_entry(app, session_id).await?;
    merge_entry_into_mcp_config(entry, existing)
}

fn merge_entry_into_mcp_config(entry: Value, existing: Option<&str>) -> Option<String> {
    let entry_obj = entry.as_object()?.clone();

    let mut config: Value = match existing {
        Some(s) if !s.trim().is_empty() => match serde_json::from_str(s) {
            Ok(value) => value,
            Err(e) => {
                let preview: String = s.chars().take(200).collect();
                log::warn!(
                    "Jean MCP: failed to parse existing --mcp-config JSON ({e}); \
                     replacing with a fresh config that only contains the Jean entry. \
                     Preview: {preview:?}"
                );
                json!({ "mcpServers": {} })
            }
        },
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
/// it knows its Jean MCP recursion depth.
pub fn child_depth_env() -> (String, String) {
    (JEAN_MCP_DEPTH_ENV.to_string(), next_depth().to_string())
}
