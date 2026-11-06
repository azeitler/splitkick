//! Brings an empty window back (issue #97).
//!
//! Under memory pressure macOS suspends Splitkick or kills its WebKit content
//! process. Afterwards the window can stay empty while the backend — and the
//! sessions it runs — is fine. Two paths reload the page:
//!
//! 1. **Content process terminated.** WebKit tells us through
//!    `webViewWebContentProcessDidTerminate`; Tauri hands it to the hook set
//!    with `Builder::on_web_content_process_terminate`. Ours replaces Tauri's
//!    default, which gives up silently when the window list is borrowed and
//!    logs at debug level only.
//! 2. **No answer.** On a wake or resume, on window focus and once a minute,
//!    the backend pings each visible window. The page answers through
//!    `webview_liveness_pong`. Two pings in a row without an answer reload the
//!    window — on macOS by ending its hung content process, as a reload alone
//!    would go to that same process. A window that answers is never reloaded.
//!
//! Tauri has no system-wake event on macOS, so a wake or a suspend (also a
//! SIGSTOP) is found from the wall clock: a 15 s tick that arrives much later
//! than planned means the process did not run in between.
//!
//! The reload leaves a recovery note per window. The reloaded page takes it
//! with `take_webview_recovery` and shows a toast; the UI state persistence
//! puts the user back on their project, worktree and session.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

/// Event the page answers with `webview_liveness_pong`.
pub(crate) const PING_EVENT: &str = "webview-liveness-ping";
/// Time the page has to answer a ping.
const PING_TIMEOUT: Duration = Duration::from_secs(8);
/// Missed pings in a row before a reload.
const MISSES_BEFORE_RELOAD: u32 = 2;
/// No pings right after a reload: the page is still starting.
const RELOAD_GRACE: Duration = Duration::from_secs(45);
/// Reloads without an answer in between before the watchdog stops trying.
const MAX_UNANSWERED_RELOADS: u32 = 3;
/// A focus ping is skipped when the page answered this recently.
const FOCUS_DEBOUNCE: Duration = Duration::from_secs(10);

const TICK: Duration = Duration::from_secs(15);
const PING_EVERY_TICKS: u32 = 4;
/// A tick this late means the process (or the machine) was asleep.
const RESUME_GAP: Duration = Duration::from_secs(45);

/// Numbers the page sends with each answer, for the memory log.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FrontendStats {
    pub queries: u64,
    pub dom_nodes: u64,
}

/// What the reloaded page shows the user.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryNote {
    pub reason: String,
    /// Unix time in milliseconds.
    pub at: u64,
    /// Text for "Copy details".
    pub details: String,
}

#[derive(Debug)]
struct Recovery {
    reason: String,
    at: SystemTime,
}

#[derive(Debug, Default)]
struct WindowLiveness {
    /// When the watchdog first met the window. A new window (or the app
    /// start) gets the same grace as a reload: its page is still loading.
    first_seen: Option<Instant>,
    pending: Option<u64>,
    misses: u32,
    last_reload: Option<Instant>,
    last_answer: Option<Instant>,
    unanswered_reloads: u32,
    recovery: Option<Recovery>,
    stats: Option<FrontendStats>,
    /// Why the watchdog ended the content process, for the reload it causes.
    ended_for: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum Timeout {
    Answered,
    PingAgain,
    Reload,
    GiveUp,
}

/// Per-window liveness state. Pure, so the rules are unit-tested.
#[derive(Debug, Default)]
struct Liveness {
    windows: HashMap<String, WindowLiveness>,
    next_token: u64,
}

impl Liveness {
    /// A token for a new ping, or `None` when none should go out now.
    fn begin_ping(&mut self, label: &str, now: Instant, debounce: Duration) -> Option<u64> {
        let window = self.windows.entry(label.to_string()).or_default();
        let recent = |at: Option<Instant>, within: Duration| {
            at.is_some_and(|at| now.saturating_duration_since(at) < within)
        };
        let first_seen = *window.first_seen.get_or_insert(now);
        if window.pending.is_some()
            || recent(Some(first_seen), RELOAD_GRACE)
            || recent(window.last_reload, RELOAD_GRACE)
            || recent(window.last_answer, debounce)
        {
            return None;
        }
        self.next_token += 1;
        window.pending = Some(self.next_token);
        Some(self.next_token)
    }

