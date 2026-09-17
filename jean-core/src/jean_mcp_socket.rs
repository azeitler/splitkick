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

pub fn socket_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(platform_socket_path(&dir))
}

#[cfg(unix)]
fn platform_socket_path(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("jean-mcp.sock")
}

#[cfg(windows)]
fn platform_socket_path(app_data_dir: &std::path::Path) -> PathBuf {
    windows_pipe_path_for_app_data(app_data_dir)
}

#[cfg(not(any(unix, windows)))]
fn platform_socket_path(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("jean-mcp.sock")
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

    PathBuf::from(format!(r"\\.\pipe\jean-mcp-{suffix}"))
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
            .map_err(|e| format!("Failed to create Jean MCP socket dir: {e}"))?;
    }
    if path.exists() {
        let _ = tokio::fs::remove_file(&path).await;
    }

    let listener = UnixListener::bind(&path)
        .map_err(|e| format!("Failed to bind Jean MCP socket {}: {e}", path.display()))?;
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&path, perms)
            .map_err(|e| format!("Failed to lock down Jean MCP socket perms: {e}"))?;
    }
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel();
    let path_for_task = path.clone();
    let token_for_task = token.clone();

    tokio::spawn(async move {
        log::info!(
            "Jean MCP proxy socket listening at {}",
            path_for_task.display()
        );
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    log::info!("Jean MCP proxy socket shutting down");
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
                        Err(e) => log::warn!("Jean MCP socket accept failed: {e}"),
                    }
                }
            }
        }
        let _ = tokio::fs::remove_file(&path_for_task).await;
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
        .map_err(|e| format!("Failed to create Jean MCP named pipe {pipe_name}: {e}"))?;
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel();
    let path_for_task = path.clone();
    let token_for_task = token.clone();

    tokio::spawn(async move {
        log::info!("Jean MCP proxy named pipe listening at {pipe_name}");
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    log::info!("Jean MCP proxy named pipe shutting down");
                    break;
                }
                connected = server.connect() => {
                    match connected {
                        Ok(()) => {
                            let next_server = match ServerOptions::new().create(&pipe_name) {
                                Ok(next) => next,
                                Err(e) => {
                                    log::warn!("Jean MCP named pipe recreate failed: {e}");
                                    break;
                                }
                            };
                            let connected_server = std::mem::replace(&mut server, next_server);
                            let app = app.clone();
                            let expected_token = token_for_task.clone();
                            tokio::spawn(handle_pipe_connection(app, expected_token, connected_server));
                        }
                        Err(e) => log::warn!("Jean MCP named pipe accept failed: {e}"),
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
    Err("Jean MCP local IPC is not supported on this platform".to_string())
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

    /// The whole dialog chain over the real transport: a `permission_prompt`
    /// request arrives with the `dialog` role, parks, the UI answers it, and
    /// the answers come back spliced into `updatedInput` — which is how they
    /// reach the model, since AskUserQuestion's `call()` just echoes its input.
    #[cfg(unix)]
    #[test]
    fn a_parked_question_is_answered_over_the_local_socket() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        use crate::chat::claude_dialog::{self, DialogOutcome};

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

            // Wait for the call to actually park before answering it.
            for _ in 0..200 {
                if claude_dialog::is_parked("toolu_socket_dialog") {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
            assert!(
                claude_dialog::is_parked("toolu_socket_dialog"),
                "the permission_prompt call should have parked"
            );

            assert!(claude_dialog::resolve(
                "toolu_socket_dialog",
                DialogOutcome::Answered {
                    answers: serde_json::json!({"Which cache backend?": "Memcached"}),
                    response: None,
                },
            ));

            let response = call.await.unwrap();
            let text = response["result"]["content"][0]["text"]
                .as_str()
                .unwrap_or_else(|| panic!("no content in {response}"));
            let payload: serde_json::Value = serde_json::from_str(text).unwrap();

            assert_eq!(payload["behavior"], "allow");
            assert_eq!(
                payload["updatedInput"]["answers"]["Which cache backend?"],
                "Memcached"
            );
            // The questions must survive: the tool echoes both back to the model.
            assert!(payload["updatedInput"]["questions"].is_array(), "{payload}");

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
                    .contains("Jean MCP is disabled"),
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

    /// The complete chain, with no stand-ins except the human: the real Claude
    /// CLI, the real Jean dialog shim, the real socket, `permission_prompt`,
    /// park, resolve — and the answer reaching the model.
    ///
    /// Ignored by default: it needs the Claude CLI, network access, and the
    /// shim example built. Run it with
    ///
    /// ```text
    /// cargo build --example dialog_shim
    /// cargo test --lib real_claude_cli_round_trips_a_question -- --ignored --nocapture
    /// ```
    ///
    /// Answers with a freeform `response`, which AskUserQuestion renders as
    /// "The user responded: …" without needing the model-generated question
    /// text as a key. Answer-key splicing is covered by
    /// `a_parked_question_is_answered_over_the_local_socket`.
    #[cfg(unix)]
    #[test]
    #[ignore = "needs the Claude CLI, network, and `cargo build --example dialog_shim`"]
    fn real_claude_cli_round_trips_a_question() {
        use std::io::Write;
        use std::process::{Command, Stdio};

        use crate::chat::claude_dialog::{self, DialogOutcome};

        const SESSION: &str = "real-cli-verify-session";
        const PARK_SECS: u64 = 45;

        let cli = std::env::var("CLAUDE_CLI").unwrap_or_else(|_| {
            format!(
                "{}/Library/Application Support/com.jean.desktop/claude-cli/claude",
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
                "timeout": 1_800_000,
                "env": {
                    "JEAN_MCP_SOCKET": socket,
                    "JEAN_MCP_TOKEN": "verify-token",
                    "JEAN_MCP_SESSION": SESSION,
                    "JEAN_MCP_DEPTH": "0",
                }
            }
        }});

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();

        runtime.block_on(async {
            let handle =
                super::start_socket_server(app.clone(), socket.clone(), "verify-token".into())
                    .await
                    .expect("socket server");

            // The human: waits well past the old 120s-capped read and the CLI's
            // default idle abort would allow for a silent call, then answers.
            let answered_at = tokio::spawn(async {
                tokio::time::sleep(std::time::Duration::from_secs(PARK_SECS)).await;
                let start = std::time::Instant::now();
                loop {
                    let n = claude_dialog::resolve_session(
                        SESSION,
                        DialogOutcome::Answered {
                            answers: serde_json::json!({}),
                            response: Some("Memcached".to_string()),
                        },
                    );
                    if n > 0 {
                        return Some(n);
                    }
                    if start.elapsed() > std::time::Duration::from_secs(180) {
                        return None;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
            });

            let flags = vec![
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
                config.to_string(),
                "--strict-mcp-config".into(),
                "--permission-prompt-tool".into(),
                crate::chat::jean_mcp::dialog_permission_prompt_tool(),
            ];
            let output = tokio::task::spawn_blocking(move || {
                let mut child = Command::new(&cli)
                    .args(&flags)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                    .expect("spawn claude");
                let prompt = serde_json::json!({"type": "user", "message": {"role": "user",
                    "content": [{"type": "text", "text":
                        "Use the AskUserQuestion tool to ask me whether to use Redis or \
                         Memcached, then tell me what I picked. Do not touch the filesystem."}]}});
                writeln!(child.stdin.take().unwrap(), "{prompt}").unwrap();
                child.wait_with_output().expect("claude output")
            })
            .await
            .unwrap();

            let resolved = answered_at.await.unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout);
            let _ = handle.shutdown_tx.send(());

            assert!(
                output.status.success(),
                "claude exited {:?}\n{}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            );
            assert_eq!(resolved, Some(1), "no dialog ever parked for {SESSION}");

            let init_has_tool = stdout
                .lines()
                .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
                .find(|d| d["type"] == "system" && d["subtype"] == "init")
                .and_then(|d| d["tools"].as_array().cloned())
                .map(|t| t.iter().any(|x| x == "AskUserQuestion"))
                .unwrap_or(false);
            assert!(
                init_has_tool,
                "AskUserQuestion missing from the init tool list"
            );

            assert!(
                stdout.contains("The user responded: Memcached"),
                "the answer never reached the model:\n{stdout}"
            );
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
        assert!(one.to_string_lossy().starts_with(r"\\.\pipe\jean-mcp-"));
        assert!(!one.to_string_lossy().contains(':'));
    }
}
