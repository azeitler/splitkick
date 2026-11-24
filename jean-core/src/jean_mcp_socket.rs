//! Parent-side local socket for Jean MCP helpers.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::jean_mcp_core::{call_tool, extract_tool_call, jsonrpc_error, jsonrpc_ok, McpRole};

#[derive(Debug)]
pub struct JeanMcpSocketHandle {
    pub shutdown_tx: tokio::sync::oneshot::Sender<()>,
    pub path: PathBuf,
    pub token: String,
}

/// Socket name. Debug builds use their own name, so a dev build started with
/// the release config never takes over the installed app's socket.
const SOCKET_NAME: &str = if cfg!(debug_assertions) {
    "splitkick-mcp-dev"
} else {
    "splitkick-mcp"
};

/// File name before the rename. Release builds link it to the new socket, so
/// MCP entries installed in other tools (which hold the path) keep working.
#[cfg(unix)]
const LEGACY_SOCKET_FILE: &str = "jean-mcp.sock";

pub fn socket_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(platform_socket_path(&dir))
}

/// True when another running instance answers on `path`. Starting a server
/// there would delete its socket and cut off every session that uses it.
#[cfg(unix)]
pub fn is_served_elsewhere(path: &std::path::Path) -> bool {
    std::os::unix::net::UnixStream::connect(path).is_ok()
}

#[cfg(not(unix))]
pub fn is_served_elsewhere(_path: &std::path::Path) -> bool {
    false
}

#[cfg(unix)]
fn platform_socket_path(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join(format!("{SOCKET_NAME}.sock"))
}

/// Point the pre-rename file name at the socket. Release builds only.
#[cfg(unix)]
fn link_legacy_socket_name(path: &std::path::Path) {
    let file_name = format!("{SOCKET_NAME}.sock");
    if cfg!(debug_assertions) || path.file_name() != Some(std::ffi::OsStr::new(&file_name)) {
        return;
    }
    let Some(dir) = path.parent() else { return };
    let legacy = dir.join(LEGACY_SOCKET_FILE);
    let _ = std::fs::remove_file(&legacy);
    if let Err(e) = std::os::unix::fs::symlink(&file_name, &legacy) {
        log::warn!("Failed to link {}: {e}", legacy.display());
    }
}

#[cfg(windows)]
fn platform_socket_path(app_data_dir: &std::path::Path) -> PathBuf {
    windows_pipe_path_for_app_data(app_data_dir)
}

#[cfg(not(any(unix, windows)))]
fn platform_socket_path(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join(format!("{SOCKET_NAME}.sock"))
}

#[cfg(any(windows, test))]
fn windows_pipe_path_for_app_data(app_data_dir: &std::path::Path) -> PathBuf {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(app_data_dir.to_string_lossy().as_bytes());
    let digest = hasher.finalize();
    let suffix = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();

    PathBuf::from(format!(r"\\.\pipe\{SOCKET_NAME}-{suffix}"))
}

pub async fn get_socket_status(app: AppHandle) -> (bool, Option<String>, Option<String>) {
    match app.try_state::<Arc<Mutex<Option<JeanMcpSocketHandle>>>>() {
        Some(state) => {
            let guard = state.lock().await;
            match guard.as_ref() {
                Some(handle) => (
                    true,
                    Some(handle.path.to_string_lossy().to_string()),
                    Some(handle.token.clone()),
                ),
                None => (false, None, None),
            }
        }
        None => (false, None, None),
    }
}

