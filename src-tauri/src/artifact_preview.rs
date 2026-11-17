//! A dedicated origin for HTML artifact previews (#76, #82).
//!
//! A `srcdoc` frame inherits the app's CSP. Release builds add hashes to the
//! app's `script-src`, which turns its `'unsafe-inline'` off, so inline
//! scripts in a preview would not run. A loopback listener serves one fixed
//! bootstrap page with its own policy; the page receives the artifact by
//! `postMessage` and writes it into itself (`artifact_preview_bootstrap.html`).
//!
//! Why loopback HTTP and not an app URI scheme (#82): WKWebView exposes the
//! IPC message handler to every frame, and Tauri treats every URI scheme the
//! app registers as a *local* origin with the app's full capabilities. Then
//! only the invoke key stands between a preview and the app. A frame on
//! `http://127.0.0.1:<port>` is a *remote* origin: with no `remote`
//! capability, Tauri's ACL rejects every command from it, key or not.
//!
//! The listener is stateless and holds no secret: every `GET /frame` gets the
//! same page, no artifact content ever reaches Rust.
//! Threat model: docs/developer/artifact-preview.md.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::OnceLock;
use std::time::Duration;

/// Must match `PREVIEW_CSP` in `src/components/artifact-preview/sandbox.ts`
/// (a frontend test checks it), plus the `sandbox` directive: the document
/// gets an opaque origin even if the frame's `sandbox` attribute is missing.
pub const CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'; sandbox allow-scripts";

const BOOTSTRAP: &str = include_str!("artifact_preview_bootstrap.html");
const FRAME_PATH: &str = "/frame";
/// Longest request head we read; the page needs nothing from the request.
const MAX_REQUEST_HEAD: usize = 8 * 1024;

/// The HTTP response for one request line (`GET /frame HTTP/1.1`).
fn response(request_line: &str) -> Vec<u8> {
    let mut parts = request_line.split_whitespace();
    let (method, path) = (parts.next(), parts.next());
    let (status, body, headers) = match (method, path) {
        (Some("GET"), Some(FRAME_PATH)) => (
            "200 OK",
            BOOTSTRAP,
            format!(
                "Content-Type: text/html; charset=utf-8\r\n\
                 Content-Security-Policy: {CSP}\r\n\
                 Cache-Control: no-store\r\n\
                 X-Content-Type-Options: nosniff\r\n\
                 Referrer-Policy: no-referrer\r\n"
            ),
        ),
        _ => ("404 Not Found", "", String::new()),
    };
    format!(
        "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

fn serve(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let mut head = Vec::new();
    let mut buf = [0u8; 1024];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") && head.len() < MAX_REQUEST_HEAD {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => head.extend_from_slice(&buf[..n]),
        }
    }
    let head = String::from_utf8_lossy(&head);
    let _ = stream.write_all(&response(head.lines().next().unwrap_or_default()));
}

/// Binds `127.0.0.1` on a free port and serves the bootstrap page.
fn start() -> std::io::Result<String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let url = format!(
        "http://127.0.0.1:{}{FRAME_PATH}",
        listener.local_addr()?.port()
    );
    std::thread::Builder::new()
        .name("artifact-preview".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                std::thread::spawn(move || serve(stream));
            }
        })?;
    log::info!("Artifact preview origin: {url}");
    Ok(url)
}

/// URL of the preview frame; starts the listener on first use.
#[tauri::command]
pub fn get_artifact_frame_url() -> Result<String, String> {
    static URL: OnceLock<Result<String, String>> = OnceLock::new();
    URL.get_or_init(|| start().map_err(|e| format!("Artifact preview listener: {e}")))
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(url: &str) -> String {
        let rest = url.strip_prefix("http://").unwrap();
        let (host, path) = rest.split_once('/').unwrap();
        let mut stream = TcpStream::connect(host).unwrap();
        write!(stream, "GET /{path} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
        let mut out = String::new();
        stream.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn frame_is_sandboxed_offline_and_on_loopback() {
        let url = get_artifact_frame_url().unwrap();
        assert!(url.starts_with("http://127.0.0.1:"));
        assert!(url.ends_with("/frame"));
        // Same listener on every call.
        assert_eq!(get_artifact_frame_url().unwrap(), url);

        let response = get(&url);
        let (head, body) = response.split_once("\r\n\r\n").unwrap();
        assert!(head.starts_with("HTTP/1.1 200 OK"));
        assert!(head.contains("Content-Type: text/html; charset=utf-8"));
        let csp = head
            .lines()
            .find_map(|l| l.strip_prefix("Content-Security-Policy: "))
            .unwrap();
        assert!(csp.starts_with("default-src 'none';"));
        assert!(csp.ends_with("; sandbox allow-scripts"));
        assert!(!csp.contains("allow-same-origin"));
        assert!(!csp.contains("http"));
        assert!(body.contains("event.source !== parent"));
    }

    #[test]
    fn other_paths_and_methods_get_nothing() {
        let url = get_artifact_frame_url().unwrap();
        let other = url.replace("/frame", "/etc/passwd");
        assert!(get(&other).starts_with("HTTP/1.1 404"));
        assert!(response("POST /frame HTTP/1.1").starts_with(b"HTTP/1.1 404"));
        assert!(response("").starts_with(b"HTTP/1.1 404"));
    }

    // The mock-runtime tests need tauri's `test` feature, which is not built on
    // Windows (see Cargo.toml).
    #[cfg(not(windows))]
    #[tauri::command]
    fn ping() -> &'static str {
        "pong"
    }

    /// What Tauri does with an IPC message from a frame at `url`, even with
    /// the correct invoke key (a preview could reach `webkit.messageHandlers.ipc`).
    #[cfg(not(windows))]
    fn invoke_from(url: &str) -> Result<String, serde_json::Value> {
        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![ping])
            .register_uri_scheme_protocol("splitkick-artifact", |_ctx, _req| {
                tauri::http::Response::new(Vec::new())
            })
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "ping".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: url.parse().unwrap(),
                body: Default::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|body| body.deserialize::<String>().unwrap())
    }

    /// #82: the preview frame's origin must get no command, key or not.
    #[cfg(not(windows))]
    #[test]
    fn tauri_rejects_every_command_from_the_frame_origin() {
        let frame = get_artifact_frame_url().unwrap();
        let error = invoke_from(&frame).unwrap_err();
        assert!(error.to_string().contains("not allowed"), "{error}");

        // Control: the app's own origin gets the same command.
        assert_eq!(invoke_from("tauri://localhost").unwrap(), "pong");
        // Why an app URI scheme was not enough: Tauri treats it as local.
        assert_eq!(
            invoke_from("splitkick-artifact://localhost/frame").unwrap(),
            "pong"
        );
    }

    /// A `remote` capability would hand commands to remote origins again.
    #[test]
    fn no_capability_grants_remote_origins() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities");
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let json: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            assert!(
                json.get("remote").is_none(),
                "{} has `remote`",
                path.display()
            );
        }
    }
}
