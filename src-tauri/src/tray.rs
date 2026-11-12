//! The menu bar (tray) icon: Claude usage of every account (#127), and the way
//! back into and out of an app with no window (#119).
//!
//! Rust owns the data, because the app may have no window: the loop below reads
//! the shared usage cache, so the tray adds no requests. The frontend only asks
//! for a rebuild when the account list changes (`useTraySync`). macOS and
//! Windows only: on Linux the tray needs a system library that may be missing.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use chrono::TimeZone;
use jean_core::{ClaudeAccountUsage, ClaudeUsageSnapshot};
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use crate::connection_window::{recreate_main_window, MAIN_WINDOW};
use crate::CoreRuntime;

const TRAY_ID: &str = "main";
const USE_ACCOUNT_PREFIX: &str = "tray-use-account:";
const REFRESH_SECS: u64 = 300;
const RESTART_TO_UPDATE_ID: &str = "tray-restart-update";

/// False when the user turned the icon off. Windows has no Dock, so the app
/// must not stay running there without an icon.
static TRAY_VISIBLE: AtomicBool = AtomicBool::new(true);
/// The user chose Quit in the tray, so nothing may keep the app running.
static QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);
/// The app update the main window has downloaded and waits to install (#135).
static UPDATE_READY: Mutex<Option<String>> = Mutex::new(None);

pub(crate) fn quit_requested() -> bool {
    QUIT_REQUESTED.load(Ordering::SeqCst)
}

/// Whether a way back exists once the last window is gone.
pub(crate) fn has_way_back() -> bool {
    cfg!(target_os = "macos") || (cfg!(windows) && TRAY_VISIBLE.load(Ordering::SeqCst))
}

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
enum Severity {
    Normal,
    Warning,
    Critical,
}

impl Severity {
    /// The endpoint's value, or a threshold when it sent none.
    fn of(value: Option<&str>, percent: f64) -> Self {
        match value {
            Some("critical") => Self::Critical,
            Some("warning") => Self::Warning,
            Some(_) => Self::Normal,
            None if percent >= 90.0 => Self::Critical,
            None if percent >= 75.0 => Self::Warning,
            None => Self::Normal,
        }
    }
}

#[derive(Debug, PartialEq)]
struct Row {
    label: String,
    percent: f64,
    resets_at: Option<u64>,
    severity: Severity,
    /// The model a model limit belongs to ("Fable"); `None` for session and
    /// weekly, which count for every model.
    model: Option<String>,
}

/// Session only when the endpoint sends it; model-scoped limits by model name.
fn rows(usage: &ClaudeUsageSnapshot) -> Vec<Row> {
    let mut rows = Vec::new();
    if let Some(session) = &usage.session {
        rows.push(Row {
            label: "Session".to_string(),
            percent: session.used_percent,
            resets_at: session.resets_at,
            severity: Severity::of(None, session.used_percent),
            model: None,
        });
    }
    if let Some(weekly) = &usage.weekly {
        let severity = usage
            .limits
            .iter()
            .find(|limit| limit.kind == "weekly_all")
            .and_then(|limit| limit.severity.as_deref());
        rows.push(Row {
            label: "Weekly".to_string(),
            percent: weekly.used_percent,
            resets_at: weekly.resets_at,
            severity: Severity::of(severity, weekly.used_percent),
            model: None,
        });
    }
    let scoped: Vec<_> = usage
        .limits
        .iter()
        .filter(|limit| limit.kind == "weekly_scoped")
        .collect();
    for limit in &scoped {
        rows.push(Row {
            label: format!("{} weekly", limit.model.as_deref().unwrap_or("Model")),
            percent: limit.used_percent,
            resets_at: limit.resets_at,
            severity: Severity::of(limit.severity.as_deref(), limit.used_percent),
            model: Some(limit.model.clone().unwrap_or_else(|| "Model".to_string())),
        });
    }
    if let (true, Some(sonnet)) = (scoped.is_empty(), &usage.sonnet_weekly) {
        rows.push(Row {
            label: "Sonnet weekly".to_string(),
            percent: sonnet.used_percent,
            resets_at: sonnet.resets_at,
            severity: Severity::of(None, sonnet.used_percent),
            model: Some("Sonnet".to_string()),
        });
    }
    rows
}