    fn timed_out(&mut self, label: &str, token: u64) -> Timeout {
        let Some(window) = self.windows.get_mut(label) else {
            return Timeout::Answered;
        };
        if window.pending != Some(token) {
            return Timeout::Answered;
        }
        window.pending = None;
        window.misses += 1;
        if window.misses < MISSES_BEFORE_RELOAD {
            return Timeout::PingAgain;
        }
        window.misses = 0;
        if window.unanswered_reloads >= MAX_UNANSWERED_RELOADS {
            Timeout::GiveUp
        } else {
            Timeout::Reload
        }
    }

    /// Any answer proves the page runs. Returns true when the page says it
    /// has rendered nothing (and is past its start), which needs a reload.
    fn answered(
        &mut self,
        label: &str,
        rendered: bool,
        stats: Option<FrontendStats>,
        now: Instant,
    ) -> bool {
        let window = self.windows.entry(label.to_string()).or_default();
        window.pending = None;
        window.misses = 0;
        window.last_answer = Some(now);
        if stats.is_some() {
            window.stats = stats;
        }
        if rendered {
            window.unanswered_reloads = 0;
            return false;
        }
        let starting = window
            .last_reload
            .is_some_and(|at| now.saturating_duration_since(at) < RELOAD_GRACE);
        !starting && window.unanswered_reloads < MAX_UNANSWERED_RELOADS
    }

    fn reloading(&mut self, label: &str, reason: &str, now: Instant, wall: SystemTime) {
        let window = self.windows.entry(label.to_string()).or_default();
        window.pending = None;
        window.misses = 0;
        window.last_reload = Some(now);
        window.unanswered_reloads += 1;
        window.recovery = Some(Recovery {
            reason: reason.to_string(),
            at: wall,
        });
    }

    // Only the macOS termination path uses it.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn ending_content_process(&mut self, label: &str, reason: &str) {
        let window = self.windows.entry(label.to_string()).or_default();
        window.ended_for = Some(reason.to_string());
    }

    /// The reason for a content process termination: the watchdog's own when
    /// it ended the process, WebKit's otherwise.
    // Only the macOS termination path uses it.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn termination_reason(&mut self, label: &str) -> String {
        self.windows
            .get_mut(label)
            .and_then(|window| window.ended_for.take())
            .unwrap_or_else(|| "web content process terminated".to_string())
    }

    fn take_recovery(&mut self, label: &str) -> Option<Recovery> {
        self.windows.get_mut(label)?.recovery.take()
    }

    fn stats(&self) -> Vec<(String, FrontendStats)> {
        let mut stats: Vec<_> = self
            .windows
            .iter()
            .filter_map(|(label, window)| Some((label.clone(), window.stats.clone()?)))
            .collect();
        stats.sort_by(|a, b| a.0.cmp(&b.0));
        stats
    }
}

static LIVENESS: LazyLock<Mutex<Liveness>> = LazyLock::new(Default::default);

fn liveness() -> std::sync::MutexGuard<'static, Liveness> {
    LIVENESS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Frontend numbers of every window that answered, for the memory log.
pub(crate) fn frontend_stats() -> Vec<(String, FrontendStats)> {
    liveness().stats()
}

/// Reload the page of webview `label` and leave a recovery note for it.
///
/// The reload is queued on the event loop from a worker thread instead of
/// running inside the WebKit callback, where the window list may be borrowed
/// (the case Tauri's default handler gives up on). One retry if it fails.
pub(crate) fn reload_webview(app: &AppHandle, label: &str, reason: &str) {
    log::info!("Webview recovery: reloading '{label}' ({reason})");
    liveness().reloading(label, reason, Instant::now(), SystemTime::now());
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        for attempt in 1..=2 {
            let Some(webview) = app.get_webview(&label) else {
                log::warn!("Webview recovery: '{label}' is gone, nothing to reload");
                return;
            };
            match webview.reload() {
                Ok(()) => {
                    log::info!("Webview recovery: reload of '{label}' sent (attempt {attempt})");
                    return;
                }
                Err(error) if attempt == 1 => {
                    log::warn!("Webview recovery: reload of '{label}' failed, retrying: {error}");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                Err(error) => {
                    log::error!("Webview recovery: reload of '{label}' failed again: {error}");
                }
            }
        }
    });
}

