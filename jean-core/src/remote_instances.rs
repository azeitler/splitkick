//! Other Splitkick instances the user connected (issue #94).
//!
//! Three parts:
//!
//! - **Store.** Names, URLs and SSH details live in `remote-connections.json`
//!   in the data directory. Tokens never go there: on macOS they live in the
//!   Keychain, elsewhere (and in sealed test runs) in a separate `0600` file.
//! - **Client.** The MCP tools `list_instances` and `remote_tool` call another
//!   instance's `POST /api/mcp/call` with the stored token.
//! - **Server.** [`serve_remote_call`] runs one MCP tool for such a call, with
//!   the loop guard and the v1 refusals.
//!
//! Contract: `docs/developer/remote-mcp.md`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::jean_mcp_core::{McpRole, ToolError};

const CONNECTIONS_FILE: &str = "remote-connections.json";
const TOKEN_FILE: &str = "remote-connection-tokens.json";

/// `file` keeps tokens in the `0600` token file even on macOS. The sealed e2e
/// instances set it, so a test run never writes to the login Keychain.
pub const TOKEN_STORE_ENV: &str = "SPLITKICK_REMOTE_TOKEN_STORE";

/// Keychain service of the token items. Each item's account is
/// `<data dir>/<connection id>`, so the installed app, the dev build and any
/// isolated profile never share an item.
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "Splitkick remote connection token";

/// MCP `source` prefix of a tool call that came from another instance.
pub const REMOTE_SOURCE_PREFIX: &str = "remote:";

/// How many instance hops a call may take. A call from another instance is
/// hop 1; it may not forward again.
const MAX_HOPS: u32 = 1;

/// Tools a remote caller may not run in v1. The caller is an instance, not a
/// local session, so it has no graph permission and no session to serve.
const REMOTE_REFUSED_TOOLS: &[&str] = &[
    "remote_tool",
    "create_node",
    "update_node",
    "set_node_state",
    "send_request",
    "set_serves",
    "create_graph",
];

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const CALL_TIMEOUT: Duration = Duration::from_secs(300);

static STORE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/// A connection as stored on disk. Has no token field on purpose.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnection {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_port: Option<u16>,
}

/// What `list_remote_connections` returns: no token, only whether one is set.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnectionView {
    #[serde(flatten)]
    pub connection: RemoteConnection,
    pub has_token: bool,
}

/// A connection with its token. Only the desktop shell gets this
/// (`get_remote_connection_secrets` in `src-tauri`), never Web Access.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnectionSecret {
    #[serde(flatten)]
    pub connection: RemoteConnection,
    pub token: String,
}

/// Input of `save_remote_connection` and `import_remote_connections`.
///
/// `token`: `None` keeps the stored token, `Some("")` removes it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnectionInput {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ConnectionsFile {
    #[serde(default)]
    connections: Vec<RemoteConnection>,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))
}

fn read_connections(dir: &Path) -> Result<Vec<RemoteConnection>, String> {
    let path = dir.join(CONNECTIONS_FILE);
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<ConnectionsFile>(&raw)
            .map(|file| file.connections)
            .map_err(|e| format!("Failed to parse {}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("Failed to read {}: {e}", path.display())),
    }
}

fn write_connections(dir: &Path, connections: &[RemoteConnection]) -> Result<(), String> {
    let body = serde_json::to_string_pretty(&ConnectionsFile {
        connections: connections.to_vec(),
    })
    .map_err(|e| format!("Failed to serialize remote connections: {e}"))?;
    write_private(&dir.join(CONNECTIONS_FILE), body.as_bytes())
}

/// Write via a temp file and rename, readable by the owner only.
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension("json.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&tmp)
        .map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn normalize_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let parsed =
        reqwest::Url::parse(trimmed).map_err(|_| "Enter a valid HTTP or HTTPS URL.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Enter an HTTP or HTTPS URL.".to_string());
    }
    if parsed.query().is_some() {
        return Err("The URL must not carry a query (put the token in the token field).".into());
    }
    Ok(trimmed.to_string())
}

fn connection_from_input(input: &RemoteConnectionInput) -> Result<RemoteConnection, String> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return Err("A remote connection needs an id.".to_string());
    }
    let url = normalize_url(&input.url)?;
    let name = clean(Some(input.name.clone())).unwrap_or_else(|| {
        reqwest::Url::parse(&url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_else(|| url.clone())
    });
    Ok(RemoteConnection {
        id,
        name,
        url,
        ssh_user: clean(input.ssh_user.clone()),
        ssh_host: clean(input.ssh_host.clone()),
        ssh_port: input.ssh_port.filter(|port| *port != 0 && *port != 22),
    })
}