/// The menu bar text: the highest limit of the active account, the one new
/// runs use. A model limit counts only for `model`, the default Claude model
/// (a full Fable limit does not block Opus). The menu lists every limit.
fn title(accounts: &[ClaudeAccountUsage], model: &str) -> Option<String> {
    let model = model.to_lowercase();
    let highest = accounts
        .iter()
        .find(|account| account.active)?
        .usage
        .as_ref()
        .map(rows)?
        .into_iter()
        .filter(|row| {
            row.model
                .as_ref()
                .is_none_or(|limit| model.contains(&limit.to_lowercase()))
        })
        .max_by(|a, b| a.percent.total_cmp(&b.percent))?;
    let mark = if highest.severity > Severity::Normal {
        "⚠ "
    } else {
        ""
    };
    Some(format!("{mark}{:.0}%", highest.percent))
}

fn time_until(now: u64, at: u64) -> String {
    let left = at.saturating_sub(now);
    let (days, hours, minutes) = (left / 86_400, left % 86_400 / 3_600, left % 3_600 / 60);
    match (days, hours) {
        (0, 0) => format!("{}m", minutes.max(1)),
        (0, _) => format!("{hours}h {minutes}m"),
        _ => format!("{days}d {hours}h"),
    }
}

fn reset_text(now: u64, at: u64) -> String {
    let full = chrono::Local
        .timestamp_opt(at as i64, 0)
        .single()
        .map(|date| format!(" ({})", date.format("%-d %b %H:%M")))
        .unwrap_or_default();
    format!("resets in {}{full}", time_until(now, at))
}

fn short_error(error: &str) -> &'static str {
    let error = error.to_lowercase();
    if error.contains("expired") {
        "Login expired"
    } else if error.contains("rate-limit") {
        "Rate limited, try again later"
    } else if error.contains("authenticate") || error.contains("sign in") {
        "Not logged in"
    } else {
        "Usage not available"
    }
}

fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

fn account_header(account: &ClaudeAccountUsage) -> String {
    let active = if account.active { " (active)" } else { "" };
    match account.usage.as_ref().and_then(|u| u.plan_type.as_deref()) {
        Some(plan) => format!("{}{active} · {}", account.label, capitalized(plan)),
        None => format!("{}{active}", account.label),
    }
}