#[cfg(unix)]
pub async fn start_socket_server(
    app: AppHandle,
    path: PathBuf,
    token: String,
) -> Result<JeanMcpSocketHandle, String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixListener;

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create Splitkick MCP socket dir: {e}"))?;
    }
    if path.exists() {
        let _ = tokio::fs::remove_file(&path).await;
    }

    let listener = UnixListener::bind(&path).map_err(|e| {
        format!(
            "Failed to bind Splitkick MCP socket {}: {e}",
            path.display()
        )
    })?;
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&path, perms)
            .map_err(|e| format!("Failed to lock down Splitkick MCP socket perms: {e}"))?;
    }
    link_legacy_socket_name(&path);
    // Remember which file is ours: after a restart in this process the new
    // server binds the same path before the old task exits.
    let own_inode = {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata(&path).map(|m| m.ino()).ok()
    };
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel();
    let path_for_task = path.clone();
    let token_for_task = token.clone();

    tokio::spawn(async move {
        log::info!(
            "Splitkick MCP proxy socket listening at {}",
            path_for_task.display()
        );
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    log::info!("Splitkick MCP proxy socket shutting down");
                    break;
                }
                accepted = listener.accept() => {
                    match accepted {
                        Ok((stream, _addr)) => {
                            let app = app.clone();
                            let expected_token = token_for_task.clone();
                            tokio::spawn(async move {
                                let (read_half, mut write_half) = stream.into_split();
                                let mut reader = BufReader::new(read_half);
                                let mut line = String::new();
                                let response = match tokio::time::timeout(
                                    std::time::Duration::from_secs(30),
                                    reader.read_line(&mut line),
                                )
                                .await
                                {
                                    Ok(Ok(0)) => json!({"error":"empty request"}),
                                    Ok(Ok(_)) => handle_socket_request(&app, &expected_token, &line).await,
                                    Ok(Err(e)) => json!({"error": format!("read failed: {e}")}),
                                    Err(_) => json!({"error":"read timeout"}),
                                };
                                if let Ok(encoded) = serde_json::to_string(&response) {
                                    let _ = write_half.write_all(encoded.as_bytes()).await;
                                    let _ = write_half.write_all(b"\n").await;
                                    let _ = write_half.flush().await;
                                }
                            });
                        }
                        Err(e) => log::warn!("Splitkick MCP socket accept failed: {e}"),
                    }
                }
            }
        }
        let still_ours = {
            use std::os::unix::fs::MetadataExt;
            std::fs::metadata(&path_for_task).map(|m| m.ino()).ok() == own_inode
        };
        if still_ours {
            let _ = tokio::fs::remove_file(&path_for_task).await;
        }
    });

    Ok(JeanMcpSocketHandle {
        shutdown_tx,
        path,
        token,
    })
}

#[cfg(windows)]
pub async fn start_socket_server(
    app: AppHandle,
    path: PathBuf,
    token: String,
) -> Result<JeanMcpSocketHandle, String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

    async fn handle_pipe_connection(
        app: AppHandle,
        expected_token: String,
        mut pipe: NamedPipeServer,
    ) {
        let mut line = String::new();
        let response = {
            let mut reader = BufReader::new(&mut pipe);
            match tokio::time::timeout(
                std::time::Duration::from_secs(30),
                reader.read_line(&mut line),
            )
            .await
            {
                Ok(Ok(0)) => json!({"error":"empty request"}),
                Ok(Ok(_)) => handle_socket_request(&app, &expected_token, &line).await,
                Ok(Err(e)) => json!({"error": format!("read failed: {e}")}),
                Err(_) => json!({"error":"read timeout"}),
            }
        };
        if let Ok(encoded) = serde_json::to_string(&response) {
            let _ = pipe.write_all(encoded.as_bytes()).await;
            let _ = pipe.write_all(b"\n").await;
            let _ = pipe.flush().await;
        }
    }

    let pipe_name = path.to_string_lossy().to_string();
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&pipe_name)
        .map_err(|e| format!("Failed to create Splitkick MCP named pipe {pipe_name}: {e}"))?;
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel();
    let path_for_task = path.clone();
    let token_for_task = token.clone();

    tokio::spawn(async move {
        log::info!("Splitkick MCP proxy named pipe listening at {pipe_name}");
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    log::info!("Splitkick MCP proxy named pipe shutting down");
                    break;
                }
                connected = server.connect() => {
                    match connected {
                        Ok(()) => {
                            let next_server = match ServerOptions::new().create(&pipe_name) {
                                Ok(next) => next,
                                Err(e) => {
                                    log::warn!("Splitkick MCP named pipe recreate failed: {e}");
                                    break;
                                }
                            };
                            let connected_server = std::mem::replace(&mut server, next_server);
                            let app = app.clone();
                            let expected_token = token_for_task.clone();
                            tokio::spawn(handle_pipe_connection(app, expected_token, connected_server));
                        }
                        Err(e) => log::warn!("Splitkick MCP named pipe accept failed: {e}"),
                    }
                }
            }
        }
    });

    Ok(JeanMcpSocketHandle {
        shutdown_tx,
        path: path_for_task,
        token,
    })
}