/// The token store for this instance.
enum TokenStore {
    #[cfg(target_os = "macos")]
    Keychain {
        account_prefix: String,
    },
    File(PathBuf),
}

impl TokenStore {
    fn for_dir(dir: &Path) -> Self {
        #[cfg(target_os = "macos")]
        {
            let forced_file = std::env::var(TOKEN_STORE_ENV).is_ok_and(|v| v == "file");
            if !forced_file {
                return Self::Keychain {
                    account_prefix: dir.display().to_string(),
                };
            }
        }
        Self::File(dir.join(TOKEN_FILE))
    }

    fn read_file(path: &Path) -> Result<BTreeMap<String, String>, String> {
        match std::fs::read_to_string(path) {
            Ok(raw) => serde_json::from_str(&raw)
                .map_err(|e| format!("Failed to parse {}: {e}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(format!("Failed to read {}: {e}", path.display())),
        }
    }

    fn write_file(path: &Path, tokens: &BTreeMap<String, String>) -> Result<(), String> {
        let body = serde_json::to_vec_pretty(tokens)
            .map_err(|e| format!("Failed to serialize tokens: {e}"))?;
        write_private(path, &body)
    }

    fn get(&self, id: &str) -> Result<Option<String>, String> {
        match self {
            #[cfg(target_os = "macos")]
            Self::Keychain { account_prefix } => {
                let account = format!("{account_prefix}/{id}");
                match security_framework::passwords::get_generic_password(
                    KEYCHAIN_SERVICE,
                    &account,
                ) {
                    Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
                    Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
                    Err(e) => Err(format!("Keychain read failed: {e}")),
                }
            }
            Self::File(path) => Ok(Self::read_file(path)?.remove(id)),
        }
    }

    fn set(&self, id: &str, token: &str) -> Result<(), String> {
        match self {
            #[cfg(target_os = "macos")]
            Self::Keychain { account_prefix } => {
                let account = format!("{account_prefix}/{id}");
                security_framework::passwords::set_generic_password(
                    KEYCHAIN_SERVICE,
                    &account,
                    token.as_bytes(),
                )
                .map_err(|e| format!("Keychain write failed: {e}"))
            }
            Self::File(path) => {
                let mut tokens = Self::read_file(path)?;
                tokens.insert(id.to_string(), token.to_string());
                Self::write_file(path, &tokens)
            }
        }
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        match self {
            #[cfg(target_os = "macos")]
            Self::Keychain { account_prefix } => {
                let account = format!("{account_prefix}/{id}");
                match security_framework::passwords::delete_generic_password(
                    KEYCHAIN_SERVICE,
                    &account,
                ) {
                    Ok(()) => Ok(()),
                    Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
                    Err(e) => Err(format!("Keychain delete failed: {e}")),
                }
            }
            Self::File(path) => {
                let mut tokens = Self::read_file(path)?;
                if tokens.remove(id).is_some() {
                    Self::write_file(path, &tokens)?;
                }
                Ok(())
            }
        }
    }
}

#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

fn save_in(
    dir: &Path,
    store: &TokenStore,
    input: RemoteConnectionInput,
) -> Result<RemoteConnectionView, String> {
    let connection = connection_from_input(&input)?;
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match input.token.as_deref().map(str::trim) {
        Some("") => store.delete(&connection.id)?,
        Some(token) => store.set(&connection.id, token)?,
        None => {}
    }
    let mut connections = read_connections(dir)?;
    match connections.iter_mut().find(|c| c.id == connection.id) {
        Some(existing) => *existing = connection.clone(),
        None => connections.push(connection.clone()),
    }
    write_connections(dir, &connections)?;
    let has_token = store.get(&connection.id)?.is_some();
    Ok(RemoteConnectionView {
        connection,
        has_token,
    })
}

fn remove_in(dir: &Path, store: &TokenStore, id: &str) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut connections = read_connections(dir)?;
    connections.retain(|c| c.id != id);
    write_connections(dir, &connections)?;
    store.delete(id)
}

fn list_in(dir: &Path, store: &TokenStore) -> Result<Vec<RemoteConnectionView>, String> {
    read_connections(dir)?
        .into_iter()
        .map(|connection| {
            let has_token = store.get(&connection.id)?.is_some();
            Ok(RemoteConnectionView {
                connection,
                has_token,
            })
        })
        .collect()
}

fn secrets_in(dir: &Path, store: &TokenStore) -> Result<Vec<RemoteConnectionSecret>, String> {
    read_connections(dir)?
        .into_iter()
        .map(|connection| {
            let token = store.get(&connection.id)?.unwrap_or_default();
            Ok(RemoteConnectionSecret { connection, token })
        })
        .collect()
}

/// Add the connections whose id is not stored yet; keep the stored ones.
fn import_in(
    dir: &Path,
    store: &TokenStore,
    inputs: Vec<RemoteConnectionInput>,
) -> Result<Vec<RemoteConnectionView>, String> {
    let known: Vec<String> = read_connections(dir)?.into_iter().map(|c| c.id).collect();
    for input in inputs {
        if known.iter().any(|id| id == input.id.trim()) {
            continue;
        }
        save_in(dir, store, input)?;
    }
    list_in(dir, store)
}

/// Every connection without its token.
pub fn list_remote_connections(app: &AppHandle) -> Result<Vec<RemoteConnectionView>, String> {
    let dir = data_dir(app)?;
    list_in(&dir, &TokenStore::for_dir(&dir))
}

/// Add or update one connection. Never returns the token.
pub fn save_remote_connection(
    app: &AppHandle,
    input: RemoteConnectionInput,
) -> Result<RemoteConnectionView, String> {
    let dir = data_dir(app)?;
    save_in(&dir, &TokenStore::for_dir(&dir), input)
}

/// Remove one connection and its token.
pub fn remove_remote_connection(app: &AppHandle, id: &str) -> Result<(), String> {
    let dir = data_dir(app)?;
    remove_in(&dir, &TokenStore::for_dir(&dir), id)
}

/// One-time migration of the frontend's localStorage list.
pub fn import_remote_connections(
    app: &AppHandle,
    inputs: Vec<RemoteConnectionInput>,
) -> Result<Vec<RemoteConnectionView>, String> {
    let dir = data_dir(app)?;
    import_in(&dir, &TokenStore::for_dir(&dir), inputs)
}

/// Every connection with its token. For the desktop shell only: it is not in
/// the WebSocket dispatch, so Web Access cannot call it.
pub fn remote_connection_secrets(app: &AppHandle) -> Result<Vec<RemoteConnectionSecret>, String> {
    let dir = data_dir(app)?;
    secrets_in(&dir, &TokenStore::for_dir(&dir))
}

// ---------------------------------------------------------------------------
// Client: list_instances and remote_tool
// ---------------------------------------------------------------------------

/// Body of `POST /api/mcp/call`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCallRequest {
    pub tool: String,
    #[serde(default)]
    pub arguments: Value,
    /// The calling session on the origin instance. Only used to key the
    /// remote's rate limit and in its log.
    #[serde(default)]
    pub origin: Option<String>,
    /// Instance hops so far; a direct call from one instance is 1.
    #[serde(default)]
    pub hop: Option<u32>,
    /// The caller's MCP depth, checked against the remote's limit.
    #[serde(default)]
    pub depth: Option<u32>,
}

