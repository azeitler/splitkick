//! Writer for browser MCP server entries in the CLI backends' own configs
//! (Claude, Codex, OpenCode, Cursor, Grok, Kimi, Antigravity).
//!
//! One edit per file: remove some servers, add or replace one, write once with
//! a timestamped backup. The same writer serves Agent Browser and Playwright.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Every backend the browser engines can be written to.
pub const BACKENDS: &[&str] = &[
    "claude",
    "codex",
    "opencode",
    "cursor",
    "grok",
    "kimi",
    "antigravity",
];

/// One stdio MCP server, in backend-neutral form.
#[derive(Debug, Clone, PartialEq)]
pub struct ServerSpec {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    /// Non-secret values only: this goes into a plain config file.
    pub env: Vec<(String, String)>,
}

impl ServerSpec {
    fn env_map(&self) -> serde_json::Map<String, Value> {
        self.env
            .iter()
            .map(|(k, v)| (k.clone(), Value::String(v.clone())))
            .collect()
    }

    /// `mcpServers` form (Claude, Cursor, Kimi, Antigravity).
    pub fn stdio_json(&self) -> Value {
        json!({
            "type": "stdio",
            "command": self.command,
            "args": self.args,
            "env": self.env_map(),
        })
    }

    /// OpenCode `mcp` form.
    pub fn opencode_json(&self) -> Value {
        let mut command = vec![self.command.clone()];
        command.extend(self.args.iter().cloned());
        json!({
            "type": "local",
            "command": command,
            "enabled": true,
            "environment": self.env_map(),
        })
    }

    /// `[mcp_servers.<name>]` form (Codex, Grok).
    pub fn toml_item(&self) -> toml_edit::Item {
        let mut table = toml_edit::Table::new();
        table["command"] = toml_edit::value(self.command.clone());
        table["args"] = toml_edit::value(toml_edit::Array::from_iter(self.args.iter()));
        let mut env = toml_edit::InlineTable::new();
        for (k, v) in &self.env {
            env.insert(k, v.clone().into());
        }
        table["env"] = toml_edit::value(env);
        table["enabled"] = toml_edit::value(true);
        toml_edit::Item::Table(table)
    }

    pub fn claude_snippet(&self) -> String {
        let mut servers = serde_json::Map::new();
        servers.insert(self.name.clone(), self.stdio_json());
        serde_json::to_string_pretty(&json!({ "mcpServers": servers })).unwrap_or_default()
    }

    pub fn codex_snippet(&self) -> String {
        let mut doc = toml_edit::DocumentMut::new();
        let mut servers = toml_edit::Table::new();
        servers.set_implicit(true);
        servers.insert(&self.name, self.toml_item());
        doc["mcp_servers"] = toml_edit::Item::Table(servers);
        doc.to_string()
    }
}