/// The lines under an account's header. Weekly is always there.
fn account_lines(account: &ClaudeAccountUsage, now: u64) -> Vec<String> {
    let Some(usage) = &account.usage else {
        let error = account.error.as_deref().unwrap_or_default();
        return vec![format!("  ⚠ {}", short_error(error))];
    };
    let rows = rows(usage);
    let mut lines: Vec<String> = rows
        .iter()
        .map(|row| {
            let reset = row
                .resets_at
                .map(|at| format!("   {}", reset_text(now, at)))
                .unwrap_or_default();
            format!("  {}   {:.0}%{reset}", row.label, row.percent)
        })
        .collect();
    if usage.weekly.is_none() {
        lines.insert(0, "  Weekly   –".to_string());
    }
    lines
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn restart_to_update_label(version: &str) -> String {
    format!("Restart to update to {version}")
}

fn build_menu(app: &AppHandle, accounts: &[ClaudeAccountUsage]) -> tauri::Result<Menu<Wry>> {
    let now = now_unix();
    let menu = Menu::new(app)?;
    let update_ready = UPDATE_READY.lock().ok().and_then(|ready| ready.clone());
    if let Some(version) = update_ready {
        menu.append(&MenuItem::with_id(
            app,
            RESTART_TO_UPDATE_ID,
            restart_to_update_label(&version),
            true,
            None::<&str>,
        )?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    for account in accounts {
        menu.append(&MenuItem::new(
            app,
            account_header(account),
            false,
            None::<&str>,
        )?)?;
        for line in account_lines(account, now) {
            menu.append(&MenuItem::new(app, line, false, None::<&str>)?)?;
        }
    }
    if !accounts.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    if accounts.len() > 1 {
        let items = accounts
            .iter()
            .map(|account| {
                CheckMenuItem::with_id(
                    app,
                    format!("{USE_ACCOUNT_PREFIX}{}", account.account_id),
                    &account.label,
                    true,
                    account.active,
                    None::<&str>,
                )
            })
            .collect::<tauri::Result<Vec<_>>>()?;
        let items: Vec<&dyn IsMenuItem<Wry>> = items
            .iter()
            .map(|item| item as &dyn IsMenuItem<Wry>)
            .collect();
        menu.append(&Submenu::with_items(app, "Use account", true, &items)?)?;
    }
    let name = app.package_info().name.clone();
    let product = app.config().product_name.clone().unwrap_or(name);
    menu.append(&MenuItem::with_id(
        app,
        "tray-refresh",
        "Refresh now",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "tray-open",
        format!("Open {product}"),
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "tray-quit",
        format!("Quit {product}"),
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

/// Reads the preference, the usage, and rebuilds the icon's menu and title.
pub(crate) async fn refresh(app: &AppHandle, skip_cache: bool) -> Result<(), String> {
    let core = app.state::<CoreRuntime>().0.clone();
    let preferences = jean_core::http_server::dispatch::dispatch_command(
        &core,
        "load_preferences",
        serde_json::json!({}),
    )
    .await?;
    let visible = preferences
        .get("show_in_menu_bar")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true);
    TRAY_VISIBLE.store(visible, Ordering::SeqCst);
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_visible(visible).map_err(|e| e.to_string())?;
    if !visible {
        return Ok(());
    }
    let accounts = if skip_cache {
        jean_core::refresh_claude_accounts_usage(core).await?
    } else {
        jean_core::get_claude_accounts_usage(core).await?
    };
    let menu = build_menu(app, &accounts).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    let model = preferences
        .get("selected_model")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    tray.set_title(title(&accounts, model))
        .map_err(|e| e.to_string())
}

fn refresh_in_background(app: &AppHandle, skip_cache: bool) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = refresh(&app, skip_cache).await {
            log::warn!("Failed to update the menu bar icon: {error}");
        }
        // Refresh may have asked the Claude CLI to renew an idle account's
        // token (#134): show its live figures once that is done.
        if skip_cache {
            jean_core::claude_usage_renews_settled().await;
            if let Err(error) = refresh(&app, false).await {
                log::warn!("Failed to update the menu bar icon: {error}");
            }
        }
    });
}

fn open_window(app: &AppHandle) {
    if let Err(error) = recreate_main_window(app) {
        log::warn!("Failed to open the main window from the tray: {error}");
    }
}

fn use_account(app: &AppHandle, account_id: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let value = (account_id != "root").then_some(account_id);
        let core = app.state::<CoreRuntime>().0.clone();
        // The command Preferences uses, so its view updates too.
        let result = jean_core::http_server::dispatch::dispatch_command(
            &core,
            "patch_preferences",
            serde_json::json!({ "patch": { "claude_active_account": value } }),
        )
        .await;
        if let Err(error) = result {
            log::warn!("Failed to change the Claude account: {error}");
        }
        if let Err(error) = refresh(&app, false).await {
            log::warn!("Failed to update the menu bar icon: {error}");
        }
    });
}

/// The main window holds the downloaded package, so it installs it and
/// relaunches, the same as its own "Restart Now".
fn restart_to_update(app: &AppHandle) {
    open_window(app);
    if let Err(error) = app.emit_to(MAIN_WINDOW, "tray-restart-to-update", ()) {
        log::warn!("Failed to ask the main window to restart for the update: {error}");
    }
}