fn is_remote_source(source: &str) -> bool {
    source.starts_with(REMOTE_SOURCE_PREFIX)
}

fn find_instance<'a>(
    connections: &'a [RemoteConnection],
    wanted: &str,
) -> Result<&'a RemoteConnection, ToolError> {
    let wanted = wanted.trim();
    connections
        .iter()
        .find(|c| c.id == wanted)
        .or_else(|| {
            connections
                .iter()
                .find(|c| c.name.eq_ignore_ascii_case(wanted))
        })
        .ok_or_else(|| {
            let names: Vec<&str> = connections.iter().map(|c| c.name.as_str()).collect();
            ToolError::invalid_params(if names.is_empty() {
                format!(
                    "Unknown Splitkick instance '{wanted}': no remote connections are set up. \
Add one in Remote Connections."
                )
            } else {
                format!(
                    "Unknown Splitkick instance '{wanted}'. Connected instances: {}. \
Call list_instances for names and ids.",
                    names.join(", ")
                )
            })
        })
}

fn endpoint(base: &str, path: &str) -> String {
    format!("{}/{path}", base.trim_end_matches('/'))
}

fn http_client(timeout: Duration) -> Result<reqwest::Client, ToolError> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| ToolError::internal(format!("HTTP client: {e}")))
}

/// Network failure as a clear error. The message drops the URL: it carries no
/// token, but the instance name and URL are said once, in front.
fn transport_error(connection: &RemoteConnection, error: reqwest::Error) -> ToolError {
    let reason = if error.is_timeout() {
        "timed out".to_string()
    } else if error.is_connect() {
        "connection refused or host not found".to_string()
    } else {
        error.without_url().to_string()
    };
    ToolError::internal(format!(
        "Splitkick instance '{}' is unreachable at {}: {reason}. Is Splitkick running there with Web Access on?",
        connection.name, connection.url
    ))
}

fn token_rejected(connection: &RemoteConnection) -> ToolError {
    ToolError::internal(format!(
        "Splitkick instance '{}' rejected the access token. Update the token in Remote Connections.",
        connection.name
    ))
}

