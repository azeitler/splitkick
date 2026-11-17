//! MCP server discovery for Claude CLI configuration files.
//!
//! Reads:
//! - User scope:   <account>/.claude.json → top-level `mcpServers`
//! - Local scope:  <account>/.claude.json → `projects[worktree_path].mcpServers`
//! - Project scope: <worktree_path>/.mcp.json → `mcpServers`
//!
//! `<account>/.claude.json` is `~/.claude.json` for the root install and
//! `$CLAUDE_CONFIG_DIR/.claude.json` for another Claude account — the file
//! the Claude CLI itself reads for the active account (#138).

use crate::chat::McpServerInfo;
use std::collections::HashSet;

/// Discover Claude MCP servers from all configuration sources.
/// Precedence (highest to lowest): local → project → user.
///
/// `claude_config_dir` is the active account's `CLAUDE_CONFIG_DIR`
/// (`None` = root install).
pub fn get_mcp_servers(
    claude_config_dir: Option<&str>,
    worktree_path: Option<&str>,
) -> Vec<McpServerInfo> {
    let mut servers = Vec::new();
    let mut seen_names = HashSet::new();

    // Read the account's .claude.json once for both user and local scopes
    let claude_json_data = super::accounts::global_config_file(claude_config_dir)
        .filter(|p| p.exists())
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());

    // 1. Local scope (highest precedence): project-specific servers in ~/.claude.json
    if let (Some(ref json), Some(wt_path)) = (&claude_json_data, worktree_path) {
        if let Some(projects) = json.get("projects").and_then(|v| v.as_object()) {
            let path_key = wt_path.trim_end_matches('/');
            for (key, project_val) in projects {
                let key_normalized = key.trim_end_matches('/');
                if key_normalized == path_key {
                    if let Some(mcp) = project_val.get("mcpServers").and_then(|v| v.as_object()) {
                        for (name, config) in mcp {
                            if seen_names.insert(name.clone()) {
                                let disabled = config
                                    .get("disabled")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);
                                servers.push(McpServerInfo {
                                    name: name.clone(),
                                    config: config.clone(),
                                    scope: "local".to_string(),
                                    disabled,
                                    backend: "claude".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Project scope: <worktree_path>/.mcp.json
    if let Some(wt_path) = worktree_path {
        let mcp_json_path = std::path::PathBuf::from(wt_path).join(".mcp.json");
        if mcp_json_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&mcp_json_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(mcp) = json.get("mcpServers").and_then(|v| v.as_object()) {
                        for (name, config) in mcp {
                            if seen_names.insert(name.clone()) {
                                let disabled = config
                                    .get("disabled")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);
                                servers.push(McpServerInfo {
                                    name: name.clone(),
                                    config: config.clone(),
                                    scope: "project".to_string(),
                                    disabled,
                                    backend: "claude".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. User scope (lowest precedence): top-level mcpServers in ~/.claude.json
    if let Some(ref json) = claude_json_data {
        if let Some(mcp) = json.get("mcpServers").and_then(|v| v.as_object()) {
            for (name, config) in mcp {
                if seen_names.insert(name.clone()) {
                    let disabled = config
                        .get("disabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    servers.push(McpServerInfo {
                        name: name.clone(),
                        config: config.clone(),
                        scope: "user".to_string(),
                        disabled,
                        backend: "claude".to_string(),
                    });
                }
            }
        }
    }

    servers
}

#[cfg(test)]
mod tests {
    use super::*;

    // #138: an account folder's .claude.json is the source, and an `http`
    // entry keeps its type and url unchanged.
    #[test]
    fn reads_the_account_claude_json_with_http_servers() {
        let account = tempfile::tempdir().unwrap();
        let worktree = tempfile::tempdir().unwrap();
        let wt = worktree.path().to_string_lossy().to_string();
        let config = serde_json::json!({
            "mcpServers": {
                "playwright": { "type": "http", "url": "http://localhost:8931/mcp" }
            },
            "projects": {
                wt.clone(): { "mcpServers": { "events": { "type": "sse", "url": "http://localhost:9/sse" } } }
            }
        });
        std::fs::write(account.path().join(".claude.json"), config.to_string()).unwrap();

        let servers = get_mcp_servers(Some(&account.path().to_string_lossy()), Some(&wt));

        let playwright = servers.iter().find(|s| s.name == "playwright").unwrap();
        assert_eq!(playwright.scope, "user");
        assert_eq!(playwright.config["type"], "http");
        assert_eq!(playwright.config["url"], "http://localhost:8931/mcp");
        let events = servers.iter().find(|s| s.name == "events").unwrap();
        assert_eq!(events.scope, "local");
        assert_eq!(events.config["type"], "sse");
    }
}