#[cfg(not(any(unix, windows)))]
pub async fn start_socket_server(
    _app: AppHandle,
    _path: PathBuf,
    _token: String,
) -> Result<JeanMcpSocketHandle, String> {
    Err("Splitkick MCP local IPC is not supported on this platform".to_string())
}

async fn handle_socket_request(app: &AppHandle, expected_token: &str, line: &str) -> Value {
    let body: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => return json!({"error": format!("invalid json: {e}")}),
    };
    let provided = body.get("token").and_then(|v| v.as_str()).unwrap_or("");
    if !crate::http_server::auth::validate_token(provided, expected_token) {
        return json!({"error":"unauthorized"});
    }

    let tool_call = match extract_tool_call(body.clone()) {
        Ok(tool_call) => tool_call,
        Err(e) => return jsonrpc_error(None, e.code, &e.message),
    };
    let source = body
        .get("source")
        .and_then(|v| v.as_str())
        .unwrap_or("anon");
    let depth = body.get("depth").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let role = match body.get("role").and_then(|v| v.as_str()) {
        Some("dialog") => McpRole::Dialog,
        _ => McpRole::Full,
    };

    match call_tool(
        app,
        &tool_call.name,
        tool_call.arguments,
        source,
        depth,
        role,
    )
    .await
    {
        Ok(result) => jsonrpc_ok(None, result),
        Err(e) => jsonrpc_error(None, e.code, &e.message),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    /// Drive one tool call over a real Unix socket, the way the stdio child
    /// talks to the running app. Covers the transport the MCP tools actually
    /// travel over, including the token check.
    #[cfg(unix)]
    #[test]
    fn a_tool_call_round_trips_over_the_local_socket() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        let temp = tempfile::tempdir().unwrap();
        let app = tauri::AppHandle::new(temp.path().into(), temp.path().into()).unwrap();
        let socket = temp.path().join("test-mcp.sock");

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();

        runtime.block_on(async {
            let handle = super::start_socket_server(app.clone(), socket.clone(), "secret".into())
                .await
                .expect("socket server");

            let ask = |token: &'static str| {
                let socket = socket.clone();
                async move {
                    let stream = tokio::net::UnixStream::connect(&socket).await.unwrap();
                    let (read_half, mut write_half) = stream.into_split();
                    let request = serde_json::json!({
                        "token": token,
                        "source": "anon",
                        "depth": 0,
                        "name": "list_all_sessions",
                        "arguments": {},
                    });
                    write_half
                        .write_all(format!("{request}\n").as_bytes())
                        .await
                        .unwrap();
                    write_half.shutdown().await.unwrap();

                    let mut line = String::new();
                    BufReader::new(read_half)
                        .read_line(&mut line)
                        .await
                        .unwrap();
                    serde_json::from_str::<serde_json::Value>(&line).unwrap()
                }
            };

            let ok = ask("secret").await;
            let text = ok["result"]["content"][0]["text"]
                .as_str()
                .unwrap_or_else(|| panic!("no content in {ok}"));
            let payload: serde_json::Value = serde_json::from_str(text).unwrap();
            assert!(payload["sessions"].is_array(), "{payload}");

            assert_eq!(ask("wrong").await["error"], "unauthorized");

            let _ = handle.shutdown_tx.send(());
        });
    }

    /// The dialog chain over the real transport: a `permission_prompt`
    /// request for a question arrives with the `dialog` role and is answered
    /// at once with deny + `interrupt`, which ends the CLI's turn there.
    #[cfg(unix)]
    #[test]
    fn a_question_ends_the_turn_over_the_local_socket() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        let temp = tempfile::tempdir().unwrap();
        let app = tauri::AppHandle::new(temp.path().into(), temp.path().into()).unwrap();
        let socket = temp.path().join("dialog-mcp.sock");

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();

        runtime.block_on(async {
            let handle = super::start_socket_server(app.clone(), socket.clone(), "secret".into())
                .await
                .expect("socket server");

            let request = serde_json::json!({
                "token": "secret",
                "source": "socket-dialog-session",
                "depth": 0,
                "role": "dialog",
                "name": "permission_prompt",
                "arguments": {
                    "tool_name": "AskUserQuestion",
                    "tool_use_id": "toolu_socket_dialog",
                    "input": {
                        "questions": [{
                            "question": "Which cache backend?",
                            "options": [{"label": "Redis"}, {"label": "Memcached"}],
                        }]
                    }
                },
            });

            let socket_for_call = socket.clone();
            let call = tokio::spawn(async move {
                let stream = tokio::net::UnixStream::connect(&socket_for_call)
                    .await
                    .unwrap();
                let (read_half, mut write_half) = stream.into_split();
                write_half
                    .write_all(format!("{request}\n").as_bytes())
                    .await
                    .unwrap();
                write_half.shutdown().await.unwrap();

                let mut line = String::new();
                BufReader::new(read_half)
                    .read_line(&mut line)
                    .await
                    .unwrap();
                serde_json::from_str::<serde_json::Value>(&line).unwrap()
            });

            let response = call.await.unwrap();
            let text = response["result"]["content"][0]["text"]
                .as_str()
                .unwrap_or_else(|| panic!("no content in {response}"));
            let payload: serde_json::Value = serde_json::from_str(text).unwrap();

            assert_eq!(payload["behavior"], "deny");
            assert_eq!(payload["interrupt"], true, "{payload}");

            let _ = handle.shutdown_tx.send(());
        });
    }

    /// The dialog role must work while the user-facing Jean MCP server is off,
    /// because `--permission-prompt-tool` naming an unresolvable tool kills the
    /// run with exit=1 at the first permission check.
    #[cfg(unix)]
    #[test]
    fn a_full_role_tool_is_refused_but_the_dialog_role_is_not() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        let temp = tempfile::tempdir().unwrap();
        let app = tauri::AppHandle::new(temp.path().into(), temp.path().into()).unwrap();
        let socket = temp.path().join("gated-mcp.sock");

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();

        runtime.block_on(async {
            let mut prefs = crate::load_preferences(app.clone()).await.unwrap();
            prefs.jean_mcp_enabled = false;
            crate::save_preferences(app.clone(), prefs).await.unwrap();

            let handle = super::start_socket_server(app.clone(), socket.clone(), "secret".into())
                .await
                .expect("socket server");

            let ask = |body: serde_json::Value| {
                let socket = socket.clone();
                async move {
                    let stream = tokio::net::UnixStream::connect(&socket).await.unwrap();
                    let (read_half, mut write_half) = stream.into_split();
                    write_half
                        .write_all(format!("{body}\n").as_bytes())
                        .await
                        .unwrap();
                    write_half.shutdown().await.unwrap();
                    let mut line = String::new();
                    BufReader::new(read_half)
                        .read_line(&mut line)
                        .await
                        .unwrap();
                    serde_json::from_str::<serde_json::Value>(&line).unwrap()
                }
            };

            let refused = ask(serde_json::json!({
                "token": "secret", "source": "anon", "depth": 0, "role": "full",
                "name": "list_all_sessions", "arguments": {},
            }))
            .await;
            assert!(
                refused["error"]["message"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("Splitkick MCP is disabled"),
                "{refused}"
            );

            // Same socket, dialog role: answered, not refused. A non-dialog tool
            // takes the plan-mode default arm rather than the preference gate.
            let allowed = ask(serde_json::json!({
                "token": "secret", "source": "anon", "depth": 0, "role": "dialog",
                "name": "permission_prompt",
                "arguments": {"tool_name": "Read", "input": {}},
            }))
            .await;
            let text = allowed["result"]["content"][0]["text"]
                .as_str()
                .unwrap_or_else(|| panic!("no content in {allowed}"));
            let payload: serde_json::Value = serde_json::from_str(text).unwrap();
            assert_eq!(payload["behavior"], "allow", "{payload}");

            let _ = handle.shutdown_tx.send(());
        });
    }

    /// The complete chain with the real Claude CLI, the real dialog shim and
    /// the real socket: a question ends the CLI's turn on its own (deny +
    /// `interrupt`), the run log readers see an open question and no error,
    /// and the answer reaches the model as the next message.
    ///
    /// Ignored by default: it needs the Claude CLI, network access, and the
    /// shim example built. Run it with
    ///
    /// ```text
    /// cargo build --example dialog_shim
    /// cargo test --lib real_claude_cli_ends_its_turn_at_a_question -- --ignored --nocapture
    /// ```
    #[cfg(unix)]
    #[test]
    #[ignore = "needs the Claude CLI, network, and `cargo build --example dialog_shim`"]
    fn real_claude_cli_ends_its_turn_at_a_question() {
        use std::io::Write;
        use std::process::{Command, Stdio};

        const SESSION: &str = "real-cli-verify-session";

        let cli = std::env::var("CLAUDE_CLI").unwrap_or_else(|_| {
            format!(
                "{}/Library/Application Support/app.splitkick.desktop/claude-cli/claude",
                std::env::var("HOME").unwrap()
            )
        });
        let shim = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/debug/examples/dialog_shim");
        assert!(
            shim.exists(),
            "build the shim first: cargo build --example dialog_shim"
        );

        let temp = tempfile::tempdir().unwrap();
        let app = tauri::AppHandle::new(temp.path().into(), temp.path().into()).unwrap();
        let socket = temp.path().join("real-cli.sock");

        // Exactly the entry `build_jean_dialog_mcp_entry` produces.
        let config = serde_json::json!({"mcpServers": {
            crate::chat::jean_mcp::JEAN_DIALOG_SERVER: {
                "type": "stdio",
                "command": shim,
                "args": [crate::jean_mcp_core::JEAN_MCP_STDIO_ARG, crate::jean_mcp_core::JEAN_MCP_DIALOG_ARG],
                "timeout": crate::chat::jean_mcp::DIALOG_TOOL_TIMEOUT_MS,
                "env": {
                    "JEAN_MCP_SOCKET": socket,
                    "JEAN_MCP_TOKEN": "verify-token",
                    "JEAN_MCP_SESSION": SESSION,
                    "JEAN_MCP_DEPTH": "0",
                }
            }
        }});
        // Same transport as production: a private file, not inline JSON (#102).
        let config_file = crate::chat::run_secrets::write_run_mcp_config(
            temp.path(),
            SESSION,
            &config.to_string(),
        )
        .unwrap();
        let config_path = config_file.path().to_string_lossy().to_string();

        // One turn of the CLI, as Jean spawns it. Returns the parsed stdout.
        let cwd = temp.path().to_path_buf();
        let run_turn = move |prompt: &str, resume: Option<String>| {
            let mut flags = vec![
                "--print".to_string(),
                "--output-format".into(),
                "stream-json".into(),
                "--input-format".into(),
                "stream-json".into(),
                "--verbose".into(),
                "--tools".into(),
                "default".into(),
                "--permission-mode".into(),
                "acceptEdits".into(),
                "--model".into(),
                "haiku".into(),
                "--mcp-config".into(),
                config_path.clone(),
                "--strict-mcp-config".into(),
                "--permission-prompt-tool".into(),
                crate::chat::jean_mcp::dialog_permission_prompt_tool(),
            ];
            if let Some(id) = resume {
                flags.extend(["--resume".to_string(), id]);
            }
            let mut child = Command::new(&cli)
                .args(&flags)
                .current_dir(&cwd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn claude");
            let prompt = serde_json::json!({"type": "user", "message": {"role": "user",
                "content": [{"type": "text", "text": prompt}]}});
            writeln!(child.stdin.take().unwrap(), "{prompt}").unwrap();
            let output = child.wait_with_output().expect("claude output");
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
                .collect::<Vec<_>>()
        };

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();

        runtime.block_on(async {
            let handle =
                super::start_socket_server(app.clone(), socket.clone(), "verify-token".into())
                    .await
                    .expect("socket server");

            let ask = run_turn.clone();
            let asked = tokio::task::spawn_blocking(move || {
                ask(
                    "Use the AskUserQuestion tool to ask me whether to use Redis or \
                     Memcached, then tell me what I picked. Do not touch the filesystem.",
                    None,
                )
            })
            .await
            .unwrap();

            // The CLI ended the turn on its own, at the question.
            let question = asked
                .iter()
                .filter(|d| d["type"] == "assistant")
                .flat_map(|d| {
                    d["message"]["content"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default()
                })
                .find(|b| b["name"] == "AskUserQuestion")
                .unwrap_or_else(|| panic!("no question asked:\n{asked:?}"));
            assert!(
                asked
                    .iter()
                    .any(crate::chat::claude::is_dialog_end_turn_result),
                "the CLI did not close the question as rejected:\n{asked:?}"
            );
            let result = asked
                .iter()
                .find(|d| d["type"] == "result")
                .expect("the CLI wrote no result");
            assert_eq!(crate::chat::claude::run_error_from_line(result), None);
            assert!(
                !asked.iter().any(|d| d["type"] == "assistant"
                    && d["message"]["content"]
                        .as_array()
                        .is_some_and(|c| c.iter().any(|b| b["type"] == "text"))),
                "the model went on after the question:\n{asked:?}"
            );

            // The answer resumes the session as a new message.
            let session_id = result["session_id"].as_str().unwrap().to_string();
            let text = question["input"]["questions"][0]["question"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            let answered = tokio::task::spawn_blocking(move || {
                run_turn(
                    &format!("Answer to your question \"{text}\": Memcached"),
                    Some(session_id),
                )
            })
            .await
            .unwrap();
            let _ = handle.shutdown_tx.send(());

            let reply = answered
                .iter()
                .find(|d| d["type"] == "result")
                .and_then(|d| d["result"].as_str())
                .unwrap_or_default()
                .to_string();
            assert!(
                reply.contains("Memcached"),
                "the answer never reached the model: {reply}"
            );
            println!("reply after the answer: {reply}");
        });
    }

    /// Tests build with debug assertions: the dev name, and no legacy link.
    #[cfg(unix)]
    #[test]
    fn dev_builds_use_a_suffixed_socket_name() {
        let dir = Path::new("/data");
        assert_eq!(
            super::platform_socket_path(dir),
            dir.join("splitkick-mcp-dev.sock")
        );

        let temp = tempfile::tempdir().unwrap();
        let socket = temp.path().join("splitkick-mcp-dev.sock");
        super::link_legacy_socket_name(&socket);
        assert!(!temp.path().join("jean-mcp.sock").exists());
    }

    /// A restart in the same app binds the path again before the old server
    /// task exits. The old task must leave the new socket alone, and a second
    /// instance must see that the socket is taken.
    #[cfg(unix)]
    #[test]
    fn a_restart_keeps_the_new_socket_and_others_see_it_taken() {
        let temp = tempfile::tempdir().unwrap();
        let app = tauri::AppHandle::new(temp.path().into(), temp.path().into()).unwrap();
        let socket = temp.path().join("splitkick-mcp-dev.sock");

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();

        runtime.block_on(async {
            assert!(!super::is_served_elsewhere(&socket));
            let first = super::start_socket_server(app.clone(), socket.clone(), "a".into())
                .await
                .expect("first server");
            assert!(super::is_served_elsewhere(&socket));

            // Worst case of a restart: the new server binds before the old
            // task has seen its shutdown signal.
            let second = super::start_socket_server(app.clone(), socket.clone(), "b".into())
                .await
                .expect("second server");
            let _ = first.shutdown_tx.send(());
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;

            assert!(socket.exists(), "the old task deleted the new socket");
            assert!(super::is_served_elsewhere(&socket));

            let _ = second.shutdown_tx.send(());
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            assert!(!socket.exists());
        });
    }

    #[test]
    fn windows_pipe_path_is_stable_and_named_pipe_safe() {
        let one =
            super::windows_pipe_path_for_app_data(Path::new(r"C:\Users\Ada\AppData\Roaming\Jean"));
        let two =
            super::windows_pipe_path_for_app_data(Path::new(r"C:\Users\Ada\AppData\Roaming\Jean"));
        let other = super::windows_pipe_path_for_app_data(Path::new(
            r"C:\Users\Ada\AppData\Roaming\JeanDev",
        ));

        assert_eq!(one, two);
        assert_ne!(one, other);
        // Tests build with debug assertions, so this is the dev name.
        assert!(one
            .to_string_lossy()
            .starts_with(r"\\.\pipe\splitkick-mcp-dev-"));
        assert!(!one.to_string_lossy().contains(':'));
    }
}