fn too_old(connection: &RemoteConnection) -> ToolError {
    ToolError::internal(format!(
        "Splitkick on '{}' is too old for remote MCP calls. Update Splitkick there.",
        connection.name
    ))
}

/// Map the remote's HTTP answer to the MCP result or a clear error.
fn map_call_response(
    connection: &RemoteConnection,
    status: u16,
    body: &str,
) -> Result<Value, ToolError> {
    match status {
        401 => return Err(token_rejected(connection)),
        // Without the route the server's fallback only takes GET: 405.
        404 | 405 => return Err(too_old(connection)),
        _ => {}
    }
    let parsed: Value = serde_json::from_str(body).map_err(|_| {
        ToolError::internal(format!(
            "Splitkick instance '{}' returned HTTP {status} without a valid response \
(a login proxy in front of it?).",
            connection.name
        ))
    })?;
    if parsed.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
    }
    let message = parsed
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("unknown error");
    let code = parsed
        .get("code")
        .and_then(Value::as_i64)
        .map(|c| c as i32)
        .unwrap_or(-32000);
    Err(ToolError {
        code,
        message: format!("[{}] {message}", connection.name),
    })
}

/// Put the instance in front of the remote's result, so the model knows whose
/// ids and links follow. The remote's content blocks stay unchanged.
fn tag_result(connection: &RemoteConnection, mut result: Value) -> Value {
    let note = json!({
        "type": "text",
        "text": format!(
            "Result from Splitkick instance \"{}\" (id {}). Ids and links below belong to that \
    instance: pass them back through remote_tool with the same instance.",
            connection.name, connection.id
        ),
    });
    if let Some(object) = result.as_object_mut() {
        match object.get_mut("content").and_then(Value::as_array_mut) {
            Some(content) => content.insert(0, note),
            None => {
                object.insert("content".to_string(), Value::Array(vec![note]));
            }
        }
        object.insert(
            "_meta".to_string(),
            json!({ "splitkickInstance": { "id": connection.id, "name": connection.name } }),
        );
        result
    } else {
        json!({
            "content": [note, { "type": "text", "text": result.to_string() }],
            "isError": false,
            "_meta": { "splitkickInstance": { "id": connection.id, "name": connection.name } },
        })
    }
}

async fn post_call(
    connection: &RemoteConnection,
    token: &str,
    request: &RemoteCallRequest,
) -> Result<Value, ToolError> {
    let client = http_client(CALL_TIMEOUT)?;
    let mut builder = client
        .post(endpoint(&connection.url, "api/mcp/call"))
        .json(request);
    if !token.is_empty() {
        builder = builder.bearer_auth(token);
    }
    let response = builder
        .send()
        .await
        .map_err(|e| transport_error(connection, e))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| transport_error(connection, e))?;
    map_call_response(connection, status, &body)
}

/// `remote_tool(instance, tool, arguments)`.
pub async fn remote_tool(
    app: &AppHandle,
    args: Value,
    source: &str,
    depth: u32,
) -> Result<Value, ToolError> {
    if is_remote_source(source) {
        return Err(loop_refused());
    }
    let instance = args
        .get("instance")
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| ToolError::invalid_params("instance is required"))?;
    let tool = args
        .get("tool")
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| ToolError::invalid_params("tool is required"))?
        .to_string();
    if REMOTE_REFUSED_TOOLS.contains(&tool.as_str()) || tool == "list_instances" {
        return Err(refused_remotely(&tool));
    }
    let arguments = match args.get("arguments") {
        None | Some(Value::Null) => json!({}),
        Some(Value::Object(map)) => Value::Object(map.clone()),
        Some(_) => return Err(ToolError::invalid_params("arguments must be an object")),
    };

    let dir = data_dir(app).map_err(ToolError::internal)?;
    let connections = read_connections(&dir).map_err(ToolError::internal)?;
    let connection = find_instance(&connections, instance)?.clone();
    let token = TokenStore::for_dir(&dir)
        .get(&connection.id)
        .map_err(ToolError::internal)?
        .unwrap_or_default();

    let request = RemoteCallRequest {
        tool,
        arguments,
        origin: Some(source.to_string()),
        hop: Some(1),
        depth: Some(depth),
    };
    let result = post_call(&connection, &token, &request).await?;
    Ok(tag_result(&connection, result))
}

