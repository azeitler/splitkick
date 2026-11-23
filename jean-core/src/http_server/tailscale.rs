//! Tailscale detection for Settings → Web Access (#151).
//!
//! Reads `tailscale status --json` and `tailscale serve status --json` and
//! reports the tailnet, this machine's MagicDNS name, and whether the web
//! access server is published through `tailscale serve`. This is
//! information only and must never block the pane: a failed CLI call comes
//! back as `error`, a backend that is not running as its `state`.
//!
//! macOS: the app bundle binary is `Tailscale.app/Contents/MacOS/Tailscale`
//! (capital T; the App Store variant has no other CLI, the Standalone one
//! adds a `/usr/local/bin/tailscale` wrapper). It reads `TERM`, `SHLVL`,
//! `PS1` etc. to choose between GUI and CLI; started from a GUI app it tries
//! to open the GUI and prints "The Tailscale GUI failed to start" with exit
//! 0. `TAILSCALE_BE_CLI=1` forces CLI mode.
//! https://tailscale.com/docs/reference/tailscale-cli (macOS section),
//! https://tailscale.com/docs/concepts/macos-variants
//!
//! JSON shapes (Tailscale 1.104): `status` has `BackendState`,
//! `MagicDNSSuffix`, `CurrentTailnet {Name, MagicDNSSuffix, MagicDNSEnabled}`
//! and `Self {DNSName, TailscaleIPs}`. `serve status` is the `ipn.ServeConfig`:
//! `TCP {"<port>": {HTTPS|HTTP}}`, `Web {"<host>:<port>": {Handlers {"<path>":
//! {Proxy}}}}`, `AllowFunnel {"<host>:<port>": true}`, and `Foreground` with
//! one nested ServeConfig per foreground `tailscale serve` session.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::platform::{find_cli_in_host_path, silent_command};

