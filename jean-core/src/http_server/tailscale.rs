//! Tailscale detection for Settings → Web Access (#151).
//!
//! Reads `tailscale status --json` and `tailscale serve status --json` and
//! reports the tailnet, this machine's MagicDNS name, and whether the web
//! access server is published through `tailscale serve`. Every failure
//! degrades to "not installed" / "not running": this is information only and
//! must never block the pane.
//!
//! JSON shapes (Tailscale 1.104): `status` has `BackendState`,
//! `MagicDNSSuffix`, `CurrentTailnet {Name, MagicDNSSuffix, MagicDNSEnabled}`
//! and `Self {DNSName, TailscaleIPs}`. `serve status` is the `ipn.ServeConfig`:
//! `TCP {"<port>": {HTTPS|HTTP}}`, `Web {"<host>:<port>": {Handlers {"<path>":
//! {Proxy}}}}`, `AllowFunnel {"<host>:<port>": true}`, and `Foreground` with
//! one nested ServeConfig per foreground `tailscale serve` session.

use std::path::PathBuf;
use std::process::{Output, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::platform::{find_cli_in_host_path, silent_command};

const CLI_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleInfo {
    pub installed: bool,
    pub running: bool,
    /// Tailnet DNS name, e.g. `tail1234.ts.net`.
    pub tailnet_name: Option<String>,
    pub magic_dns_enabled: bool,
    /// This machine's MagicDNS name without the trailing dot.
    pub dns_name: Option<String>,
    pub ips: Vec<String>,
    pub serves: Vec<TailscaleServe>,
    /// Web access port the serves were matched against.
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleServe {
    pub url: String,
    pub proxy_target: String,
    pub serves_splitkick: bool,
    pub funnel: bool,
}

/// Parse `tailscale status --json`. `None` when the output is not JSON.
pub fn parse_status(json: &str, port: u16) -> Option<TailscaleInfo> {
    let v: Value = serde_json::from_str(json).ok()?;
    let running = v.get("BackendState").and_then(Value::as_str) == Some("Running");
    let tailnet = v.get("CurrentTailnet");
    let tailnet_name = non_empty(v.get("MagicDNSSuffix"))
        .or_else(|| tailnet.and_then(|t| non_empty(t.get("MagicDNSSuffix"))));
    let magic_dns_enabled = tailnet
        .and_then(|t| t.get("MagicDNSEnabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let me = v.get("Self");
    let dns_name = me
        .and_then(|s| non_empty(s.get("DNSName")))
        .map(|name| name.trim_end_matches('.').to_string())
        .filter(|name| !name.is_empty());
    let ips = me
        .and_then(|s| s.get("TailscaleIPs"))
        .and_then(Value::as_array)
        .map(|ips| {
            ips.iter()
                .filter_map(|ip| ip.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    Some(TailscaleInfo {
        installed: true,
        running,
        tailnet_name,
        magic_dns_enabled,
        dns_name,
        ips,
        serves: Vec::new(),
        port,
    })
}

/// Parse `tailscale serve status --json` into one entry per proxy handler.
pub fn parse_serve_status(json: &str, port: u16) -> Vec<TailscaleServe> {
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return Vec::new();
    };
    let mut serves = Vec::new();
    collect_serves(&v, port, &mut serves);
    if let Some(foreground) = v.get("Foreground").and_then(Value::as_object) {
        for config in foreground.values() {
            collect_serves(config, port, &mut serves);
        }
    }
    serves
}

fn collect_serves(config: &Value, port: u16, out: &mut Vec<TailscaleServe>) {
    let Some(web) = config.get("Web").and_then(Value::as_object) else {
        return;
    };
    for (host_port, server) in web {
        let (host, listen_port) = match host_port.rsplit_once(':') {
            Some((host, p)) => (host, p),
            None => (host_port.as_str(), "443"),
        };
        let tcp = config.get("TCP").and_then(|tcp| tcp.get(listen_port));
        let plain_http = tcp.and_then(|t| t.get("HTTP")).and_then(Value::as_bool) == Some(true)
            && tcp.and_then(|t| t.get("HTTPS")).and_then(Value::as_bool) != Some(true);
        let scheme = if plain_http { "http" } else { "https" };
        let default_port = if plain_http { "80" } else { "443" };
        let base = if listen_port == default_port {
            format!("{scheme}://{host}")
        } else {
            format!("{scheme}://{host}:{listen_port}")
        };
        let funnel = config
            .get("AllowFunnel")
            .and_then(|f| f.get(host_port))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let Some(handlers) = server.get("Handlers").and_then(Value::as_object) else {
            continue;
        };
        for (path, handler) in handlers {
            let Some(proxy) = non_empty(handler.get("Proxy")) else {
                continue;
            };
            let url = if path == "/" || path.is_empty() {
                base.clone()
            } else {
                format!("{base}{path}")
            };
            out.push(TailscaleServe {
                url,
                serves_splitkick: proxy_targets_local_port(&proxy, port),
                proxy_target: proxy,
                funnel,
            });
        }
    }
}

/// True when a `Proxy` target is localhost / 127.0.0.1 / [::1] on `port`.
/// Accepts `http://host:port/path`, `https+insecure://host:port` and a bare
/// `host:port`.
pub fn proxy_targets_local_port(proxy: &str, port: u16) -> bool {
    let rest = proxy.split_once("://").map_or(proxy, |(_, rest)| rest);
    let authority = rest.split('/').next().unwrap_or("");
    let (host, target_port) = if let Some(v6) = authority.strip_prefix('[') {
        match v6.split_once("]:") {
            Some((host, p)) => (host, p),
            None => return false,
        }
    } else {
        match authority.rsplit_once(':') {
            Some((host, p)) => (host, p),
            None => return false,
        }
    };
    let local = matches!(
        host.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1"
    );
    local && target_port.parse::<u16>().ok() == Some(port)
}

fn non_empty(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn tailscale_binary() -> Option<PathBuf> {
    // On macOS the PATH entry is often a shell wrapper around the app binary.
    #[cfg(target_os = "macos")]
    {
        let bundled = PathBuf::from("/Applications/Tailscale.app/Contents/MacOS/tailscale");
        if bundled.exists() {
            return Some(bundled);
        }
    }
    if let Some(path) = find_cli_in_host_path("tailscale", None) {
        return Some(path);
    }
    #[cfg(windows)]
    {
        let installed = PathBuf::from(r"C:\Program Files\Tailscale\tailscale.exe");
        if installed.exists() {
            return Some(installed);
        }
    }
    None
}

fn run_with_timeout(binary: &PathBuf, args: &[&str]) -> Option<Output> {
    let mut child = silent_command(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + CLI_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// Blocking: query the local Tailscale CLI. Never fails.
pub fn detect(port: u16) -> TailscaleInfo {
    let not_installed = TailscaleInfo {
        port,
        ..TailscaleInfo::default()
    };
    let Some(binary) = tailscale_binary() else {
        return not_installed;
    };
    // `status --json` prints JSON also when the backend is stopped; a failed
    // or unreadable call means the daemon is not reachable.
    let status = run_with_timeout(&binary, &["status", "--json"])
        .and_then(|out| parse_status(&String::from_utf8_lossy(&out.stdout), port));
    let Some(mut info) = status else {
        return TailscaleInfo {
            installed: true,
            ..not_installed
        };
    };
    if info.running {
        if let Some(out) = run_with_timeout(&binary, &["serve", "status", "--json"]) {
            info.serves = parse_serve_status(&String::from_utf8_lossy(&out.stdout), port);
        }
    }
    info
}

/// The web access port: the running server's port, else the configured one.
async fn web_access_port(app: &AppHandle) -> u16 {
    if let Some(port) = super::server::get_server_status(app.clone()).await.port {
        return port;
    }
    crate::load_preferences_sync(app)
        .map(|prefs| prefs.http_server_port)
        .unwrap_or(crate::brand::DEFAULT_HTTP_PORT)
}

pub async fn get_tailscale_info(app: AppHandle) -> TailscaleInfo {
    let port = web_access_port(&app).await;
    tokio::task::spawn_blocking(move || detect(port))
        .await
        .unwrap_or(TailscaleInfo {
            port,
            ..TailscaleInfo::default()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUNNING: &str = r#"{
        "BackendState": "Running",
        "MagicDNSSuffix": "tail1234.ts.net",
        "CurrentTailnet": {"Name": "acme.example", "MagicDNSSuffix": "tail1234.ts.net", "MagicDNSEnabled": true},
        "Self": {"DNSName": "box.tail1234.ts.net.", "HostName": "box", "TailscaleIPs": ["100.64.0.1", "fd7a:115c:a1e0::1"], "Online": true}
    }"#;

    #[test]
    fn parses_running_status() {
        let info = parse_status(RUNNING, 3456).unwrap();
        assert!(info.installed && info.running && info.magic_dns_enabled);
        assert_eq!(info.tailnet_name.as_deref(), Some("tail1234.ts.net"));
        assert_eq!(info.dns_name.as_deref(), Some("box.tail1234.ts.net"));
        assert_eq!(info.ips, vec!["100.64.0.1", "fd7a:115c:a1e0::1"]);
        assert_eq!(info.port, 3456);
    }

    #[test]
    fn stopped_backend_is_not_running() {
        let json = r#"{"BackendState": "Stopped", "MagicDNSSuffix": "", "CurrentTailnet": null, "Self": {"DNSName": "", "TailscaleIPs": null}}"#;
        let info = parse_status(json, 3456).unwrap();
        assert!(info.installed);
        assert!(!info.running);
        assert_eq!(info.dns_name, None);
        assert_eq!(info.tailnet_name, None);
        assert!(info.ips.is_empty());
    }

    #[test]
    fn magic_dns_off() {
        let json = r#"{"BackendState": "Running", "MagicDNSSuffix": "tail1234.ts.net",
            "CurrentTailnet": {"MagicDNSSuffix": "tail1234.ts.net", "MagicDNSEnabled": false},
            "Self": {"DNSName": "box.tail1234.ts.net.", "TailscaleIPs": ["100.64.0.1"]}}"#;
        let info = parse_status(json, 3456).unwrap();
        assert!(info.running);
        assert!(!info.magic_dns_enabled);
        assert_eq!(info.dns_name.as_deref(), Some("box.tail1234.ts.net"));
    }

    #[test]
    fn not_json_is_none() {
        assert_eq!(
            parse_status("failed to connect to local tailscaled", 3456),
            None
        );
        assert!(parse_serve_status("No serve config", 3456).is_empty());
        assert!(parse_serve_status("{}", 3456).is_empty());
    }

    #[test]
    fn served_on_our_port() {
        let json = r#"{"TCP": {"443": {"HTTPS": true}},
            "Web": {"box.tail1234.ts.net:443": {"Handlers": {"/": {"Proxy": "http://localhost:3456"}}}}}"#;
        let serves = parse_serve_status(json, 3456);
        assert_eq!(
            serves,
            vec![TailscaleServe {
                url: "https://box.tail1234.ts.net".to_string(),
                proxy_target: "http://localhost:3456".to_string(),
                serves_splitkick: true,
                funnel: false,
            }]
        );
    }

    #[test]
    fn served_on_other_port() {
        let json = r#"{"TCP": {"8443": {"HTTPS": true}},
            "Web": {"box.tail1234.ts.net:8443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:5173"}}}}}"#;
        let serves = parse_serve_status(json, 3456);
        assert_eq!(serves.len(), 1);
        assert_eq!(serves[0].url, "https://box.tail1234.ts.net:8443");
        assert!(!serves[0].serves_splitkick);
    }

    #[test]
    fn funnel_is_flagged() {
        let json = r#"{"TCP": {"443": {"HTTPS": true}},
            "Web": {"box.tail1234.ts.net:443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:3456"}}}},
            "AllowFunnel": {"box.tail1234.ts.net:443": true}}"#;
        let serves = parse_serve_status(json, 3456);
        assert!(serves[0].funnel && serves[0].serves_splitkick);
    }

    #[test]
    fn path_handlers_and_non_proxy_handlers() {
        let json = r#"{"TCP": {"443": {"HTTPS": true}},
            "Web": {"box.tail1234.ts.net:443": {"Handlers": {
                "/splitkick": {"Proxy": "http://[::1]:3456"},
                "/docs": {"Path": "/srv/docs"},
                "/hello": {"Text": "hi"}
            }}}}"#;
        let serves = parse_serve_status(json, 3456);
        assert_eq!(serves.len(), 1);
        assert_eq!(serves[0].url, "https://box.tail1234.ts.net/splitkick");
        assert!(serves[0].serves_splitkick);
    }

    #[test]
    fn foreground_sessions_and_plain_http() {
        let json = r#"{"Foreground": {"abc123": {
            "TCP": {"80": {"HTTP": true}},
            "Web": {"box.tail1234.ts.net:80": {"Handlers": {"/": {"Proxy": "http://localhost:3456"}}}}
        }}}"#;
        let serves = parse_serve_status(json, 3456);
        assert_eq!(serves.len(), 1);
        assert_eq!(serves[0].url, "http://box.tail1234.ts.net");
        assert!(serves[0].serves_splitkick);
    }

    #[test]
    fn proxy_target_matching() {
        assert!(proxy_targets_local_port("http://localhost:3456", 3456));
        assert!(proxy_targets_local_port("http://127.0.0.1:3456/", 3456));
        assert!(proxy_targets_local_port(
            "https+insecure://[::1]:3456",
            3456
        ));
        assert!(proxy_targets_local_port("localhost:3456", 3456));
        assert!(!proxy_targets_local_port("http://localhost:34567", 3456));
        assert!(!proxy_targets_local_port("http://100.64.0.2:3456", 3456));
        assert!(!proxy_targets_local_port("http://localhost", 3456));
        assert!(!proxy_targets_local_port("[::1]", 3456));
    }

    /// Live check against the local CLI: `cargo test --lib live_tailscale -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_tailscale() {
        let port = std::env::var("TS_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3456);
        let info = detect(port);
        let mask = |s: &str| {
            s.split('.')
                .enumerate()
                .map(|(i, part)| if i < 2 && part != "ts" { "x" } else { part })
                .collect::<Vec<_>>()
                .join(".")
        };
        println!(
            "installed={} running={} magicDns={} tailnet={:?} dns={:?} ips={} port={}",
            info.installed,
            info.running,
            info.magic_dns_enabled,
            info.tailnet_name.as_deref().map(mask),
            info.dns_name.as_deref().map(mask),
            info.ips.len(),
            info.port
        );
        for serve in &info.serves {
            let host = serve.url.split("://").nth(1).unwrap_or("");
            println!(
                "serve url=https://{} proxy={} servesSplitkick={} funnel={}",
                mask(host),
                serve.proxy_target,
                serve.serves_splitkick,
                serve.funnel
            );
        }
    }
}