/// One row of `list_instances`.
async fn probe(connection: RemoteConnection, token: String) -> Value {
    let base = json!({ "id": connection.id, "name": connection.name, "url": connection.url });
    let answer = async {
        let client = http_client(PROBE_TIMEOUT)?;
        let mut builder = client.get(endpoint(&connection.url, "api/version"));
        if !token.is_empty() {
            builder = builder.bearer_auth(&token);
        }
        let response = builder
            .send()
            .await
            .map_err(|e| transport_error(&connection, e))?;
        match response.status().as_u16() {
            401 => return Err(token_rejected(&connection)),
            200 => {}
            other => {
                return Err(ToolError::internal(format!(
                    "Splitkick instance '{}' answered HTTP {other}.",
                    connection.name
                )))
            }
        }
        let info: Value = response.json().await.map_err(|_| {
            ToolError::internal(format!(
                "Splitkick instance '{}' returned no version (a login proxy in front of it?).",
                connection.name
            ))
        })?;
        Ok::<_, ToolError>(info)
    }
    .await;
    let mut row = base;
    match answer {
        Ok(info) => {
            row["reachable"] = json!(true);
            row["version"] = info.get("appVersion").cloned().unwrap_or(Value::Null);
        }
        Err(error) => {
            row["reachable"] = json!(false);
            row["version"] = Value::Null;
            row["error"] = json!(error.message);
        }
    }
    row
}

/// `list_instances`: name, id, URL, reachable, version. Never a token.
pub async fn list_instances(app: &AppHandle, source: &str) -> Result<Value, ToolError> {
    if is_remote_source(source) {
        return Err(loop_refused());
    }
    let dir = data_dir(app).map_err(ToolError::internal)?;
    let store = TokenStore::for_dir(&dir);
    let connections = read_connections(&dir).map_err(ToolError::internal)?;
    let mut probes = Vec::with_capacity(connections.len());
    for connection in connections {
        let token = store
            .get(&connection.id)
            .map_err(ToolError::internal)?
            .unwrap_or_default();
        probes.push(probe(connection, token));
    }
    let instances = futures_util::future::join_all(probes).await;
    Ok(json!({ "instances": instances }))
}

// ---------------------------------------------------------------------------
// Server: POST /api/mcp/call
// ---------------------------------------------------------------------------

fn loop_refused() -> ToolError {
    ToolError::invalid_params(
        "This call came from another Splitkick instance. Remote calls go one hop only: \
an instance cannot forward to a third one (or back).",
    )
}

fn refused_remotely(tool: &str) -> ToolError {
    if tool == "remote_tool" || tool == "list_instances" {
        return loop_refused();
    }
    ToolError::invalid_params(format!(
        "{tool} is not available across instances: graph writes need a local session's graph \
permission. Run it in a session on that instance."
    ))
}

/// MCP `source` for a call from another instance. Keeps only characters that
/// are safe in a file name, so it can never point at a real session.
pub fn remote_source(origin: Option<&str>) -> String {
    let cleaned: String = origin
        .unwrap_or("unknown")
        .chars()
        .take(120)
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{REMOTE_SOURCE_PREFIX}{cleaned}")
}

/// Check a call from another instance before it reaches `call_tool`.
fn check_remote_call(request: &RemoteCallRequest) -> Result<(), ToolError> {
    if request.hop.unwrap_or(1) > MAX_HOPS {
        return Err(loop_refused());
    }
    if REMOTE_REFUSED_TOOLS.contains(&request.tool.as_str()) || request.tool == "list_instances" {
        return Err(refused_remotely(&request.tool));
    }
    Ok(())
}