/// Generous: a cold app binary on a loaded machine can take seconds. The
/// call runs on a blocking thread, so it does not hold up other commands.
const CLI_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleInfo {
    pub installed: bool,
    pub running: bool,
    /// `BackendState` from `status --json` (`Running`, `Stopped`,
    /// `NeedsLogin`, `Starting`, ...). `None` when the status was not read.
    pub state: Option<String>,
    /// Short reason when the CLI call failed (timeout, exit code, output
    /// that is not JSON). `running` is false then.
    pub error: Option<String>,
    /// Text the CLI printed next to the JSON (e.g. a version warning).
    pub warning: Option<String>,
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

/// Find the JSON object in CLI output that may carry text before or after
/// it (a version warning, a notice). Returns the value and the other text.
pub fn extract_json(text: &str) -> Option<(Value, Option<String>)> {
    if let Ok(v) = serde_json::from_str::<Value>(text) {
        return Some((v, None));
    }
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end < start {
        return None;
    }
    let v = serde_json::from_str::<Value>(&text[start..=end]).ok()?;
    let noise = format!("{} {}", text[..start].trim(), text[end + 1..].trim());
    let noise = noise.trim();
    Some((v, (!noise.is_empty()).then(|| noise.to_string())))
}

/// Parse `tailscale status --json`. `None` when the output holds no JSON
/// object. Text around the JSON goes to `warning`.
pub fn parse_status(json: &str, port: u16) -> Option<TailscaleInfo> {
    let (v, warning) = extract_json(json)?;
    let state = non_empty(v.get("BackendState"));
    let running = state.as_deref() == Some("Running");
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
        state,
        error: None,
        warning,
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
    let Some((v, _)) = extract_json(json) else {
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

/// The CLI inside a macOS app bundle's `Contents/MacOS` directory. Matches
/// the file name exactly: `Path::exists` would also accept a wrong case on a
/// case-insensitive volume and then fail on a case-sensitive one.
fn bundle_cli(macos_dir: &Path) -> Option<PathBuf> {
    let names: Vec<String> = std::fs::read_dir(macos_dir)
        .ok()?
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .collect();
    ["Tailscale", "tailscale"]
        .into_iter()
        .find(|want| names.iter().any(|name| name == want))
        .map(|name| macos_dir.join(name))
}

fn tailscale_binary() -> Option<PathBuf> {
    // On macOS the PATH entry is a shell wrapper around the app binary (and
    // missing for the App Store variant), so call the app binary directly.
    #[cfg(target_os = "macos")]
    {
        if let Some(bundled) = bundle_cli(Path::new("/Applications/Tailscale.app/Contents/MacOS")) {
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

/// One finished CLI call.
#[derive(Debug)]
struct CliRun {
    code: Option<i32>,
    stdout: String,
    stderr: String,
    elapsed: Duration,
}

/// A CLI call that did not finish: could not start, or timed out.
#[derive(Debug)]
struct CliFailure {
    error: String,
    elapsed: Duration,
}

fn run_with_timeout(binary: &Path, args: &[&str], timeout: Duration) -> Result<CliRun, CliFailure> {
    let started = Instant::now();
    let mut child = silent_command(binary)
        .args(args)
        // Force CLI mode for the macOS app binary (see module docs).
        .env("TAILSCALE_BE_CLI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| CliFailure {
            error: format!("could not start the CLI: {e}"),
            elapsed: started.elapsed(),
        })?;
    // Drain both pipes on threads: a status with many peers is larger than
    // the pipe buffer, and an undrained pipe blocks the child until timeout.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            String::from_utf8_lossy(&buf).into_owned()
        })
    };
    let stdout = drain(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let stderr = drain(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let deadline = started + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(CliFailure {
                    error: format!("timed out after {} s", timeout.as_secs_f32()),
                    elapsed: started.elapsed(),
                });
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(CliFailure {
                    error: format!("could not wait for the CLI: {e}"),
                    elapsed: started.elapsed(),
                });
            }
        }
    };
    Ok(CliRun {
        code: status.code(),
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
        elapsed: started.elapsed(),
    })
}

/// The first non-empty line, cut to `max` characters.
fn first_line(text: &str, max: usize) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let mut out: String = line.chars().take(max).collect();
    if line.chars().count() > max {
        out.push('…');
    }
    out
}

fn head(text: &str, max: usize) -> String {
    text.trim()
        .chars()
        .take(max)
        .collect::<String>()
        .replace('\n', "\\n")
}

/// Blocking: query the local Tailscale CLI. Never fails.
pub fn detect(port: u16) -> TailscaleInfo {
    detect_with(tailscale_binary(), port, CLI_TIMEOUT)
}

