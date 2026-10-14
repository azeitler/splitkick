//! The macOS menu bar.
//!
//! Items backed by a keybinding action use the id `kb:<action>` and reach the
//! frontend as `menu-keybinding` with the action as payload. Items backed by a
//! command palette command use `cmd:<command-id>` and reach it as
//! `menu-command`. Their accelerators start empty and are set by the frontend
//! through `set_menu_accelerators`, so the menu always shows the user's own
//! keybindings instead of a copy of the defaults.

use std::collections::HashMap;

#[cfg(target_os = "macos")]
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Emitter, Manager,
};

const KEYBINDING_PREFIX: &str = "kb:";
const COMMAND_PREFIX: &str = "cmd:";

/// Frontend event and payload for a menu item id.
pub(crate) fn menu_event(id: &str) -> Option<(&'static str, Option<&str>)> {
    if let Some(action) = id.strip_prefix(KEYBINDING_PREFIX) {
        return Some(("menu-keybinding", Some(action)));
    }
    if let Some(command) = id.strip_prefix(COMMAND_PREFIX) {
        return Some(("menu-command", Some(command)));
    }
    match id {
        "about" => Some(("menu-about", None)),
        "check-updates" => Some(("menu-check-updates", None)),
        "toggle-right-sidebar" => Some(("menu-toggle-right-sidebar", None)),
        _ => None,
    }
}

/// Converts a Jean shortcut (`mod+shift+b`) into a Tauri accelerator
/// (`CmdOrCtrl+Shift+B`).
///
/// Returns `None` for shortcuts that must stay with the web view: a key
/// without Cmd, Ctrl or Alt would fire from the menu while the user types.
pub(crate) fn keybinding_to_accelerator(shortcut: &str) -> Option<String> {
    let mut modifiers = Vec::new();
    let mut key = None;
    for part in shortcut.split('+') {
        match part {
            "mod" => modifiers.push("CmdOrCtrl"),
            "ctrl" => modifiers.push("Ctrl"),
            "alt" => modifiers.push("Alt"),
            "shift" => modifiers.push("Shift"),
            other => key = Some(other),
        }
    }
    if !modifiers
        .iter()
        .any(|modifier| matches!(*modifier, "CmdOrCtrl" | "Ctrl" | "Alt"))
    {
        return None;
    }
    let key = match key? {
        "comma" => "Comma".to_string(),
        "period" => "Period".to_string(),
        "slash" => "Slash".to_string(),
        "backslash" => "Backslash".to_string(),
        "backquote" => "Backquote".to_string(),
        "bracketleft" => "BracketLeft".to_string(),
        "bracketright" => "BracketRight".to_string(),
        "semicolon" => "Semicolon".to_string(),
        "quote" => "Quote".to_string(),
        "minus" => "Minus".to_string(),
        "equal" => "Equal".to_string(),
        "arrowup" => "ArrowUp".to_string(),
        "arrowdown" => "ArrowDown".to_string(),
        "arrowleft" => "ArrowLeft".to_string(),
        "arrowright" => "ArrowRight".to_string(),
        "enter" => "Enter".to_string(),
        "tab" => "Tab".to_string(),
        "escape" => "Escape".to_string(),
        "backspace" => "Backspace".to_string(),
        "space" => "Space".to_string(),
        letter if letter.len() == 1 => letter.to_uppercase(),
        _ => return None,
    };
    Some(format!("{}+{key}", modifiers.join("+")))
}

#[cfg(target_os = "macos")]
fn keybinding_item(
    app: &tauri::App,
    action: &str,
    label: &str,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    MenuItemBuilder::with_id(format!("{KEYBINDING_PREFIX}{action}"), label).build(app)
}

#[cfg(target_os = "macos")]
fn command_item(
    app: &tauri::App,
    command: &str,
    label: &str,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    MenuItemBuilder::with_id(format!("{COMMAND_PREFIX}{command}"), label).build(app)
}

