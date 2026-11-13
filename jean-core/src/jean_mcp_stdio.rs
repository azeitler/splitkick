//! Stdio MCP transport for Jean.
//!
//! This process is launched by a local CLI as an MCP server. It proxies
//! tools/call requests over Jean-owned local IPC to the already
//! running desktop app, avoiding HTTP ports while preserving in-process app
//! command dispatch in the parent.

#[cfg(unix)]
use std::io::BufReader;
use std::io::{BufRead, Write};

use serde_json::{json, Value};

use crate::jean_mcp_core::{
    handle_protocol_message, jsonrpc_error, McpRole, ToolCallRequest, JEAN_MCP_DEPTH_ENV,
    JEAN_MCP_SESSION_ENV, JEAN_MCP_SOCKET_ENV, JEAN_MCP_TOKEN_ENV,
};

pub fn run_stdio_server() -> Result<(), String> {
    let role = McpRole::from_args(std::env::args().skip(1));
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let line = line.map_err(|e| format!("Failed to read stdin: {e}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let response = handle_message(&line, role);
        if let Some(response) = response {
            let encoded = serde_json::to_string(&response)
                .map_err(|e| format!("Failed to encode MCP response: {e}"))?;
            writeln!(stdout, "{encoded}").map_err(|e| format!("Failed to write stdout: {e}"))?;
            stdout
                .flush()
                .map_err(|e| format!("Failed to flush stdout: {e}"))?;
        }
    }

    Ok(())
}

fn handle_message(line: &str, role: McpRole) -> Option<Value> {
    let body: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => return Some(jsonrpc_error(None, -32700, &format!("Parse error: {e}"))),
    };

    handle_protocol_message(body, role, |tool_call| proxy_tool_call(tool_call, role))
}

fn proxy_tool_call(tool_call: ToolCallRequest, role: McpRole) -> Result<Value, String> {
    let socket =
        std::env::var(JEAN_MCP_SOCKET_ENV).map_err(|_| format!("Missing {JEAN_MCP_SOCKET_ENV}"))?;
    let token =
        std::env::var(JEAN_MCP_TOKEN_ENV).map_err(|_| format!("Missing {JEAN_MCP_TOKEN_ENV}"))?;
    let source = std::env::var(JEAN_MCP_SESSION_ENV).unwrap_or_else(|_| "anon".to_string());
    let depth = std::env::var(JEAN_MCP_DEPTH_ENV)
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

    proxy_to_parent(
        &socket,
        json!({
            "token": token,
            "source": source,
            "depth": depth,
            "role": match role {
                McpRole::Dialog => "dialog",
                McpRole::Full => "full",
            },
            "name": tool_call.name,
            "arguments": tool_call.arguments,
        }),
        // A dialog parks on a human. The full server's 120s ceiling would
        // abort the question long before anyone could answer it; the real
        // bound is the per-server `timeout` Jean sets on the MCP entry plus
        // the parent-side DIALOG_PARK_TIMEOUT.
        match role {
            McpRole::Dialog => None,
            McpRole::Full => Some(120),
        },
    )
}
#[cfg(unix)]
fn proxy_to_parent(
    socket: &str,
    request: Value,
    read_timeout_secs: Option<u64>,
) -> Result<Value, String> {
    use std::os::unix::net::UnixStream;
    use std::time::Duration;

    let mut stream = UnixStream::connect(socket)
        .map_err(|e| format!("Failed to connect Splitkick MCP socket {socket}: {e}"))?;
    stream
        .set_read_timeout(read_timeout_secs.map(Duration::from_secs))
        .map_err(|e| format!("Failed to set Splitkick MCP socket read timeout: {e}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| format!("Failed to set Splitkick MCP socket write timeout: {e}"))?;
    let encoded = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to encode Splitkick MCP socket request: {e}"))?;
    writeln!(stream, "{encoded}")
        .map_err(|e| format!("Failed to write Splitkick MCP socket: {e}"))?;
    stream
        .flush()
        .map_err(|e| format!("Failed to flush Splitkick MCP socket: {e}"))?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("Failed to read Splitkick MCP socket response: {e}"))?;
    let response: Value = serde_json::from_str(&line)
        .map_err(|e| format!("Failed to parse Splitkick MCP socket response: {e}"))?;
    if let Some(error) = parent_error_message(&response) {
        return Err(error);
    }
    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

#[cfg(windows)]
fn proxy_to_parent(
    socket: &str,
    request: Value,
    read_timeout_secs: Option<u64>,
) -> Result<Value, String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::windows::named_pipe::ClientOptions;
    use tokio::time::{timeout, Duration};

    let encoded = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to encode Splitkick MCP pipe request: {e}"))?;

    let response = run_pipe_io(async {
        let mut pipe = ClientOptions::new()
            .open(socket)
            .map_err(|e| format!("Failed to connect Splitkick MCP named pipe {socket}: {e}"))?;
        timeout(Duration::from_secs(30), async {
            pipe.write_all(encoded.as_bytes()).await?;
            pipe.write_all(b"\n").await?;
            pipe.flush().await
        })
        .await
        .map_err(|_| "Timed out writing Splitkick MCP pipe request".to_string())?
        .map_err(|e| format!("Failed to write Splitkick MCP pipe request: {e}"))?;

        let mut reader = BufReader::new(pipe);
        let mut line = String::new();
        match read_timeout_secs {
            Some(secs) => timeout(Duration::from_secs(secs), reader.read_line(&mut line))
                .await
                .map_err(|_| "Timed out reading Splitkick MCP pipe response".to_string())?
                .map_err(|e| format!("Failed to read Splitkick MCP pipe response: {e}"))?,
            // Dialogs park on a human; see the unix arm.
            None => reader
                .read_line(&mut line)
                .await
                .map_err(|e| format!("Failed to read Splitkick MCP pipe response: {e}"))?,
        };

        serde_json::from_str::<Value>(&line)
            .map_err(|e| format!("Failed to parse Splitkick MCP pipe response: {e}"))
    })?;

    if let Some(error) = parent_error_message(&response) {
        return Err(error);
    }
    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

/// Run the named-pipe I/O to completion on a runtime of its own.
///
/// On a thread of its own, too: `run_server()` serves `--jean-mcp-stdio` from
/// inside its tokio runtime, and a nested `block_on` on that thread panics.
/// The panic killed the dialog child at its first tool call, and Claude
/// reported "Connection closed" for every AskUserQuestion on Windows (#139).
#[cfg(any(windows, test))]
fn run_pipe_io<T: Send>(
    future: impl std::future::Future<Output = Result<T, String>> + Send,
) -> Result<T, String> {
    std::thread::scope(|scope| {
        scope
            .spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_io()
                    .enable_time()
                    .build()
                    .map_err(|e| format!("Failed to create Splitkick MCP pipe runtime: {e}"))?
                    .block_on(future)
            })
            .join()
            .map_err(|_| "Splitkick MCP pipe thread panicked".to_string())?
    })
}