fn detect_with(binary: Option<PathBuf>, port: u16, timeout: Duration) -> TailscaleInfo {
    let not_installed = TailscaleInfo {
        port,
        ..TailscaleInfo::default()
    };
    let Some(binary) = binary else {
        return not_installed;
    };
    // `status --json` prints JSON also when the backend is stopped, so a
    // missing JSON object is a CLI failure, not "not connected".
    let mut info = match run_with_timeout(&binary, &["status", "--json"], timeout) {
        Ok(run) => match parse_status(&run.stdout, port) {
            Some(mut info) => {
                let stderr = run.stderr.trim();
                if !stderr.is_empty() {
                    info.warning = Some(match info.warning.take() {
                        Some(w) => format!("{w} {stderr}"),
                        None => stderr.to_string(),
                    });
                }
                if info.running {
                    if let Some(warning) = &info.warning {
                        log::info!("Tailscale CLI warning: {}", head(warning, 200));
                    }
                } else {
                    log::warn!(
                        "Tailscale not running: state={:?} binary={} exit={:?} elapsed={:?} stderr={:?} warning={:?}",
                        info.state,
                        binary.display(),
                        run.code,
                        run.elapsed,
                        head(&run.stderr, 200),
                        info.warning.as_deref().map(|w| head(w, 200)),
                    );
                }
                info
            }
            None => {
                let detail = if run.stdout.trim().is_empty() {
                    &run.stderr
                } else {
                    &run.stdout
                };
                let error = match run.code {
                    Some(0) if detail.trim().is_empty() => "no output".to_string(),
                    Some(0) => format!("output is not JSON: {}", first_line(detail, 120)),
                    code => {
                        let code = code.map_or("signal".to_string(), |c| c.to_string());
                        let line = first_line(detail, 120);
                        if line.is_empty() {
                            format!("exit code {code}")
                        } else {
                            format!("exit code {code}: {line}")
                        }
                    }
                };
                log::warn!(
                    "Tailscale status failed: {error}; binary={} exit={:?} elapsed={:?} stdout={:?} stderr={:?}",
                    binary.display(),
                    run.code,
                    run.elapsed,
                    head(&run.stdout, 200),
                    head(&run.stderr, 200),
                );
                return TailscaleInfo {
                    installed: true,
                    error: Some(error),
                    ..not_installed
                };
            }
        },
        Err(failure) => {
            log::warn!(
                "Tailscale status failed: {}; binary={} elapsed={:?}",
                failure.error,
                binary.display(),
                failure.elapsed,
            );
            return TailscaleInfo {
                installed: true,
                error: Some(failure.error),
                ..not_installed
            };
        }
    };
    if info.running {
        match run_with_timeout(&binary, &["serve", "status", "--json"], timeout) {
            Ok(run) => info.serves = parse_serve_status(&run.stdout, port),
            Err(failure) => log::warn!(
                "Tailscale serve status failed: {}; binary={} elapsed={:?}",
                failure.error,
                binary.display(),
                failure.elapsed,
            ),
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

    #[test]
    fn leading_warning_line_is_kept() {
        let out = format!(
            "Warning: client version \"1.90.0\" != tailscaled server version \"1.92.1\"\n{RUNNING}\n"
        );
        let info = parse_status(&out, 3456).unwrap();
        assert!(info.running);
        assert_eq!(info.dns_name.as_deref(), Some("box.tail1234.ts.net"));
        assert!(info.warning.unwrap().starts_with("Warning: client version"));
        assert_eq!(parse_status(RUNNING, 3456).unwrap().warning, None);
    }

    #[test]
    fn backend_states() {
        for state in ["NeedsLogin", "Stopped", "Starting", "NeedsMachineAuth"] {
            let json = format!(r#"{{"BackendState": "{state}", "Self": null}}"#);
            let info = parse_status(&json, 3456).unwrap();
            assert!(info.installed && !info.running);
            assert_eq!(info.state.as_deref(), Some(state));
            assert_eq!(info.error, None);
        }
        assert_eq!(
            parse_status(RUNNING, 3456).unwrap().state.as_deref(),
            Some("Running")
        );
    }

    #[test]
    fn serve_status_with_noise() {
        let json = "notice: something\n{\"TCP\": {\"443\": {\"HTTPS\": true}}, \"Web\": {\"box.tail1234.ts.net:443\": {\"Handlers\": {\"/\": {\"Proxy\": \"http://localhost:3456\"}}}}}";
        assert_eq!(parse_serve_status(json, 3456).len(), 1);
    }

    #[test]
    fn bundle_cli_matches_the_exact_name() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(bundle_cli(dir.path()), None);
        std::fs::write(dir.path().join("Tailscale"), "").unwrap();
        // On a case-insensitive volume `exists()` would accept any case; the
        // chosen path must carry the name as it is on disk.
        assert_eq!(bundle_cli(dir.path()), Some(dir.path().join("Tailscale")));
        assert_eq!(bundle_cli(&dir.path().join("missing")), None);
    }

    #[test]
    fn bundle_cli_accepts_an_old_lowercase_name() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("tailscale"), "").unwrap();
        assert_eq!(bundle_cli(dir.path()), Some(dir.path().join("tailscale")));
    }

    #[test]
    fn no_binary_is_not_installed() {
        let info = detect_with(None, 3456, Duration::from_secs(1));
        assert!(!info.installed && !info.running);
        assert_eq!(info.error, None);
    }

    #[cfg(unix)]
    mod fake_cli {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        /// A fake `tailscale` shell script in a temp dir.
        fn fake(script: &str) -> (tempfile::TempDir, PathBuf) {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("tailscale");
            std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            (dir, path)
        }

        fn detect_fake(script: &str, timeout: Duration) -> TailscaleInfo {
            let (_dir, path) = fake(script);
            detect_with(Some(path), 3456, timeout)
        }

        const SECOND: Duration = Duration::from_secs(5);

        #[test]
        fn running_with_serve_and_warning() {
            let script = format!(
                r#"if [ "$1" = serve ]; then
  echo '{{"TCP": {{"443": {{"HTTPS": true}}}}, "Web": {{"box.tail1234.ts.net:443": {{"Handlers": {{"/": {{"Proxy": "http://localhost:3456"}}}}}}}}}}'
else
  echo 'Warning: client version "1" != tailscaled server version "2"' >&2
  cat <<'JSON'
{RUNNING}
JSON
fi"#
            );
            let info = detect_fake(&script, SECOND);
            assert!(info.running, "{info:?}");
            assert_eq!(info.error, None);
            assert_eq!(info.dns_name.as_deref(), Some("box.tail1234.ts.net"));
            assert_eq!(info.serves.len(), 1);
            assert!(info.warning.unwrap().contains("client version"));
        }

        #[test]
        fn forces_cli_mode() {
            // The macOS app binary opens its GUI unless TAILSCALE_BE_CLI=1.
            let script = format!(
                r#"if [ "$TAILSCALE_BE_CLI" != 1 ]; then echo 'The Tailscale GUI failed to start'; exit 0; fi
cat <<'JSON'
{RUNNING}
JSON"#
            );
            assert!(detect_fake(&script, SECOND).running);
        }

        #[test]
        fn gui_text_instead_of_json_is_an_error() {
            let info = detect_fake("echo 'The Tailscale GUI failed to start: denied'", SECOND);
            assert!(info.installed && !info.running);
            assert_eq!(
                info.error.as_deref(),
                Some("output is not JSON: The Tailscale GUI failed to start: denied")
            );
        }

        #[test]
        fn needs_login_is_a_state_not_an_error() {
            let info = detect_fake(r#"echo '{"BackendState": "NeedsLogin"}'"#, SECOND);
            assert!(info.installed && !info.running);
            assert_eq!(info.state.as_deref(), Some("NeedsLogin"));
            assert_eq!(info.error, None);
        }

        #[test]
        fn non_zero_exit_reports_stderr() {
            let info = detect_fake(
                "echo 'failed to connect to local tailscaled' >&2; exit 1",
                SECOND,
            );
            assert_eq!(
                info.error.as_deref(),
                Some("exit code 1: failed to connect to local tailscaled")
            );
            assert_eq!(info.state, None);
        }

        #[test]
        fn timeout_is_an_error() {
            let started = Instant::now();
            let info = detect_fake("sleep 5", Duration::from_millis(300));
            assert!(started.elapsed() < Duration::from_secs(3));
            assert!(info.installed && !info.running);
            assert!(info.error.unwrap().starts_with("timed out"));
        }

        #[test]
        fn large_output_does_not_block() {
            // More than a pipe buffer (64 KB) before the JSON.
            let script = format!(
                r#"i=0; while [ $i -lt 2000 ]; do echo 'padding padding padding padding padding padding' >&2; i=$((i+1)); done
cat <<'JSON'
{RUNNING}
JSON"#
            );
            assert!(detect_fake(&script, SECOND).running);
        }
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
            "installed={} running={} state={:?} error={:?} warning={:?} magicDns={} tailnet={:?} dns={:?} ips={} port={}",
            info.installed,
            info.running,
            info.state,
            info.error,
            info.warning,
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
