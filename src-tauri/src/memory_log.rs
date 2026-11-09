//! Memory log line every 5 minutes and Help → Copy Memory Report (issue #97).
//!
//! Numbers: the footprint of this process, of each WebKit content process,
//! the count of direct child processes, the in-memory structure counts from
//! `jean_core::memory_report`, and what each page reported with its last
//! liveness answer (query cache size, DOM nodes).
//!
//! Finding the content process: WebKit runs it as an XPC service, so its
//! parent is launchd, not Splitkick, and a process-tree walk cannot find it.
//! Each `WKWebView` knows its own content process through the
//! `_webProcessIdentifier` property (WebKit SPI, present since macOS 10.12),
//! which we read on the main thread through `with_webview`. That gives the
//! exact pid per webview, also for the browser pane. Several webviews can
//! share one process; the report lists each pid once.
//!
//! Windows and Linux: only the main process. WebView2's processes belong to
//! the Edge runtime, and the report says the content process is unknown.

use jean_core::memory_report::{self, ProcessMemory, MEMORY_WARN_BYTES};
#[cfg(target_os = "macos")]
use std::collections::BTreeMap;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub(crate) const INTERVAL: Duration = Duration::from_secs(5 * 60);
const WARNING_FILE: &str = "memory-warnings.log";
const WARNING_FILE_MAX_BYTES: u64 = 2 * 1024 * 1024;

// Only macOS finds content processes; elsewhere the report says n/a.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct ContentProcess {
    pid: u32,
    labels: Vec<String>,
    memory: Option<ProcessMemory>,
}

struct Snapshot {
    main: Option<ProcessMemory>,
    /// `None` where the platform cannot tell.
    content: Option<Vec<ContentProcess>>,
    children: Option<usize>,
    children_bytes: Option<u64>,
    counts: memory_report::InMemoryCounts,
    frontend: Vec<(String, crate::webview_watchdog::FrontendStats)>,
}

/// The WebKit content process of `webview` (see the module comment).
#[cfg(target_os = "macos")]
pub(crate) async fn webview_pid(webview: &tauri::Webview) -> Option<u32> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| {
            // SAFETY: `inner()` is the page's WKWebView, alive for the call.
            let pid = unsafe {
                use objc2::runtime::AnyObject;
                use objc2::{msg_send, sel};
                let object: &AnyObject = &*platform.inner().cast::<AnyObject>();
                if object.class().responds_to(sel!(_webProcessIdentifier)) {
                    let pid: i32 = msg_send![object, _webProcessIdentifier];
                    u32::try_from(pid).ok().filter(|pid| *pid > 0)
                } else {
                    None
                }
            };
            let _ = sender.send(pid);
        })
        .ok()?;
    // The main thread may be busy (or the app just resumed): do not wait long.
    tokio::time::timeout(Duration::from_secs(2), receiver)
        .await
        .ok()?
        .ok()?
}

#[cfg(target_os = "macos")]
async fn content_processes(app: &AppHandle) -> Option<Vec<ContentProcess>> {
    let mut by_pid: BTreeMap<u32, Vec<String>> = BTreeMap::new();
    for (label, webview) in app.webviews() {
        if let Some(pid) = webview_pid(&webview).await {
            by_pid.entry(pid).or_default().push(label);
        }
    }
    Some(
        by_pid
            .into_iter()
            .map(|(pid, mut labels)| {
                labels.sort();
                ContentProcess {
                    pid,
                    labels,
                    memory: memory_report::process_memory(pid),
                }
            })
            .collect(),
    )
}

#[cfg(not(target_os = "macos"))]
async fn content_processes(_app: &AppHandle) -> Option<Vec<ContentProcess>> {
    None
}

async fn snapshot(app: &AppHandle) -> Snapshot {
    let pid = std::process::id();
    let counts = app
        .try_state::<crate::CoreRuntime>()
        .map(|core| memory_report::in_memory_counts(&core.0))
        .unwrap_or_default();
    Snapshot {
        main: memory_report::process_memory(pid),
        content: content_processes(app).await,
        children: memory_report::child_process_count(pid),
        children_bytes: memory_report::child_process_bytes(pid),
        counts,
        frontend: crate::webview_watchdog::frontend_stats(),
    }
}

fn bytes(memory: Option<ProcessMemory>) -> String {
    memory
        .map(|memory| memory_report::format_bytes(memory.footprint_bytes))
        .unwrap_or_else(|| "?".to_string())
}