/// The main window reports a downloaded update (`Some`), or that it has none
/// (`None`, on start). Rebuilds the menu with or without "Restart to update".
#[tauri::command]
pub(crate) async fn set_tray_update_ready(
    app: AppHandle,
    version: Option<String>,
) -> Result<(), String> {
    *UPDATE_READY.lock().map_err(|e| e.to_string())? = version;
    refresh(&app, false).await
}

fn quit(app: &AppHandle) {
    if !jean_core::has_nonsurvivable_running_sessions() {
        QUIT_REQUESTED.store(true, Ordering::SeqCst);
        app.exit(0);
        return;
    }
    let confirmed = app.clone();
    app.dialog()
        .message("One or more sessions are actively processing. Quitting now will interrupt them.")
        .title("Sessions are still running")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit Anyway".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |quit_anyway| {
            if quit_anyway {
                QUIT_REQUESTED.store(true, Ordering::SeqCst);
                confirmed.exit(0);
            }
        });
}

/// Adds the icon and keeps it up to date. The icon starts with Open and Quit,
/// so it works before the first usage data arrives.
pub(crate) fn install(app: &AppHandle) -> tauri::Result<()> {
    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&build_menu(app, &[])?)
        // On Windows a left click opens the window and a right click the menu.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-refresh" => refresh_in_background(app, true),
            "tray-open" => open_window(app),
            "tray-quit" => quit(app),
            RESTART_TO_UPDATE_ID => restart_to_update(app),
            id => {
                if let Some(account_id) = id.strip_prefix(USE_ACCOUNT_PREFIX) {
                    use_account(app, account_id.to_string());
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if cfg!(windows) {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    open_window(tray.app_handle());
                }
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder
        .icon(tauri::include_image!("icons/tray-template.png"))
        .icon_as_template(true);
    #[cfg(not(target_os = "macos"))]
    let builder = match app.default_window_icon() {
        Some(icon) => builder.icon(icon.clone()),
        None => builder,
    };
    builder.build(app)?;

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = refresh(&app, false).await {
                log::warn!("Failed to update the menu bar icon: {error}");
            }
            tokio::time::sleep(std::time::Duration::from_secs(REFRESH_SECS)).await;
        }
    });
    Ok(())
}