/// How one backend stores its MCP servers.
#[derive(Debug, Clone, PartialEq)]
pub enum ConfigFormat {
    Json {
        container: &'static str,
        opencode: bool,
    },
    Toml {
        label: &'static str,
        clear_disabled_list: bool,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConfigTarget {
    pub path: PathBuf,
    pub format: ConfigFormat,
}

/// The global MCP config of `backend` under `home`.
pub fn backend_config(home: &Path, backend: &str) -> Result<ConfigTarget, String> {
    let json = |path: PathBuf| ConfigTarget {
        path,
        format: ConfigFormat::Json {
            container: "mcpServers",
            opencode: false,
        },
    };
    let toml = |path: PathBuf, label, clear_disabled_list| ConfigTarget {
        path,
        format: ConfigFormat::Toml {
            label,
            clear_disabled_list,
        },
    };
    Ok(match backend {
        "claude" => json(home.join(".claude.json")),
        "cursor" => json(home.join(".cursor").join("mcp.json")),
        "kimi" => json(home.join(".kimi-code").join("mcp.json")),
        "antigravity" => json(home.join(".gemini").join("config").join("mcp_config.json")),
        "opencode" => ConfigTarget {
            path: find_opencode_config_path(home)
                .unwrap_or_else(|| home.join(".config").join("opencode").join("opencode.json")),
            format: ConfigFormat::Json {
                container: "mcp",
                opencode: true,
            },
        },
        "codex" => toml(home.join(".codex").join("config.toml"), "Codex", false),
        "grok" => toml(home.join(".grok").join("config.toml"), "Grok", true),
        other => return Err(format!("Unsupported MCP config backend: {other}")),
    })
}

fn find_opencode_config_path(home: &Path) -> Option<PathBuf> {
    for dir in [home.join(".config").join("opencode"), home.to_path_buf()] {
        for name in ["opencode.jsonc", "opencode.json", "config.json"] {
            let p = dir.join(name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

/// A server already in a config: its name and how it is started.
#[derive(Debug, Clone, PartialEq)]
pub struct ExistingServer {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(c) if c.trim().is_empty() => Ok(None),
        Ok(c) => Ok(Some(c)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read {}: {e}", path.display())),
    }
}

fn parse_json(path: &Path, content: &str) -> Result<Value, String> {
    serde_json::from_str(&strip_jsonc_comments_simple(content))
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))
}

fn parse_toml(path: &Path, label: &str, content: &str) -> Result<toml_edit::DocumentMut, String> {
    content
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("Failed to parse {label} TOML {}: {e}", path.display()))
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Every MCP server in the config (empty when the file does not exist).
pub fn list_servers(target: &ConfigTarget) -> Result<Vec<ExistingServer>, String> {
    let Some(content) = read_optional(&target.path)? else {
        return Ok(Vec::new());
    };
    match &target.format {
        ConfigFormat::Json {
            container,
            opencode,
        } => {
            let root = parse_json(&target.path, &content)?;
            let Some(servers) = root.get(*container).and_then(Value::as_object) else {
                return Ok(Vec::new());
            };
            Ok(servers
                .iter()
                .map(|(name, server)| {
                    let (command, args) = if *opencode {
                        let mut all = strings(server.get("command"));
                        let command = if all.is_empty() {
                            String::new()
                        } else {
                            all.remove(0)
                        };
                        (command, all)
                    } else {
                        (
                            server
                                .get("command")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                            strings(server.get("args")),
                        )
                    };
                    ExistingServer {
                        name: name.clone(),
                        command,
                        args,
                    }
                })
                .collect())
        }
        ConfigFormat::Toml { label, .. } => {
            let doc = parse_toml(&target.path, label, &content)?;
            let Some(servers) = doc.get("mcp_servers").and_then(|i| i.as_table_like()) else {
                return Ok(Vec::new());
            };
            Ok(servers
                .iter()
                .map(|(name, item)| {
                    let command = item
                        .get("command")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let args = item
                        .get("args")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|v| v.as_str().map(str::to_string))
                                .collect()
                        })
                        .unwrap_or_default();
                    ExistingServer {
                        name: name.to_string(),
                        command,
                        args,
                    }
                })
                .collect())
        }
    }
}

/// Remove the servers named in `remove`, then add or replace `insert`.
/// Writes only when something changed. Returns the path and the backup path.
pub fn edit_servers(
    target: &ConfigTarget,
    remove: &[String],
    insert: Option<&ServerSpec>,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    let path = &target.path;
    let content = read_optional(path)?;
    let updated = match &target.format {
        ConfigFormat::Json {
            container,
            opencode,
        } => {
            let mut root = match &content {
                Some(c) => parse_json(path, c)?,
                None => json!({}),
            };
            let obj = root
                .as_object_mut()
                .ok_or_else(|| format!("{} root must be an object", path.display()))?;
            let mut changed = false;
            if let Some(servers) = obj.get_mut(*container).and_then(Value::as_object_mut) {
                for name in remove {
                    changed |= servers.remove(name).is_some();
                }
            }
            if let Some(spec) = insert {
                let value = if *opencode {
                    spec.opencode_json()
                } else {
                    spec.stdio_json()
                };
                let servers = obj
                    .entry(container.to_string())
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
                    .ok_or_else(|| {
                        format!("{container} must be an object in {}", path.display())
                    })?;
                if servers.get(&spec.name) != Some(&value) {
                    servers.insert(spec.name.clone(), value);
                    changed = true;
                }
            }
            if !changed {
                return Ok((path.clone(), None));
            }
            serde_json::to_string_pretty(&root)
                .map_err(|e| format!("Failed to serialize {}: {e}", path.display()))?
        }
        ConfigFormat::Toml {
            label,
            clear_disabled_list,
        } => {
            let mut doc = match &content {
                Some(c) => parse_toml(path, label, c)?,
                None => toml_edit::DocumentMut::new(),
            };
            let before = doc.to_string();
            if let Some(servers) = doc
                .get_mut("mcp_servers")
                .and_then(|i| i.as_table_like_mut())
            {
                for name in remove {
                    servers.remove(name);
                }
            }
            if let Some(spec) = insert {
                if !doc.as_table().contains_key("mcp_servers") {
                    doc["mcp_servers"] = toml_edit::Item::Table(toml_edit::Table::new());
                }
                doc["mcp_servers"][spec.name.as_str()] = spec.toml_item();
                if *clear_disabled_list {
                    if let Some(arr) = doc
                        .get_mut("disabled_mcp_servers")
                        .and_then(|i| i.as_array_mut())
                    {
                        arr.retain(|v| v.as_str() != Some(spec.name.as_str()));
                    }
                }
            }
            let updated = doc.to_string();
            if updated == before && content.is_some() {
                return Ok((path.clone(), None));
            }
            updated
                .parse::<toml_edit::DocumentMut>()
                .map_err(|e| format!("Generated invalid {label} TOML: {e}"))?;
            updated
        }
    };
    let backup = write_atomic_with_backup(path, &updated)?;
    Ok((path.clone(), backup))
}

fn write_atomic_with_backup(path: &Path, content: &str) -> Result<Option<PathBuf>, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("config")
        .to_string();
    let backup = if path.exists() {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default();
        let backup = path.with_extension(format!("{extension}.bak.{ts}"));
        std::fs::copy(path, &backup)
            .map_err(|e| format!("Failed to create backup {}: {e}", backup.display()))?;
        Some(backup)
    } else {
        None
    };