fn over_limit(memory: Option<ProcessMemory>) -> bool {
    memory.is_some_and(|memory| memory.footprint_bytes > MEMORY_WARN_BYTES)
}

impl Snapshot {
    fn warns(&self) -> bool {
        over_limit(self.main)
            || self
                .content
                .iter()
                .flatten()
                .any(|process| over_limit(process.memory))
    }

    fn content_line(&self) -> String {
        match &self.content {
            None => "n/a".to_string(),
            Some(processes) if processes.is_empty() => "none".to_string(),
            Some(processes) => processes
                .iter()
                .map(|process| {
                    format!(
                        "{}[pid {} {}]",
                        bytes(process.memory),
                        process.pid,
                        process.labels.join(",")
                    )
                })
                .collect::<Vec<_>>()
                .join(" "),
        }
    }

    fn frontend_line(&self) -> String {
        self.frontend
            .iter()
            .map(|(label, stats)| {
                format!(
                    "{label}(queries={} domNodes={} messages={} messageText={})",
                    stats.queries,
                    stats.dom_nodes,
                    stats.messages,
                    memory_report::format_bytes(stats.message_chars),
                )
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// The peak shows spikes that fall between two samples.
    fn peak_field(&self) -> String {
        match self.main.map(|memory| memory.peak_footprint_bytes) {
            Some(peak) if peak > 0 => format!(" peak={}", memory_report::format_bytes(peak)),
            _ => String::new(),
        }
    }

    fn children_field(&self) -> String {
        self.children_bytes
            .map(|total| format!(" childMemory={}", memory_report::format_bytes(total)))
            .unwrap_or_default()
    }

    /// The largest processes first, for the warning.
    fn top_contributors(&self) -> String {
        let mut top: Vec<(String, u64)> = Vec::new();
        if let Some(memory) = self.main {
            top.push(("main".to_string(), memory.footprint_bytes));
        }
        for process in self.content.iter().flatten() {
            if let Some(memory) = process.memory {
                top.push((
                    format!("webContent {}", process.labels.join(",")),
                    memory.footprint_bytes,
                ));
            }
        }
        if let Some(total) = self.children_bytes {
            top.push(("children".to_string(), total));
        }
        top.sort_by_key(|entry| std::cmp::Reverse(entry.1));
        top.iter()
            .map(|(name, size)| format!("{name} {}", memory_report::format_bytes(*size)))
            .collect::<Vec<_>>()
            .join(", ")
    }

    /// One line for the log.
    fn line(&self) -> String {
        let children = self
            .children
            .map(|count| count.to_string())
            .unwrap_or_else(|| "?".to_string());
        let frontend = self.frontend_line();
        format!(
            "Memory: main={}{} webContent={} children={children} {}{}{}{}",
            bytes(self.main),
            self.peak_field(),
            self.content_line(),
            self.counts.log_fields(),
            self.children_field(),
            if frontend.is_empty() {
                ""
            } else {
                " frontend="
            },
            frontend,
        )
    }

    /// Several lines for Copy Memory Report.
    fn report(&self) -> String {
        let main = self.main.map_or_else(
            || "unknown".to_string(),
            |memory| {
                format!(
                    "{} (resident {})",
                    memory_report::format_bytes(memory.footprint_bytes),
                    memory_report::format_bytes(memory.resident_bytes)
                )
            },
        );
        let mut lines = vec![
            format!(
                "Splitkick {} memory report ({})",
                jean_core::app_version(),
                std::env::consts::OS
            ),
            format!("Main process (pid {}): {main}", std::process::id()),
            format!("WebKit content processes: {}", self.content_line()),
            format!(
                "Child processes: {}",
                self.children
                    .map(|count| count.to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            ),
            format!("In memory: {}", self.counts.log_fields()),
        ];
        if !self.frontend.is_empty() {
            lines.push(format!("Pages: {}", self.frontend_line()));
        }
        if self.warns() {
            lines.push(format!(
                "Warning: above {}",
                memory_report::format_bytes(MEMORY_WARN_BYTES)
            ));
            lines.push(format!("Largest: {}", self.top_contributors()));
        }
        lines.join("\n")
    }
}

/// Keep each warning in its own file: the main log rotates, and a 20 GB event
/// must still be readable afterwards (#128).
fn save_warning(app: &AppHandle, report: &str) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    let unix_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    if let Err(error) = append_capped(
        &dir.join(WARNING_FILE),
        &format!("--- unix {unix_secs}\n{report}\n"),
        WARNING_FILE_MAX_BYTES,
    ) {
        log::warn!("Could not save the memory warning: {error}");
    }
}

/// Append `text`; a file past `max_bytes` moves to `<name>.1` first, so the
/// file stays bounded and the previous warnings stay readable.
fn append_capped(path: &std::path::Path, text: &str, max_bytes: u64) -> std::io::Result<()> {
    use std::io::Write;
    if std::fs::metadata(path).is_ok_and(|meta| meta.len() > max_bytes) {
        std::fs::rename(path, path.with_extension("log.1"))?;
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?
        .write_all(text.as_bytes())
}

/// Write the memory line to the log; a warning above the limit.
pub(crate) async fn log_now(app: &AppHandle) {
    let snapshot = snapshot(app).await;
    if snapshot.warns() {
        log::warn!(
            "{} — above {} — largest: {}",
            snapshot.line(),
            memory_report::format_bytes(MEMORY_WARN_BYTES),
            snapshot.top_contributors()
        );
        save_warning(app, &snapshot.report());
    } else {
        log::info!("{}", snapshot.line());
    }
}

/// The text for Help → Copy Memory Report and recovery details.
pub(crate) async fn report(app: &AppHandle) -> String {
    snapshot(app).await.report()
}

/// Help → Copy Memory Report: log the line, copy the report, tell the window.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // Help menu is macOS-only
pub(crate) async fn copy_report(app: &AppHandle, label: String) {
    use tauri::Emitter;
    log_now(app).await;
    let text = report(app).await;
    let result = crate::desktop_commands::write_clipboard_text(text).await;
    if let Err(error) = &result {
        log::warn!("Copy Memory Report failed: {error}");
    }
    let _ = app.emit_to(
        tauri::EventTarget::webview_window(label),
        "memory-report-copied",
        result.is_ok(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1024 * 1024 * 1024;

    fn memory(footprint_bytes: u64) -> Option<ProcessMemory> {
        Some(ProcessMemory {
            footprint_bytes,
            resident_bytes: footprint_bytes,
            peak_footprint_bytes: 2 * footprint_bytes,
        })
    }

    fn snapshot(main: u64, content: u64) -> Snapshot {
        Snapshot {
            main: memory(main),
            content: Some(vec![ContentProcess {
                pid: 4321,
                labels: vec!["main".to_string()],
                memory: memory(content),
            }]),
            children: Some(3),
            children_bytes: Some(GB / 2),
            counts: memory_report::InMemoryCounts {
                cached_sessions: 7,
                ..Default::default()
            },
            frontend: vec![(
                "main".to_string(),
                crate::webview_watchdog::FrontendStats {
                    queries: 40,
                    dom_nodes: 2100,
                    messages: 12,
                    message_chars: 3 * 1024 * 1024,
                },
            )],
        }
    }

    #[test]
    fn the_line_names_main_content_and_counts() {
        let line = snapshot(GB, 2 * GB).line();
        assert!(
            line.starts_with("Memory: main=1.00 GB peak=2.00 GB "),
            "{line}"
        );
        assert!(line.contains("webContent=2.00 GB[pid 4321 main]"), "{line}");
        assert!(line.contains("children=3 cachedSessions=7 "), "{line}");
        assert!(
            line.ends_with(
                " childMemory=512 MB frontend=main(queries=40 domNodes=2100 messages=12 messageText=3 MB)"
            ),
            "{line}"
        );
    }

    #[test]
    fn warns_when_either_process_passes_the_limit() {
        assert!(!snapshot(GB, GB).warns());
        assert!(snapshot(5 * GB, GB).warns());
        assert!(snapshot(GB, 5 * GB).warns());
        assert!(snapshot(GB, 5 * GB)
            .report()
            .contains("Warning: above 4.00 GB"));
    }

    #[test]
    fn a_warning_names_the_largest_process_first() {
        let report = snapshot(GB, 5 * GB).report();
        assert!(
            report.contains("Largest: webContent main 5.00 GB, main 1.00 GB, children 512 MB"),
            "{report}"
        );
    }

    #[test]
    fn saved_warnings_rotate_at_the_cap() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(WARNING_FILE);
        append_capped(&path, "first\n", 4).unwrap();
        append_capped(&path, "second\n", 4).unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second\n");
        assert_eq!(
            std::fs::read_to_string(path.with_extension("log.1")).unwrap(),
            "first\n"
        );
    }

    #[test]
    fn unknown_content_processes_read_as_not_available() {
        let mut snapshot = snapshot(GB, GB);
        snapshot.content = None;
        assert!(snapshot.line().contains("webContent=n/a "));
    }
}