/// Rebuild after the frontend changed the account list or the preference.
#[tauri::command]
pub(crate) async fn refresh_tray(app: AppHandle) -> Result<(), String> {
    if cfg!(any(target_os = "macos", windows)) {
        refresh(&app, false).await
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jean_core::{ClaudeUsageLimitSnapshot, ClaudeUsageWindowSnapshot};

    #[test]
    fn restart_to_update_names_the_version() {
        assert_eq!(
            restart_to_update_label("1.5.15"),
            "Restart to update to 1.5.15"
        );
    }

    fn window(used_percent: f64) -> Option<ClaudeUsageWindowSnapshot> {
        Some(ClaudeUsageWindowSnapshot {
            used_percent,
            resets_at: None,
        })
    }

    fn usage(session: Option<f64>, weekly: Option<f64>) -> ClaudeUsageSnapshot {
        ClaudeUsageSnapshot {
            plan_type: Some("ultra".to_string()),
            account_email: None,
            session: session.and_then(window),
            weekly: weekly.and_then(window),
            sonnet_weekly: None,
            limits: Vec::new(),
            extra_usage_spent: None,
            extra_usage_limit: None,
            fetched_at: 0,
            renewing: false,
        }
    }

    fn limit(
        kind: &str,
        percent: f64,
        severity: &str,
        model: Option<&str>,
    ) -> ClaudeUsageLimitSnapshot {
        ClaudeUsageLimitSnapshot {
            kind: kind.to_string(),
            used_percent: percent,
            severity: Some(severity.to_string()),
            resets_at: None,
            model: model.map(str::to_string),
        }
    }

    fn account(label: &str, usage: Option<ClaudeUsageSnapshot>) -> ClaudeAccountUsage {
        ClaudeAccountUsage {
            account_id: label.to_string(),
            label: label.to_string(),
            active: false,
            usage,
            error: None,
        }
    }

    #[test]
    fn session_is_hidden_when_the_endpoint_sends_none() {
        let labels: Vec<_> = rows(&usage(None, Some(40.0)))
            .into_iter()
            .map(|row| row.label)
            .collect();
        assert_eq!(labels, ["Weekly"]);
    }

    #[test]
    fn session_and_model_limits_are_shown() {
        let mut snapshot = usage(Some(12.0), Some(40.0));
        snapshot.limits = vec![limit("weekly_scoped", 34.0, "normal", Some("Fable"))];
        let labels: Vec<_> = rows(&snapshot).into_iter().map(|row| row.label).collect();
        assert_eq!(labels, ["Session", "Weekly", "Fable weekly"]);
    }

    #[test]
    fn weekly_is_always_listed() {
        let lines = account_lines(&account("A", Some(usage(None, None))), 0);
        assert_eq!(lines, ["  Weekly   –"]);
    }

    fn active(mut item: ClaudeAccountUsage) -> ClaudeAccountUsage {
        item.active = true;
        item
    }

    #[test]
    fn title_is_the_active_account_even_when_another_is_higher() {
        let accounts = [
            active(account("A", Some(usage(Some(12.0), Some(40.0))))),
            account("B", Some(usage(None, Some(98.0)))),
            account("C", None),
        ];
        assert_eq!(title(&accounts, "claude-fable-5-1").as_deref(), Some("40%"));
    }

    #[test]
    fn title_counts_a_model_limit_only_for_the_default_model() {
        let mut snapshot = usage(None, Some(70.0));
        snapshot.limits = vec![limit("weekly_scoped", 100.0, "critical", Some("Fable"))];
        let accounts = [active(account("A", Some(snapshot)))];
        assert_eq!(
            title(&accounts, "claude-fable-5-1").as_deref(),
            Some("⚠ 100%")
        );
        assert_eq!(title(&accounts, "claude-opus-5-5").as_deref(), Some("70%"));
    }

    #[test]
    fn title_is_empty_without_an_active_account() {
        let accounts = [account("A", Some(usage(None, Some(60.0))))];
        assert_eq!(title(&accounts, "claude-fable-5-1"), None);
    }

    #[test]
    fn title_marks_a_limit_the_endpoint_calls_critical() {
        let mut snapshot = usage(None, Some(60.0));
        snapshot.limits = vec![limit("weekly_all", 60.0, "critical", None)];
        assert_eq!(
            title(&[active(account("A", Some(snapshot)))], "claude-fable-5-1").as_deref(),
            Some("⚠ 60%")
        );
    }

    #[test]
    fn title_is_empty_without_data() {
        assert_eq!(
            title(&[active(account("A", None))], "claude-fable-5-1"),
            None
        );
    }

    #[test]
    fn an_error_does_not_hide_the_other_accounts() {
        let mut broken = account("A", None);
        broken.error =
            Some("Claude OAuth credentials missing. Run `claude` to authenticate.".into());
        assert_eq!(account_lines(&broken, 0), ["  ⚠ Not logged in"]);
        assert_eq!(
            title(
                &[broken, active(account("B", Some(usage(None, Some(5.0)))))],
                "claude-fable-5-1"
            )
            .as_deref(),
            Some("5%")
        );
    }

    #[test]
    fn time_until_uses_the_largest_units() {
        assert_eq!(time_until(0, 2 * 86_400 + 7 * 3_600), "2d 7h");
        assert_eq!(time_until(0, 3 * 3_600 + 120), "3h 2m");
        assert_eq!(time_until(0, 300), "5m");
        assert_eq!(time_until(100, 50), "1m");
    }

    #[test]
    fn the_header_names_the_active_account_and_plan() {
        let mut item = account("Planetfall", Some(usage(None, Some(1.0))));
        item.active = true;
        assert_eq!(account_header(&item), "Planetfall (active) · Ultra");
    }
}
