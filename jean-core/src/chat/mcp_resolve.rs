//! The per-turn MCP config for sends that do not bring their own (#103).
//!
//! The UI builds `mcpConfig` in `src/services/mcp.ts`
//! (`resolveEnabledMcpServers` + `buildMcpConfigJson`). Sends that start in the
//! backend — the Splitkick MCP tool `send_chat_message`, schedules, queued
//! messages, auto-fix — have no UI to do that. Without a config, Claude gets
//! only Splitkick's own servers plus `--strict-mcp-config`, so the user's
//! servers (Playwright, …) are gone for that turn.
//!
//! This module is the same cascade in Rust: session override → project →
//! global defaults, then auto-enable servers never seen before. Both sides are
//! tested against `src/services/mcp-resolution-cases.json`, so they cannot
//! drift apart silently.

use std::collections::HashSet;

use serde_json::{Map, Value};
use tauri::AppHandle;

use super::McpServerInfo;

/// `backend:name`, the key the UI stores in the enabled/known lists.
fn mcp_key(backend: &str, name: &str) -> String {
    format!("{backend}:{name}")
}

/// Splits a key into `(backend, name)`. A legacy bare name has no backend.
fn parse_mcp_key(key: &str) -> (&str, &str) {
    key.split_once(':').unwrap_or(("", key))
}

/// Mirror of `resolveEnabledMcpServers` in `src/services/mcp.ts`.
///
/// `session` is the session override: `Some` (also an empty list) wins and
/// turns auto-enable off. `project` `None` means "inherit the global list".
pub fn resolve_enabled_mcp_servers(
    available: &[McpServerInfo],
    session: Option<&[String]>,
    project: Option<&[String]>,
    global: &[String],
    known: &[String],
) -> Vec<String> {
    let base: &[String] = session.or(project).unwrap_or(global);

    // Antigravity always loads every enabled server from its own config.
    let mut enabled: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    let antigravity = available
        .iter()
        .filter(|s| s.backend == "antigravity" && !s.disabled)
        .map(|s| mcp_key("antigravity", &s.name));
    for key in base.iter().cloned().chain(antigravity) {
        if seen.insert(key.clone()) {
            enabled.push(key);
        }
    }

    if session.is_some() {
        return enabled;
    }

    // Auto-enable servers that are new: not disabled, not on, never seen.
    let known: HashSet<&str> = known.iter().map(String::as_str).collect();
    let new_keys: Vec<String> = available
        .iter()
        .filter(|s| !s.disabled)
        .map(|s| mcp_key(&s.backend, &s.name))
        .filter(|key| !seen.contains(key) && !known.contains(key.as_str()))
        .collect();
    enabled.extend(new_keys);
    enabled
}

/// Mirror of `buildMcpConfigJson` in `src/services/mcp.ts`: the
/// `{"mcpServers":{…}}` JSON for `backend`, or `None` when nothing is on.
pub fn build_mcp_config_json(
    available: &[McpServerInfo],
    enabled: &[String],
    backend: &str,
) -> Option<String> {
    let mut servers = Map::new();
    for key in enabled {
        let (key_backend, name) = parse_mcp_key(key);
        if !key_backend.is_empty() && key_backend != backend {
            continue;
        }
        if let Some(server) = available
            .iter()
            .find(|s| s.name == name && s.backend == backend)
        {
            servers.insert(name.to_string(), server.config.clone());
        }
    }
    if servers.is_empty() {
        return None;
    }
    let mut root = Map::new();
    root.insert("mcpServers".to_string(), Value::Object(servers));
    Some(Value::Object(root).to_string())
}

/// The config the UI would send for this session: discovers the backend's
/// servers and applies the saved session/project/global choices.
///
/// `claude_config_dir` is the active Claude account folder, so discovery reads
/// the same `.claude.json` that the Claude CLI reads (#138).
pub async fn default_mcp_config(
    app: &AppHandle,
    session_enabled: Option<&[String]>,
    worktree_id: &str,
    worktree_path: &str,
    backend: &str,
    claude_config_dir: Option<&str>,
) -> Option<String> {
    let available = super::commands::discover_mcp_servers(
        Some(backend),
        Some(worktree_path),
        claude_config_dir,
    );
    let prefs = crate::load_preferences(app.clone())
        .await
        .unwrap_or_default();
    let projects = crate::projects::storage::load_projects_data(app).ok();
    let project = projects.as_ref().and_then(|data| {
        let worktree = data.find_worktree(worktree_id)?;
        data.find_project(&worktree.project_id)
    });
    let project_enabled = project.and_then(|p| p.enabled_mcp_servers.as_deref());
    // The UI reads `project.known_mcp_servers ?? preferences.known_mcp_servers`;
    // an empty project list is not serialized, so it falls through too.
    let known = match project {
        Some(p) if !p.known_mcp_servers.is_empty() => &p.known_mcp_servers,
        _ => &prefs.known_mcp_servers,
    };
    let enabled = resolve_enabled_mcp_servers(
        &available,
        session_enabled,
        project_enabled,
        &prefs.default_enabled_mcp_servers,
        known,
    );
    build_mcp_config_json(&available, &enabled, backend)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Server {
        name: String,
        backend: String,
        #[serde(default)]
        disabled: bool,
        config: Value,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        name: String,
        backend: String,
        available_servers: Vec<Server>,
        session_enabled: Option<Vec<String>>,
        project_enabled: Option<Vec<String>>,
        #[serde(default)]
        global_enabled: Vec<String>,
        #[serde(default)]
        known_servers: Vec<String>,
        expected_enabled: Vec<String>,
        expected_config: Option<Value>,
    }

    /// The same cases run in `src/services/mcp.test.ts`.
    const CASES: &str = include_str!("../../../src/services/mcp-resolution-cases.json");

    #[test]
    fn matches_the_frontend_cascade() {
        let cases: Vec<Case> = serde_json::from_str(CASES).unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let available: Vec<McpServerInfo> = case
                .available_servers
                .into_iter()
                .map(|s| McpServerInfo {
                    name: s.name,
                    config: s.config,
                    scope: "user".to_string(),
                    disabled: s.disabled,
                    backend: s.backend,
                })
                .collect();
            let enabled = resolve_enabled_mcp_servers(
                &available,
                case.session_enabled.as_deref(),
                case.project_enabled.as_deref(),
                &case.global_enabled,
                &case.known_servers,
            );
            assert_eq!(enabled, case.expected_enabled, "case: {}", case.name);
            let config = build_mcp_config_json(&available, &enabled, &case.backend)
                .map(|json| serde_json::from_str::<Value>(&json).unwrap());
            assert_eq!(config, case.expected_config, "case: {}", case.name);
        }
    }
}