/// Hook for `Builder::on_web_content_process_terminate` (macOS).
#[cfg(target_os = "macos")]
pub(crate) fn on_web_content_process_terminate(webview: &tauri::Webview) {
    let label = webview.label().to_string();
    log::info!("Webview recovery: WebKit content process of '{label}' terminated");
    let reason = liveness().termination_reason(&label);
    reload_webview(webview.app_handle(), &label, &reason);
}

/// Recover a page that does not answer.
///
/// macOS: a reload goes to the same content process, so a hung process
/// stays hung (seen with a stopped WebContent process). End that process
/// instead — the exact one of this webview, from `_webProcessIdentifier` —
/// and WebKit's termination callback reloads the page in a new one. Plain
/// reload elsewhere, or when the pid is unknown.
async fn recover_unanswered(app: &AppHandle, label: &str, reason: &str) {
    #[cfg(target_os = "macos")]
    if let Some(webview) = app.get_webview(label) {
        if let Some(pid) = crate::memory_log::webview_pid(&webview).await {
            liveness().ending_content_process(label, reason);
            log::info!(
                "Webview recovery: ending hung content process {pid} of '{label}' ({reason})"
            );
            // SAFETY: plain kill(2) on the pid WebKit reports for this webview.
            if unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) } == 0 {
                return;
            }
            liveness().termination_reason(label);
            log::warn!(
                "Webview recovery: could not end content process {pid}: {}",
                std::io::Error::last_os_error()
            );
        }
    }
    reload_webview(app, label, reason);
}

/// Whether window `label` is on screen. Hidden and minimized windows are not
/// pinged: there is nothing to look at, and WebKit may throttle them.
fn is_on_screen(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label).is_some_and(|window| {
        window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
    })
}

/// Ping window `label`; reload it after two missed pings in a row.
pub(crate) fn ping_window(app: &AppHandle, label: &str, reason: &'static str) {
    if !is_on_screen(app, label) {
        return;
    }
    let debounce = if reason == "focus" {
        FOCUS_DEBOUNCE
    } else {
        Duration::ZERO
    };
    let Some(mut token) = liveness().begin_ping(label, Instant::now(), debounce) else {
        return;
    };
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        loop {
            let target = tauri::EventTarget::webview_window(label.clone());
            if let Err(error) = app.emit_to(target, PING_EVENT, token) {
                log::warn!("Webview liveness: ping to '{label}' failed: {error}");
            }
            tokio::time::sleep(PING_TIMEOUT).await;
            let outcome = liveness().timed_out(&label, token);
            match outcome {
                Timeout::Answered => return,
                Timeout::PingAgain => {
                    log::info!("Webview liveness: '{label}' did not answer a {reason} ping");
                    match liveness().begin_ping(&label, Instant::now(), Duration::ZERO) {
                        Some(next) => token = next,
                        None => return,
                    }
                }
                Timeout::Reload => {
                    let why = format!("no answer to two liveness pings after {reason}");
                    recover_unanswered(&app, &label, &why).await;
                    return;
                }
                Timeout::GiveUp => {
                    log::warn!(
                        "Webview liveness: '{label}' still does not answer after \
                         {MAX_UNANSWERED_RELOADS} reloads; not reloading again"
                    );
                    return;
                }
            }
        }
    });
}

fn ping_all(app: &AppHandle, reason: &'static str) {
    for label in app.webview_windows().into_keys() {
        ping_window(app, &label, reason);
    }
}

