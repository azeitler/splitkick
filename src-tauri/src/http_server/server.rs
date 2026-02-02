use axum::{
    extract::{ws::WebSocketUpgrade, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use super::auth;
use super::websocket::handle_ws_connection;
use super::WsBroadcaster;

/// Shared state for the Axum server.
#[derive(Clone)]
struct AppState {
    app: AppHandle,
    token: String,
}

/// Server handle for shutdown coordination.
pub struct HttpServerHandle {
    pub shutdown_tx: tokio::sync::oneshot::Sender<()>,
    pub port: u16,
    pub token: String,
    pub url: String,
}

/// Status response for the HTTP server.
#[derive(Serialize, Clone)]
pub struct ServerStatus {
    pub running: bool,
    pub url: Option<String>,
    pub token: Option<String>,
    pub port: Option<u16>,
}

#[derive(Deserialize)]
struct WsAuth {
    token: Option<String>,
}

/// Resolve the dist directory path at runtime.
/// Checks multiple locations for development and production scenarios.
fn resolve_dist_path(app: &AppHandle) -> std::path::PathBuf {
    // 1. Check if app has a resource dir with dist/
    if let Ok(resource_dir) = app.path().resource_dir() {
        let dist = resource_dir.join("dist");
        if dist.exists() && dist.join("index.html").exists() {
            log::info!("Serving frontend from resource dir: {}", dist.display());
            return dist;
        }
    }

    // 2. Development: relative to cargo manifest dir
    let dev_dist = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if dev_dist.exists() && dev_dist.join("index.html").exists() {
        log::info!("Serving frontend from dev dist: {}", dev_dist.display());
        return dev_dist;
    }

    // 3. Fallback: relative to executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let dist = parent.join("dist");
            if dist.exists() && dist.join("index.html").exists() {
                log::info!("Serving frontend from exe-relative dist: {}", dist.display());
                return dist;
            }
        }
    }

    // Last resort: return dev path even if it doesn't exist yet
    log::warn!("No dist directory found with index.html, using dev path: {}", dev_dist.display());
    dev_dist
}

/// Start the HTTP + WebSocket server.
pub async fn start_server(
    app: AppHandle,
    port: u16,
    token: String,
) -> Result<HttpServerHandle, String> {
    let state = AppState {
        app: app.clone(),
        token: token.clone(),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Resolve the dist directory at runtime for static file serving
    let dist_path = resolve_dist_path(&app);
    let index_path = dist_path.join("index.html");

    let serve_dir = ServeDir::new(&dist_path)
        .append_index_html_on_directories(true)
        .fallback(ServeFile::new(&index_path));

    let router = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/auth", get(auth_handler))
        .fallback_service(serve_dir)
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind to port {port}: {e}"))?;

    let local_addr = listener.local_addr()
        .map_err(|e| format!("Failed to get local address: {e}"))?;

    // Get LAN IP for the URL
    let ip = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let url = format!("http://{ip}:{}", local_addr.port());

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();

    // Spawn the server
    tokio::spawn(async move {
        log::info!("HTTP server listening on {local_addr}");
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
                log::info!("HTTP server shutting down");
            })
            .await
            .unwrap_or_else(|e| log::error!("HTTP server error: {e}"));
    });

    Ok(HttpServerHandle {
        shutdown_tx,
        port: local_addr.port(),
        token,
        url,
    })
}

/// WebSocket upgrade handler with token auth.
async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsAuth>,
    State(state): State<AppState>,
) -> Response {
    // Validate token
    let provided = params.token.unwrap_or_default();
    if !auth::validate_token(&provided, &state.token) {
        return (StatusCode::UNAUTHORIZED, "Invalid token").into_response();
    }

    // Get broadcast receiver for this client
    let broadcaster = state.app.try_state::<WsBroadcaster>();
    let event_rx = match broadcaster {
        Some(b) => b.subscribe(),
        None => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Server not initialized").into_response();
        }
    };

    let app = state.app.clone();
    ws.on_upgrade(move |socket| handle_ws_connection(socket, app, event_rx))
}

/// Token validation endpoint. Returns 200 with { ok: true } on success,
/// or 401 with { ok: false, error: "..." } on failure.
async fn auth_handler(
    Query(params): Query<WsAuth>,
    State(state): State<AppState>,
) -> Response {
    let provided = params.token.unwrap_or_default();
    if auth::validate_token(&provided, &state.token) {
        Json(serde_json::json!({ "ok": true })).into_response()
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "ok": false, "error": "Invalid token" })),
        )
            .into_response()
    }
}

/// Get the local LAN IP address.
fn get_local_ip() -> Option<String> {
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

/// Get current server status. Called from dispatch.
pub async fn get_server_status(app: AppHandle) -> ServerStatus {
    match app.try_state::<Arc<Mutex<Option<HttpServerHandle>>>>() {
        Some(handle_state) => {
            let handle = handle_state.lock().await;
            match handle.as_ref() {
                Some(h) => ServerStatus {
                    running: true,
                    url: Some(h.url.clone()),
                    token: Some(h.token.clone()),
                    port: Some(h.port),
                },
                None => ServerStatus {
                    running: false,
                    url: None,
                    token: None,
                    port: None,
                },
            }
        }
        None => ServerStatus {
            running: false,
            url: None,
            token: None,
            port: None,
        },
    }
}