    let tmp = path.with_extension(format!("{extension}.tmp"));
    std::fs::write(&tmp, content).map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        format!(
            "Failed to replace {} with {}: {e}",
            path.display(),
            tmp.display()
        )
    })?;
    Ok(backup)
}

fn strip_jsonc_comments_simple(input: &str) -> String {
    // Minimal strip for // line comments and /* block */ — good enough for MCP JSONC.
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    let mut in_string = false;
    let mut escape = false;
    while i < bytes.len() {
        let b = bytes[i];
        if in_string {
            out.push(b as char);
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if b == b'"' {
            in_string = true;
            out.push('"');
            i += 1;
            continue;
        }
        if b == b'/' && i + 1 < bytes.len() {
            if bytes[i + 1] == b'/' {
                i += 2;
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
            if bytes[i + 1] == b'*' {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
                continue;
            }
        }
        out.push(b as char);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn spec(name: &str) -> ServerSpec {
        ServerSpec {
            name: name.to_string(),
            command: "/usr/bin/tool".to_string(),
            args: vec!["mcp".to_string()],
            env: vec![("PROFILE".to_string(), "/p".to_string())],
        }
    }

    #[test]
    fn json_upsert_keeps_other_servers() {
        let dir = TempDir::new().unwrap();
        let target = backend_config(dir.path(), "claude").unwrap();
        fs::write(
            &target.path,
            r#"{ "mcpServers": { "other": { "command": "x" } } }"#,
        )
        .unwrap();

        edit_servers(&target, &[], Some(&spec("agent-browser"))).unwrap();

        let parsed: Value =
            serde_json::from_str(&fs::read_to_string(&target.path).unwrap()).unwrap();
        assert!(parsed["mcpServers"]["other"].is_object());
        assert_eq!(
            parsed["mcpServers"]["agent-browser"]["command"],
            "/usr/bin/tool"
        );
        assert_eq!(
            parsed["mcpServers"]["agent-browser"]["env"]["PROFILE"],
            "/p"
        );
    }

    #[test]
    fn toml_upsert_and_remove() {
        let dir = TempDir::new().unwrap();
        let target = backend_config(dir.path(), "codex").unwrap();
        fs::create_dir_all(target.path.parent().unwrap()).unwrap();
        fs::write(&target.path, "[mcp_servers.existing]\ncommand = \"foo\"\n").unwrap();

        edit_servers(&target, &[], Some(&spec("agent-browser"))).unwrap();
        let content = fs::read_to_string(&target.path).unwrap();
        assert!(content.contains("[mcp_servers.existing]"));
        assert!(content.contains("[mcp_servers.agent-browser]"));

        edit_servers(&target, &["agent-browser".to_string()], None).unwrap();
        let content = fs::read_to_string(&target.path).unwrap();
        assert!(content.contains("[mcp_servers.existing]"));
        assert!(!content.contains("agent-browser"));
    }

    #[test]
    fn opencode_uses_command_array() {
        let dir = TempDir::new().unwrap();
        let target = backend_config(dir.path(), "opencode").unwrap();
        edit_servers(&target, &[], Some(&spec("playwright"))).unwrap();
        let servers = list_servers(&target).unwrap();
        assert_eq!(
            servers,
            vec![ExistingServer {
                name: "playwright".to_string(),
                command: "/usr/bin/tool".to_string(),
                args: vec!["mcp".to_string()],
            }]
        );
    }

    #[test]
    fn antigravity_writes_its_global_config() {
        let dir = TempDir::new().unwrap();
        let target = backend_config(dir.path(), "antigravity").unwrap();
        edit_servers(&target, &[], Some(&spec("agent-browser"))).unwrap();
        assert!(target.path.ends_with(".gemini/config/mcp_config.json"));
        let value: Value =
            serde_json::from_str(&fs::read_to_string(&target.path).unwrap()).unwrap();
        assert_eq!(
            value["mcpServers"]["agent-browser"]["command"],
            "/usr/bin/tool"
        );
    }

    #[test]
    fn no_write_and_no_backup_when_nothing_changes() {
        let dir = TempDir::new().unwrap();
        let target = backend_config(dir.path(), "claude").unwrap();
        edit_servers(&target, &[], Some(&spec("playwright"))).unwrap();
        let (_, backup) = edit_servers(&target, &[], Some(&spec("playwright"))).unwrap();
        assert_eq!(backup, None);
        let (_, backup) = edit_servers(&target, &["missing".to_string()], None).unwrap();
        assert_eq!(backup, None);
    }

    #[test]
    fn strip_jsonc_preserves_strings_with_slashes() {
        let input = r#"{ "url": "https://example.com" } // trailing"#;
        let cleaned = strip_jsonc_comments_simple(input);
        assert!(cleaned.contains("https://example.com"));
        assert!(!cleaned.contains("trailing"));
    }
}