/// Run one MCP tool for another instance (`POST /api/mcp/call`).
pub async fn serve_remote_call(
    app: &AppHandle,
    request: RemoteCallRequest,
) -> Result<Value, ToolError> {
    check_remote_call(&request)?;
    let source = remote_source(request.origin.as_deref());
    log::info!("Remote MCP call {} from {source}", request.tool);
    let arguments = if request.arguments.is_null() {
        json!({})
    } else {
        request.arguments
    };
    // Boxed: the tool future is large and this runs on a blocking thread.
    Box::pin(crate::jean_mcp_core::call_tool(
        app,
        &request.tool,
        arguments,
        &source,
        request.depth.unwrap_or(0),
        McpRole::Full,
    ))
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: &str, token: Option<&str>) -> RemoteConnectionInput {
        RemoteConnectionInput {
            id: id.to_string(),
            name: format!("box-{id}"),
            url: "http://box.tail1234.ts.net:3460/".to_string(),
            token: token.map(str::to_string),
            ssh_user: Some(" andreas ".to_string()),
            ssh_host: None,
            ssh_port: Some(22),
        }
    }

    fn file_store(dir: &Path) -> TokenStore {
        TokenStore::File(dir.join(TOKEN_FILE))
    }

    #[test]
    fn connections_file_never_holds_tokens() {
        let temp = tempfile::tempdir().unwrap();
        let store = file_store(temp.path());
        let view = save_in(temp.path(), &store, input("a", Some("SECRET-TOKEN"))).unwrap();
        assert!(view.has_token);
        assert_eq!(view.connection.url, "http://box.tail1234.ts.net:3460");
        assert_eq!(view.connection.ssh_user.as_deref(), Some("andreas"));
        assert_eq!(view.connection.ssh_port, None, "22 is implied");

        let on_disk = std::fs::read_to_string(temp.path().join(CONNECTIONS_FILE)).unwrap();
        assert!(!on_disk.contains("SECRET-TOKEN"));
        assert!(!on_disk.contains("token"));

        let listed = serde_json::to_string(&list_in(temp.path(), &store).unwrap()).unwrap();
        assert!(!listed.contains("SECRET-TOKEN"));
        assert!(listed.contains("\"hasToken\":true"));

        let secrets = secrets_in(temp.path(), &store).unwrap();
        assert_eq!(secrets[0].token, "SECRET-TOKEN");
    }

    #[cfg(unix)]
    #[test]
    fn token_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        save_in(temp.path(), &file_store(temp.path()), input("a", Some("t"))).unwrap();
        let mode = std::fs::metadata(temp.path().join(TOKEN_FILE))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn save_keeps_or_clears_the_token() {
        let temp = tempfile::tempdir().unwrap();
        let store = file_store(temp.path());
        save_in(temp.path(), &store, input("a", Some("one"))).unwrap();
        let kept = save_in(temp.path(), &store, input("a", None)).unwrap();
        assert!(kept.has_token);
        assert_eq!(store.get("a").unwrap().as_deref(), Some("one"));
        let cleared = save_in(temp.path(), &store, input("a", Some(""))).unwrap();
        assert!(!cleared.has_token);

        save_in(temp.path(), &store, input("b", Some("two"))).unwrap();
        remove_in(temp.path(), &store, "b").unwrap();
        assert_eq!(store.get("b").unwrap(), None);
        assert_eq!(list_in(temp.path(), &store).unwrap().len(), 1);
    }

    #[test]
    fn import_adds_only_unknown_ids() {
        let temp = tempfile::tempdir().unwrap();
        let store = file_store(temp.path());
        save_in(temp.path(), &store, input("a", Some("stored"))).unwrap();
        let listed = import_in(
            temp.path(),
            &store,
            vec![input("a", Some("stale")), input("b", Some("new"))],
        )
        .unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(store.get("a").unwrap().as_deref(), Some("stored"));
        assert_eq!(store.get("b").unwrap().as_deref(), Some("new"));
    }

    #[test]
    fn save_rejects_bad_urls() {
        let temp = tempfile::tempdir().unwrap();
        let store = file_store(temp.path());
        let mut bad = input("a", None);
        bad.url = "ftp://box".to_string();
        assert!(save_in(temp.path(), &store, bad).is_err());
        let mut with_query = input("a", None);
        with_query.url = "http://box:3460/?token=x".to_string();
        assert!(save_in(temp.path(), &store, with_query).is_err());
    }

    fn connection(id: &str, name: &str) -> RemoteConnection {
        RemoteConnection {
            id: id.to_string(),
            name: name.to_string(),
            url: "http://127.0.0.1:1".to_string(),
            ssh_user: None,
            ssh_host: None,
            ssh_port: None,
        }
    }

    #[test]
    fn find_instance_by_id_or_name() {
        let list = vec![connection("id-1", "mb16"), connection("id-2", "server")];
        assert_eq!(find_instance(&list, "id-2").unwrap().name, "server");
        assert_eq!(find_instance(&list, "MB16").unwrap().id, "id-1");
        let error = find_instance(&list, "nope").unwrap_err();
        assert!(error.message.contains("Unknown Splitkick instance 'nope'"));
        assert!(error.message.contains("mb16, server"));
        assert!(find_instance(&[], "x")
            .unwrap_err()
            .message
            .contains("no remote connections"));
    }

    #[test]
    fn call_responses_map_to_clear_errors() {
        let c = connection("id-1", "mb16");
        assert!(map_call_response(&c, 401, "")
            .unwrap_err()
            .message
            .contains("rejected the access token"));
        for status in [404, 405] {
            assert!(map_call_response(&c, status, "Method Not Allowed")
                .unwrap_err()
                .message
                .contains("too old"));
        }
        assert!(map_call_response(&c, 200, "<html>login</html>")
            .unwrap_err()
            .message
            .contains("without a valid response"));
        let error = map_call_response(
            &c,
            422,
            r#"{"ok":false,"error":"Unknown sessionId","code":-32602}"#,
        )
        .unwrap_err();
        assert_eq!(error.code, -32602);
        assert_eq!(error.message, "[mb16] Unknown sessionId");
        let ok = map_call_response(
            &c,
            200,
            r#"{"ok":true,"result":{"content":[{"type":"text","text":"x"}],"isError":false}}"#,
        )
        .unwrap();
        assert_eq!(ok["content"][0]["text"], "x");
    }

    #[test]
    fn tagged_result_keeps_the_remote_content() {
        let c = connection("id-1", "mb16");
        let tagged = tag_result(
            &c,
            json!({"content":[{"type":"text","text":"splitkick://session/s1"}],"isError":false}),
        );
        assert!(tagged["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("\"mb16\""));
        assert_eq!(tagged["content"][1]["text"], "splitkick://session/s1");
        assert_eq!(tagged["_meta"]["splitkickInstance"]["name"], "mb16");
    }

    #[test]
    fn remote_calls_are_guarded() {
        let call = |tool: &str, hop: Option<u32>| RemoteCallRequest {
            tool: tool.to_string(),
            arguments: json!({}),
            origin: None,
            hop,
            depth: None,
        };
        assert!(check_remote_call(&call("list_projects", Some(1))).is_ok());
        assert!(check_remote_call(&call("read_graph", None)).is_ok());
        assert!(check_remote_call(&call("list_projects", Some(2)))
            .unwrap_err()
            .message
            .contains("one hop only"));
        for tool in ["remote_tool", "list_instances"] {
            assert!(check_remote_call(&call(tool, Some(1)))
                .unwrap_err()
                .message
                .contains("one hop only"));
        }
        for tool in [
            "set_node_state",
            "set_serves",
            "create_node",
            "create_graph",
        ] {
            assert!(check_remote_call(&call(tool, Some(1)))
                .unwrap_err()
                .message
                .contains("not available across instances"));
        }
    }

    #[test]
    fn remote_source_is_file_name_safe() {
        assert_eq!(remote_source(Some("abc-123")), "remote:abc-123");
        assert_eq!(remote_source(Some("../../etc")), "remote:.._.._etc");
        assert_eq!(remote_source(None), "remote:unknown");
    }

    fn runtime(dir: &Path) -> AppHandle {
        crate::runtime::RuntimeContext::new(dir.into(), dir.into()).unwrap()
    }

    fn tool_text(result: &Value, index: usize) -> String {
        result["content"][index]["text"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    }

    /// Two real instances: A forwards MCP tools to B over `POST /api/mcp/call`.
    ///
    /// The MCP tool futures are larger than a debug test thread's 2 MB stack,
    /// so the runtime gets 32 MB threads.
    #[test]
    fn remote_tool_forwards_between_two_instances() {
        const STACK: usize = 32 * 1024 * 1024;
        std::thread::Builder::new()
            .stack_size(STACK)
            .spawn(|| {
                tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .thread_stack_size(STACK)
                    .build()
                    .unwrap()
                    .block_on(forward_between_two_instances())
            })
            .unwrap()
            .join()
            .unwrap();
    }

    async fn forward_between_two_instances() {
        // Tokens in a file, never in the login Keychain.
        std::env::set_var(TOKEN_STORE_ENV, "file");
        let temp_a = tempfile::tempdir().unwrap();
        let temp_b = tempfile::tempdir().unwrap();
        let a = runtime(temp_a.path());
        let b = runtime(temp_b.path());
        let server_b = crate::http_server::server::start_server(
            b,
            0,
            "token-b".to_string(),
            "127.0.0.1".to_string(),
            true,
        )
        .await
        .unwrap();
        let url_b = format!("http://127.0.0.1:{}", server_b.port);

        // A port that refuses connections, and a server without the route.
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let closed_port = closed.local_addr().unwrap().port();
        drop(closed);
        let old = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let old_port = old.local_addr().unwrap().port();
        tokio::spawn(async move {
            let router = axum::Router::new().fallback(axum::routing::get(|| async { "old" }));
            let _ = axum::serve(old, router).await;
        });

        for (id, name, url, token) in [
            ("b", "box-b", url_b.clone(), "token-b"),
            ("bad", "bad-token", url_b.clone(), "wrong"),
            (
                "down",
                "down",
                format!("http://127.0.0.1:{closed_port}"),
                "x",
            ),
            ("old", "old", format!("http://127.0.0.1:{old_port}"), "x"),
        ] {
            save_remote_connection(
                &a,
                RemoteConnectionInput {
                    id: id.into(),
                    name: name.into(),
                    url,
                    token: Some(token.into()),
                    ssh_user: None,
                    ssh_host: None,
                    ssh_port: None,
                },
            )
            .unwrap();
        }
        let call = |tool: &'static str, args: Value| {
            let a = a.clone();
            async move {
                crate::jean_mcp_core::call_tool(&a, tool, args, "session-a", 0, McpRole::Full).await
            }
        };

        let listed = call("list_instances", json!({})).await.unwrap();
        let text = tool_text(&listed, 0);
        assert!(!text.contains("token-b"), "list_instances leaks a token");
        let instances: Value = serde_json::from_str(&text).unwrap();
        let rows = instances["instances"].as_array().unwrap();
        let row = |name: &str| rows.iter().find(|r| r["name"] == name).unwrap().clone();
        assert_eq!(row("box-b")["reachable"], true);
        assert!(row("box-b")["version"].is_string());
        assert_eq!(row("bad-token")["reachable"], false);
        assert!(row("bad-token")["error"]
            .as_str()
            .unwrap()
            .contains("rejected the access token"));
        assert_eq!(row("down")["reachable"], false);

        let projects = call(
            "remote_tool",
            json!({ "instance": "box-b", "tool": "list_projects" }),
        )
        .await
        .unwrap();
        assert!(tool_text(&projects, 0).contains("\"box-b\""));
        assert_eq!(tool_text(&projects, 1).trim(), "[]");
        assert_eq!(projects["_meta"]["splitkickInstance"]["id"], "b");

        // The remote's own errors come back with its code, tagged.
        let unknown_session = call(
            "remote_tool",
            json!({ "instance": "b", "tool": "get_session_status", "arguments": { "sessionId": "nope" } }),
        )
        .await
        .unwrap_err();
        assert!(unknown_session.message.starts_with("[box-b] "));

        let error =
            |args: Value| async move { call("remote_tool", args).await.unwrap_err().message };
        assert!(
            error(json!({ "instance": "mars", "tool": "list_projects" }))
                .await
                .contains("Unknown Splitkick instance 'mars'")
        );
        assert!(
            error(json!({ "instance": "bad-token", "tool": "list_projects" }))
                .await
                .contains("rejected the access token")
        );
        assert!(
            error(json!({ "instance": "down", "tool": "list_projects" }))
                .await
                .contains("unreachable")
        );
        assert!(error(json!({ "instance": "old", "tool": "list_projects" }))
            .await
            .contains("too old"));
        assert!(error(json!({ "instance": "b", "tool": "set_node_state" }))
            .await
            .contains("not available across instances"));

        // The route itself: auth, loop guard and graph-write refusal on B.
        let client = reqwest::Client::new();
        let post = |token: Option<&str>, body: Value| {
            let mut request = client.post(format!("{url_b}/api/mcp/call")).json(&body);
            if let Some(token) = token {
                request = request.bearer_auth(token);
            }
            request.send()
        };
        let list = json!({ "tool": "list_projects", "hop": 1 });
        assert_eq!(post(None, list.clone()).await.unwrap().status(), 401);
        assert_eq!(
            post(Some("wrong"), list.clone()).await.unwrap().status(),
            401
        );
        let ok = post(Some("token-b"), list).await.unwrap();
        assert_eq!(ok.status(), 200);
        assert_eq!(ok.json::<Value>().await.unwrap()["ok"], true);
        for (body, expected) in [
            (json!({ "tool": "list_projects", "hop": 2 }), "one hop only"),
            (
                json!({ "tool": "remote_tool", "arguments": { "instance": "a", "tool": "list_projects" } }),
                "one hop only",
            ),
            (
                json!({ "tool": "set_serves", "arguments": { "serves": [] } }),
                "not available across instances",
            ),
        ] {
            let refused = post(Some("token-b"), body).await.unwrap();
            assert_eq!(refused.status(), 422);
            let refused: Value = refused.json().await.unwrap();
            assert!(refused["error"].as_str().unwrap().contains(expected));
        }

        let _ = server_b.shutdown_tx.send(());
    }

    /// Run by hand once on macOS: `cargo test -- --ignored keychain_roundtrip`.
    /// Writes and removes one item under a throwaway account.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn keychain_roundtrip() {
        let store = TokenStore::Keychain {
            account_prefix: format!("/tmp/splitkick-keychain-test-{}", uuid::Uuid::new_v4()),
        };
        assert_eq!(store.get("x").unwrap(), None);
        store.set("x", "secret").unwrap();
        assert_eq!(store.get("x").unwrap().as_deref(), Some("secret"));
        store.set("x", "secret2").unwrap();
        assert_eq!(store.get("x").unwrap().as_deref(), Some("secret2"));
        store.delete("x").unwrap();
        assert_eq!(store.get("x").unwrap(), None);
        store.delete("x").unwrap();
    }
}