#[cfg(not(any(unix, windows)))]
fn proxy_to_parent(
    _socket: &str,
    _request: Value,
    _read_timeout_secs: Option<u64>,
) -> Result<Value, String> {
    Err("Splitkick MCP local IPC is not supported on this platform".to_string())
}

fn parent_error_message(response: &Value) -> Option<String> {
    match response.get("error") {
        Some(Value::String(message)) => Some(message.clone()),
        Some(Value::Object(error)) => error
            .get("message")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| Some(Value::Object(error.clone()).to_string())),
        Some(other) => Some(other.to_string()),
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{parent_error_message, run_pipe_io};

    /// `run_server()` serves `--jean-mcp-stdio` from inside its own
    /// `block_on`, so the pipe I/O starts within a tokio runtime. A nested
    /// `block_on` there panics, the dialog child dies at its first tool call,
    /// and Claude reports "Connection closed" for every AskUserQuestion on
    /// Windows (issue #139).
    #[test]
    fn pipe_io_runs_inside_the_server_runtime() {
        let server = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = server.block_on(async {
            run_pipe_io(async {
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
                Ok::<_, String>(7)
            })
        });
        assert_eq!(result, Ok(7));
    }

    /// The real Windows path: a dialog tool call proxied over a named pipe
    /// from inside the server runtime, as `run_server()` runs it (#139).
    #[cfg(windows)]
    #[test]
    fn dialog_call_reaches_the_parent_pipe_from_the_server_runtime() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        use tokio::net::windows::named_pipe::ServerOptions;

        let pid = std::process::id();
        let pipe_name = format!(r"\\.\pipe\splitkick-test-139-{pid}");
        let server = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = server.block_on(async {
            let mut pipe = ServerOptions::new()
                .first_pipe_instance(true)
                .create(&pipe_name)
                .unwrap();
            let parent = tokio::spawn(async move {
                pipe.connect().await.unwrap();
                let mut line = String::new();
                BufReader::new(&mut pipe)
                    .read_line(&mut line)
                    .await
                    .unwrap();
                let request: serde_json::Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["role"], "dialog");
                pipe.write_all(b"{\"result\":{\"behavior\":\"allow\"}}\n")
                    .await
                    .unwrap();
                pipe.flush().await.unwrap();
            });
            let result = super::proxy_to_parent(&pipe_name, json!({"role": "dialog"}), None);
            parent.await.unwrap();
            result
        });
        assert_eq!(result, Ok(json!({"behavior": "allow"})));
    }

    #[test]
    fn parent_error_message_handles_plain_error_string() {
        assert_eq!(
            parent_error_message(&json!({"error": "unauthorized"})),
            Some("unauthorized".to_string())
        );
    }

    #[test]
    fn parent_error_message_handles_jsonrpc_error_object() {
        assert_eq!(
            parent_error_message(&json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32000, "message": "No Jean session context present" }
            })),
            Some("No Jean session context present".to_string())
        );
    }
}