/// Background loop: resume detection, the minute ping and the memory log.
pub(crate) fn install(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_tick = SystemTime::now();
        // The first memory line a minute after start gives a baseline.
        let mut last_memory_log = SystemTime::now()
            .checked_sub(crate::memory_log::INTERVAL - Duration::from_secs(60))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let mut ticks = 0u32;
        loop {
            tokio::time::sleep(TICK).await;
            let now = SystemTime::now();
            let gap = now.duration_since(last_tick).unwrap_or_default();
            last_tick = now;
            ticks += 1;
            if gap > RESUME_GAP {
                log::info!(
                    "Webview liveness: resumed after a {}s pause (sleep or suspend)",
                    gap.as_secs()
                );
                ping_all(&app, "resume");
            } else if ticks.is_multiple_of(PING_EVERY_TICKS) {
                ping_all(&app, "timer");
            }
            if now.duration_since(last_memory_log).unwrap_or_default()
                >= crate::memory_log::INTERVAL
            {
                last_memory_log = now;
                crate::memory_log::log_now(&app).await;
            }
        }
    });
}

/// The page's answer to a liveness ping.
#[tauri::command]
pub fn webview_liveness_pong(
    app: AppHandle,
    webview: tauri::Webview,
    rendered: bool,
    stats: Option<FrontendStats>,
) {
    let label = webview.label().to_string();
    let empty = liveness().answered(&label, rendered, stats, Instant::now());
    if empty {
        reload_webview(&app, &label, "page answered but shows nothing");
    }
}

