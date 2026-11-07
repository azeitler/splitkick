//! Crash files for Rust panics (issue #110).
//!
//! A panic's message goes to stderr, which nobody reads for an app started
//! from the Dock or for a background child process. A panic on the main
//! thread or across an FFI callback ends the process; one in a tokio task
//! ends only that task (release builds unwind, see `Cargo.toml`). The hook
//! writes the message, the location, the thread, the version, the process
//! role and a backtrace to `crash-YYYYMMDD-HHMMSS-<pid>.log` in the log
//! folder, before the process can end. The same text goes to the app log
//! when the logger is up.
//!
//! `SPLITKICK_TEST_PANIC=1` panics right after the hook is installed, to
//! check that a crash file appears.
//!
//! The hook is installed first thing in `run()`, for the window app and for
//! every background mode of the same binary (MCP stdio server, PI and ACP
//! hosts, headless server) — the crashes in #110 came from both.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Crash files kept in the log folder; older ones are removed.
const KEEP: usize = 20;
const PREFIX: &str = "crash-";

static CRASH_DIR: OnceLock<PathBuf> = OnceLock::new();

/// The log folder Tauri's `app_log_dir()` resolves for `identifier`. The hook
/// needs it before any `AppHandle` exists (and in modes that never build one).
pub(crate) fn log_dir_for(identifier: &str) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let dir = dirs::home_dir().map(|home| home.join("Library/Logs").join(identifier));
    #[cfg(not(target_os = "macos"))]
    let dir = dirs::data_local_dir().map(|dir| dir.join(identifier).join("logs"));
    dir
}

/// Install the panic hook. `role` names the process mode ("app", or the
/// background flag such as `--jean-mcp-stdio`).
pub(crate) fn install(log_dir: Option<PathBuf>, version: &'static str, role: &'static str) {
    if let Some(dir) = log_dir {
        prune(&dir, KEEP);
        let _ = CRASH_DIR.set(dir);
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload_as_str()
            .unwrap_or("(panic payload is not a string)");
        let location = info
            .location()
            .map(|location| {
                format!(
                    "{}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            })
            .unwrap_or_else(|| "unknown".to_string());
        let report = report(
            message,
            &location,
            std::thread::current().name().unwrap_or("<unnamed>"),
            version,
            role,
            &std::backtrace::Backtrace::force_capture().to_string(),
        );
        // The file first: it is the part that must survive an abort.
        let written = CRASH_DIR.get().and_then(|dir| {
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
            write(dir, &stamp, &report)
        });
        match &written {
            Some(path) => log::error!(
                "Panic in thread '{}' at {location}: {message} (crash file: {})",
                std::thread::current().name().unwrap_or("<unnamed>"),
                path.display()
            ),
            None => log::error!("Panic at {location}: {message}"),
        }
        log::logger().flush();
        previous(info);
    }));
    if std::env::var_os("SPLITKICK_TEST_PANIC").is_some_and(|value| value == "1") {
        panic!("SPLITKICK_TEST_PANIC=1: deliberate test panic");
    }
}

fn report(
    message: &str,
    location: &str,
    thread: &str,
    version: &str,
    role: &str,
    backtrace: &str,
) -> String {
    format!(
        "Splitkick {version}: Rust panic\n\
         Time: {}\n\
         OS: {} {}\n\
         Process: {role} (pid {})\n\
         Thread: {thread}\n\
         Location: {location}\n\
         Message: {message}\n\
         \n\
         Backtrace:\n{backtrace}\n",
        chrono::Local::now().to_rfc3339(),
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::process::id(),
    )
}

/// `stamp` is the local time as `YYYYMMDD-HHMMSS`.
fn write(dir: &Path, stamp: &str, report: &str) -> Option<PathBuf> {
    std::fs::create_dir_all(dir).ok()?;
    let name = format!("{PREFIX}{stamp}-{}.log", std::process::id());
    let path = dir.join(name);
    // Append: a panic that ends in an FFI callback panics a second time
    // ("panic in a function that cannot unwind") within the same second, and
    // the first report is the one that names the cause.
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()?;
    file.write_all(report.as_bytes()).ok()?;
    file.sync_all().ok()?;
    Some(path)
}

/// Whether `name` is a crash file (and not a run log).
pub(crate) fn is_crash_file(name: &str) -> bool {
    name.starts_with(PREFIX) && name.ends_with(".log")
}

/// Keep the newest `keep` crash files. The names sort by time.
fn prune(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_crash_file)
        })
        .collect();
    files.sort();
    let excess = files.len().saturating_sub(keep);
    for path in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(path);
    }
}

/// The newest crash file in `dir`, for Help → Show Crash Reports.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // Help menu is macOS-only
pub(crate) fn newest_crash_file(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_crash_file)
        })
        .max()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_report_names_everything_needed_to_find_the_cause() {
        let text = report(
            "index out of bounds",
            "src/lib.rs:10:5",
            "tokio-runtime-worker",
            "1.5.4",
            "app",
            "   0: jean_lib::run",
        );
        assert!(text.starts_with("Splitkick 1.5.4: Rust panic\n"));
        assert!(text.contains("Thread: tokio-runtime-worker\n"));
        assert!(text.contains("Location: src/lib.rs:10:5\n"));
        assert!(text.contains("Message: index out of bounds\n"));
        assert!(text.contains("Process: app (pid "));
        assert!(text.contains("Backtrace:\n   0: jean_lib::run"));
    }

    #[test]
    fn writes_a_crash_file_and_keeps_only_the_newest() {
        let dir = tempfile::tempdir().expect("temp dir");
        for stamp in ["20261101-100000", "20261102-100000", "20261103-100000"] {
            std::fs::write(dir.path().join(format!("crash-{stamp}-1.log")), "old").expect("write");
        }
        std::fs::write(dir.path().join("Splitkick.log"), "run log").expect("write");

        let path = write(dir.path(), "20261107-142847", "first\n").expect("crash file");
        assert!(is_crash_file(path.file_name().unwrap().to_str().unwrap()));
        // A second panic in the same second keeps the first report.
        assert_eq!(
            write(dir.path(), "20261107-142847", "second\n").as_ref(),
            Some(&path)
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first\nsecond\n");
        assert_eq!(newest_crash_file(dir.path()), Some(path.clone()));

        prune(dir.path(), 2);
        let mut left: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        let newest = path.file_name().unwrap().to_str().unwrap().to_string();
        assert_eq!(
            left,
            vec![
                "Splitkick.log".to_string(),
                "crash-20261103-100000-1.log".to_string(),
                newest
            ]
        );
    }
}
