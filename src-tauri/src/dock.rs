//! The macOS dock icon: unread badge and right-click menu.
//!
//! The frontend owns the data (it already knows the unread sessions) and
//! pushes it here: `set_dock_badge` for the count, `set_dock_sessions` for the
//! menu. tao has no dock menu API, so `install` adds `applicationDockMenu:` to
//! tao's app delegate class at runtime.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::connection_window::MAIN_WINDOW;

/// A session the main window can open: `open-session-request` payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionTarget {
    pub project_id: String,
    pub worktree_id: String,
    pub session_id: String,
}

/// A dock menu entry.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockSession {
    pub title: String,
    #[serde(flatten)]
    pub target: SessionTarget,
}

/// Brings the main window to the front and asks it to open a session.
/// Used by the dock menu and by a click on a notification.
pub(crate) fn open_session(app: &AppHandle, target: &SessionTarget) {
    if let Err(error) = crate::connection_window::recreate_main_window(app) {
        log::warn!("Failed to open the main window for a session: {error}");
        return;
    }
    let _ = app.emit_to(
        tauri::EventTarget::webview_window(MAIN_WINDOW),
        "open-session-request",
        target,
    );
}

/// Dock badge: `0` removes it. macOS only; a no-op elsewhere.
#[tauri::command]
pub fn set_dock_badge(window: tauri::WebviewWindow, count: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let count = (count > 0).then_some(i64::from(count));
        window
            .set_badge_count(count)
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, count);
        Ok(())
    }
}

/// Sessions listed in the dock menu, most relevant first.
#[tauri::command]
pub fn set_dock_sessions(sessions: Vec<DockSession>) {
    #[cfg(target_os = "macos")]
    {
        *mac::SESSIONS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = sessions;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = sessions;
}

#[cfg(target_os = "macos")]
pub(crate) use mac::install;

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::{OnceCell, RefCell};
    use std::sync::{Mutex, OnceLock};

    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Imp, NSObject, Sel};
    use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
    use objc2_foundation::NSString;
    use tauri::{AppHandle, Emitter};

    use super::{open_session, DockSession};
    use crate::connection_window::MAIN_WINDOW;

    pub(super) static SESSIONS: Mutex<Vec<DockSession>> = Mutex::new(Vec::new());
    static APP: OnceLock<AppHandle> = OnceLock::new();

    thread_local! {
        static TARGET: OnceCell<Retained<DockMenuTarget>> = const { OnceCell::new() };
        /// The entries of the menu on screen. A click reads its session from
        /// here, not from `SESSIONS`, which may have changed since.
        static SHOWN: RefCell<Vec<DockSession>> = const { RefCell::new(Vec::new()) };
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "JeanDockMenuTarget"]
        struct DockMenuTarget;

        impl DockMenuTarget {
            #[unsafe(method(openSession:))]
            fn open_session_item(&self, sender: &NSMenuItem) {
                let index = usize::try_from(sender.tag()).ok();
                let session = SHOWN.with(|shown| {
                    index.and_then(|index| shown.borrow().get(index).cloned())
                });
                if let (Some(app), Some(session)) = (APP.get(), session) {
                    open_session(app, &session.target);
                }
            }

            #[unsafe(method(newWorktree:))]
            fn new_worktree(&self, _sender: &NSMenuItem) {
                let Some(app) = APP.get() else { return };
                if let Err(error) = crate::connection_window::recreate_main_window(app) {
                    log::warn!("Failed to open the main window: {error}");
                    return;
                }
                let _ = app.emit_to(
                    tauri::EventTarget::webview_window(MAIN_WINDOW),
                    "menu-keybinding",
                    "new_worktree",
                );
            }
        }
    );

    fn menu_item(mtm: MainThreadMarker, title: &str, action: Sel) -> Retained<NSMenuItem> {
        unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(mtm),
                &NSString::from_str(title),
                Some(action),
                &NSString::from_str(""),
            )
        }
    }

    fn build_menu(mtm: MainThreadMarker) -> Retained<NSMenu> {
        let menu = NSMenu::new(mtm);
        let sessions = SESSIONS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        TARGET.with(|target| {
            let target =
                target.get_or_init(|| unsafe { msg_send![DockMenuTarget::alloc(mtm), init] });
            for (index, session) in sessions.iter().enumerate() {
                let item = menu_item(mtm, &session.title, sel!(openSession:));
                item.setTag(index as isize);
                unsafe { item.setTarget(Some(target)) };
                menu.addItem(&item);
            }
            if !sessions.is_empty() {
                menu.addItem(&NSMenuItem::separatorItem(mtm));
            }
            let item = menu_item(mtm, "New Worktree", sel!(newWorktree:));
            unsafe { item.setTarget(Some(target)) };
            menu.addItem(&item);
        });
        SHOWN.with(|shown| *shown.borrow_mut() = sessions);
        menu
    }

    unsafe extern "C-unwind" fn application_dock_menu(
        _this: &AnyObject,
        _cmd: Sel,
        _sender: &AnyObject,
    ) -> *mut NSMenu {
        let Some(mtm) = MainThreadMarker::new() else {
            return std::ptr::null_mut();
        };
        Retained::autorelease_return(build_menu(mtm))
    }

    /// Adds `applicationDockMenu:` to tao's app delegate. Runs during setup,
    /// on the main thread, after tao has set its delegate.
    pub(crate) fn install(app: &AppHandle) {
        let _ = APP.set(app.clone());
        let Some(mtm) = MainThreadMarker::new() else {
            log::warn!("Dock menu not installed: setup is not on the main thread");
            return;
        };
        let Some(class) = AnyClass::get(c"TaoAppDelegateParent") else {
            log::warn!("Dock menu not installed: tao's app delegate class is missing");
            return;
        };
        type DockMenuImp = unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> *mut NSMenu;
        let imp: DockMenuImp = application_dock_menu;
        let added = unsafe {
            objc2::ffi::class_addMethod(
                class as *const AnyClass as *mut AnyClass,
                sel!(applicationDockMenu:),
                std::mem::transmute::<DockMenuImp, Imp>(imp),
                c"@@:@".as_ptr(),
            )
        };
        if !added.as_bool() {
            log::warn!("Dock menu not installed: the delegate already has applicationDockMenu:");
            return;
        }
        // NSApplication caches which delegate methods exist when the delegate
        // is set. Set it again so it sees the new one.
        let ns_app = NSApplication::sharedApplication(mtm);
        let delegate = ns_app.delegate();
        ns_app.setDelegate(delegate.as_deref());
    }
}

#[cfg(test)]
mod tests {
    use super::DockSession;

    #[test]
    fn reads_a_dock_session_from_the_frontend() {
        let session: DockSession = serde_json::from_value(serde_json::json!({
            "title": "Fix login · Input required",
            "projectId": "p",
            "worktreeId": "w",
            "sessionId": "s",
        }))
        .unwrap();
        assert_eq!(session.title, "Fix login · Input required");
        assert_eq!(session.target.session_id, "s");
        assert_eq!(session.target.project_id, "p");
    }
}