/// The note a reload left for this window, once.
#[tauri::command]
pub async fn take_webview_recovery(
    app: AppHandle,
    webview: tauri::Webview,
) -> Result<Option<RecoveryNote>, String> {
    let label = webview.label().to_string();
    let Some(recovery) = liveness().take_recovery(&label) else {
        return Ok(None);
    };
    let at = recovery
        .at
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let when = chrono::DateTime::<chrono::Utc>::from(recovery.at).to_rfc3339();
    let report = crate::memory_log::report(&app).await;
    let details = format!(
        "Splitkick recovered from a display crash\nWindow: {label}\nReason: {}\nAt: {when}\n\n{report}",
        recovery.reason
    );
    log::info!("Webview recovery: '{label}' is back ({})", recovery.reason);
    Ok(Some(RecoveryNote {
        reason: recovery.reason,
        at: at.as_millis() as u64,
        details,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LABEL: &str = "main";

    /// A watchdog that met `LABEL` one grace period before the returned time.
    fn started() -> (Liveness, Instant) {
        let mut liveness = Liveness::default();
        let start = Instant::now();
        assert_eq!(liveness.begin_ping(LABEL, start, Duration::ZERO), None);
        (liveness, start + RELOAD_GRACE)
    }

    #[test]
    fn a_new_window_gets_time_to_load_before_the_first_ping() {
        let mut liveness = Liveness::default();
        let start = Instant::now();
        assert_eq!(liveness.begin_ping(LABEL, start, Duration::ZERO), None);
        assert_eq!(
            liveness.begin_ping(LABEL, start + Duration::from_secs(20), Duration::ZERO),
            None
        );
        assert!(liveness
            .begin_ping(LABEL, start + RELOAD_GRACE, Duration::ZERO)
            .is_some());
    }

    fn ping(liveness: &mut Liveness, now: Instant) -> u64 {
        liveness
            .begin_ping(LABEL, now, Duration::ZERO)
            .expect("ping should go out")
    }

    #[test]
    fn an_answering_page_is_never_reloaded() {
        let (mut liveness, start) = started();
        for minute in 0..30 {
            let now = start + Duration::from_secs(60 * minute);
            let token = ping(&mut liveness, now);
            assert!(!liveness.answered(LABEL, true, None, now));
            assert_eq!(liveness.timed_out(LABEL, token), Timeout::Answered);
        }
        assert!(liveness.take_recovery(LABEL).is_none());
    }

    #[test]
    fn two_missed_pings_reload() {
        let (mut liveness, now) = started();
        let first = ping(&mut liveness, now);
        assert_eq!(liveness.timed_out(LABEL, first), Timeout::PingAgain);
        let second = ping(&mut liveness, now);
        assert_eq!(liveness.timed_out(LABEL, second), Timeout::Reload);
    }

    #[test]
    fn a_late_answer_between_misses_cancels_the_reload() {
        let (mut liveness, now) = started();
        let first = ping(&mut liveness, now);
        assert_eq!(liveness.timed_out(LABEL, first), Timeout::PingAgain);
        let second = ping(&mut liveness, now);
        assert!(!liveness.answered(LABEL, true, None, now));
        assert_eq!(liveness.timed_out(LABEL, second), Timeout::Answered);
        // The miss count starts over.
        let third = ping(&mut liveness, now);
        assert_eq!(liveness.timed_out(LABEL, third), Timeout::PingAgain);
    }

    #[test]
    fn no_ping_while_one_is_pending_or_right_after_a_reload() {
        let (mut liveness, now) = started();
        ping(&mut liveness, now);
        assert_eq!(liveness.begin_ping(LABEL, now, Duration::ZERO), None);

        liveness.reloading(LABEL, "test", now, SystemTime::now());
        assert_eq!(
            liveness.begin_ping(LABEL, now + Duration::from_secs(10), Duration::ZERO),
            None
        );
        assert!(liveness
            .begin_ping(LABEL, now + RELOAD_GRACE, Duration::ZERO)
            .is_some());
    }

    #[test]
    fn focus_pings_are_debounced_after_an_answer() {
        let (mut liveness, now) = started();
        liveness.answered(LABEL, true, None, now);
        assert_eq!(liveness.begin_ping(LABEL, now, FOCUS_DEBOUNCE), None);
        assert!(liveness
            .begin_ping(LABEL, now + FOCUS_DEBOUNCE, FOCUS_DEBOUNCE)
            .is_some());
    }

    #[test]
    fn gives_up_after_repeated_reloads_without_an_answer() {
        let (mut liveness, mut now) = started();
        for _ in 0..MAX_UNANSWERED_RELOADS {
            liveness.reloading(LABEL, "test", now, SystemTime::now());
            now += RELOAD_GRACE;
        }
        let first = ping(&mut liveness, now);
        assert_eq!(liveness.timed_out(LABEL, first), Timeout::PingAgain);
        let second = ping(&mut liveness, now);
        assert_eq!(liveness.timed_out(LABEL, second), Timeout::GiveUp);

        // One rendered answer and the watchdog is armed again.
        liveness.answered(LABEL, true, None, now);
        liveness.reloading(LABEL, "test", now, SystemTime::now());
        let later = now + RELOAD_GRACE;
        let first = ping(&mut liveness, later);
        liveness.timed_out(LABEL, first);
        let second = ping(&mut liveness, later);
        assert_eq!(liveness.timed_out(LABEL, second), Timeout::Reload);
    }

    #[test]
    fn an_empty_page_reloads_but_not_while_starting() {
        let (mut liveness, now) = started();
        assert!(liveness.answered(LABEL, false, None, now));

        liveness.reloading(LABEL, "test", now, SystemTime::now());
        assert!(!liveness.answered(LABEL, false, None, now + Duration::from_secs(5)));
        assert!(liveness.answered(LABEL, false, None, now + RELOAD_GRACE));
    }

    #[test]
    fn a_termination_the_watchdog_caused_keeps_its_reason() {
        let (mut liveness, _) = started();
        liveness.ending_content_process(LABEL, "no answer to two liveness pings after resume");
        assert_eq!(
            liveness.termination_reason(LABEL),
            "no answer to two liveness pings after resume"
        );
        // A later crash is WebKit's own.
        assert_eq!(
            liveness.termination_reason(LABEL),
            "web content process terminated"
        );
    }

    #[test]
    fn the_recovery_note_is_taken_once() {
        let mut liveness = Liveness::default();
        liveness.reloading(
            LABEL,
            "web content process terminated",
            Instant::now(),
            SystemTime::now(),
        );
        let note = liveness.take_recovery(LABEL).expect("note");
        assert_eq!(note.reason, "web content process terminated");
        assert!(liveness.take_recovery(LABEL).is_none());
        assert!(liveness.take_recovery("other").is_none());
    }

    #[test]
    fn keeps_the_latest_frontend_stats_per_window() {
        let (mut liveness, now) = started();
        let stats = FrontendStats {
            queries: 12,
            dom_nodes: 3400,
        };
        liveness.answered(LABEL, true, Some(stats.clone()), now);
        liveness.answered(LABEL, true, None, now);
        assert_eq!(liveness.stats(), vec![(LABEL.to_string(), stats)]);
    }
}