#[cfg(target_os = "macos")]
pub(crate) fn create_app_menu(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Read the name from the config so build flavors (see tauri.fork.conf.json)
    // get their own menu title instead of a hardcoded "Jean".
    let app_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| jean_core::brand::PRODUCT_NAME.to_string());
    let hide_label = format!("Hide {app_name}");
    let quit_label = format!("Quit {app_name}");

    let app_menu = SubmenuBuilder::new(app, &app_name)
        .item(&MenuItemBuilder::with_id("about", format!("About {app_name}")).build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("check-updates", "Check for Updates…").build(app)?)
        .separator()
        .item(&keybinding_item(app, "open_preferences", "Settings…")?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(hide_label.as_str()))?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some(quit_label.as_str()))?)
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&keybinding_item(app, "new_session", "New Session")?)
        .item(&keybinding_item(
            app,
            "open_new_session_modal",
            "New Session…",
        )?)
        .item(&keybinding_item(app, "new_worktree", "New Worktree")?)
        .item(&command_item(app, "add-project", "Add Project…")?)
        .separator()
        .item(&keybinding_item(app, "open_in_modal", "Open In…")?)
        .item(&keybinding_item(app, "open_commit_modal", "Commit…")?)
        .separator()
        .item(&keybinding_item(
            app,
            "close_session_or_worktree",
            "Close Session",
        )?)
        .item(&keybinding_item(
            app,
            "restore_last_archived",
            "Restore Last Archived",
        )?)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&keybinding_item(app, "search_chat", "Find…")?)
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&keybinding_item(
            app,
            "toggle_left_sidebar",
            "Toggle Left Sidebar",
        )?)
        .item(&keybinding_item(
            app,
            "toggle_file_browser",
            "Toggle File Browser",
        )?)
        .item(&MenuItemBuilder::with_id("toggle-right-sidebar", "Toggle Right Sidebar").build(app)?)
        .separator()
        .item(&keybinding_item(app, "toggle_terminal", "Toggle Terminal")?)
        .item(&keybinding_item(app, "toggle_browser", "Toggle Browser")?)
        .separator()
        .item(&keybinding_item(app, "open_git_diff", "Git Diff")?)
        .item(&keybinding_item(
            app,
            "open_github_dashboard",
            "GitHub Dashboard",
        )?)
        .separator()
        .item(&keybinding_item(app, "toggle_zen_mode", "Zen Mode")?)
        .build()?;
    let go_menu = SubmenuBuilder::new(app, "Go")
        .item(&keybinding_item(app, "navigate_back", "Back")?)
        .item(&keybinding_item(app, "navigate_forward", "Forward")?)
        .separator()
        .item(&keybinding_item(app, "next_session", "Next Session")?)
        .item(&keybinding_item(
            app,
            "previous_session",
            "Previous Session",
        )?)
        .item(&keybinding_item(
            app,
            "open_unread_sessions",
            "Unread Sessions",
        )?)
        .separator()
        .item(&keybinding_item(
            app,
            "focus_chat_input",
            "Focus Chat Input",
        )?)
        .build()?;
    let session_menu = SubmenuBuilder::new(app, "Session")
        .item(&keybinding_item(app, "execute_run", "Run")?)
        .item(&keybinding_item(app, "cancel_prompt", "Cancel Prompt")?)
        .separator()
        .item(&keybinding_item(app, "toggle_session_label", "Label…")?)
        .item(&keybinding_item(
            app,
            "clear_session_context",
            "Clear Context",
        )?)
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&keybinding_item(app, "open_magic_modal", "Magic Menu")?)
        .item(&keybinding_item(app, "open_quick_menu", "Quick Menu")?)
        .separator()
        // Not the predefined Minimize: that one claims Cmd+M, which is the
        // Magic Menu here, and AppKit would list both with the same shortcut.
        .item(&MenuItemBuilder::with_id("minimize", "Minimize").build(app)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&command_item(app, "help.feature-tour", "Feature Tour")?)
        .item(&command_item(
            app,
            "help.install-ai-backends",
            "Install AI Backends",
        )?)
        .build()?;
    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&go_menu)
        .item(&session_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;
    app.set_menu(menu)?;
    // AppKit then lists every open window at the bottom of this menu, so a
    // connection window can be found and raised from there.
    window_menu.set_as_windows_menu_for_nsapp()?;
    // AppKit adds the menu search field to this one.
    help_menu.set_as_help_menu_for_nsapp()?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn install_menu_events(app: &tauri::App) {
    app.on_menu_event(|app, event| {
        let focused = app.get_focused_window();
        if event.id().as_ref() == "minimize" {
            if let Some(window) = focused {
                let _ = window.minimize();
            }
            return;
        }
        let Some((frontend_event, payload)) = menu_event(event.id().as_ref()) else {
            return;
        };
        // The menu belongs to the application, so send the event to the one
        // window the user is looking at. `listenMenu` in `src/lib/transport.ts`
        // registers for this label — a listener with no target would receive
        // every emit regardless of the filter.
        let label = focused
            .map(|window| window.label().to_string())
            .unwrap_or_else(|| crate::connection_window::MAIN_WINDOW.to_string());
        let _ = app.emit_to(
            tauri::EventTarget::webview_window(label),
            frontend_event,
            payload,
        );
    });
}

/// Show the user's keybindings next to the menu items: action → shortcut.
/// Actions without a menu item are ignored.
#[tauri::command]
pub fn set_menu_accelerators(
    app: tauri::AppHandle,
    keybindings: HashMap<String, String>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let Some(menu) = app.menu() else {
            return Ok(());
        };
        for (action, shortcut) in keybindings {
            let id = format!("{KEYBINDING_PREFIX}{action}");
            // `Menu::get` only looks at the top level, so search the submenus.
            let item = menu.items().ok().into_iter().flatten().find_map(|entry| {
                entry
                    .as_submenu()
                    .and_then(|submenu| submenu.get(&id))
                    .and_then(|item| item.as_menuitem().cloned())
            });
            if let Some(item) = item {
                // One shortcut the menu cannot show must not hide the others.
                if let Err(error) = item.set_accelerator(keybinding_to_accelerator(&shortcut)) {
                    log::warn!("Menu cannot show {shortcut} for {action}: {error}");
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, keybindings);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{keybinding_to_accelerator, menu_event};

    #[test]
    fn converts_modifier_shortcuts() {
        for (shortcut, accelerator) in [
            ("mod+b", "CmdOrCtrl+B"),
            ("mod+shift+b", "CmdOrCtrl+Shift+B"),
            ("mod+comma", "CmdOrCtrl+Comma"),
            ("mod+period", "CmdOrCtrl+Period"),
            ("mod+backquote", "CmdOrCtrl+Backquote"),
            ("mod+shift+backquote", "CmdOrCtrl+Shift+Backquote"),
            ("mod+bracketleft", "CmdOrCtrl+BracketLeft"),
            ("mod+alt+arrowright", "CmdOrCtrl+Alt+ArrowRight"),
            ("mod+alt+backspace", "CmdOrCtrl+Alt+Backspace"),
            ("mod+shift+alt+t", "CmdOrCtrl+Shift+Alt+T"),
            ("mod+ctrl+z", "CmdOrCtrl+Ctrl+Z"),
            ("mod+1", "CmdOrCtrl+1"),
        ] {
            assert_eq!(
                keybinding_to_accelerator(shortcut).as_deref(),
                Some(accelerator),
                "{shortcut}"
            );
        }
    }

    #[test]
    fn leaves_plain_keys_to_the_web_view() {
        for shortcut in [
            "p",
            "slash",
            "arrowup",
            "shift+tab",
            "shift+a",
            "",
            "mod+unknownkey",
        ] {
            assert_eq!(keybinding_to_accelerator(shortcut), None, "{shortcut}");
        }
    }

    #[test]
    fn routes_menu_items_to_frontend_events() {
        assert_eq!(
            menu_event("kb:toggle_terminal"),
            Some(("menu-keybinding", Some("toggle_terminal")))
        );
        assert_eq!(
            menu_event("cmd:add-project"),
            Some(("menu-command", Some("add-project")))
        );
        assert_eq!(menu_event("about"), Some(("menu-about", None)));
        assert_eq!(
            menu_event("check-updates"),
            Some(("menu-check-updates", None))
        );
        assert_eq!(
            menu_event("toggle-right-sidebar"),
            Some(("menu-toggle-right-sidebar", None))
        );
        assert_eq!(menu_event("copy"), None);
        assert_eq!(menu_event("minimize"), None);
    }
}
