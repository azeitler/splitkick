//! Find which developer tools are installed, by macOS bundle identifier.
//!
//! The ids on the left are the preference values the frontend stores
//! (`editor`, `terminal`, `git_client`).

/// Tool id → bundle identifiers (any one counts as installed). The first
/// bundle id is the one `open -b` launches.
pub(crate) const KNOWN_APPS: &[(&str, &[&str])] = &[
    // Editors
    ("zed", &["dev.zed.Zed"]),
    ("vscode", &["com.microsoft.VSCode"]),
    ("vscodium", &["com.vscodium"]),
    ("cursor", &["com.todesktop.230313mzl4w4u92"]),
    ("xcode", &["com.apple.dt.Xcode"]),
    (
        "intellij",
        &["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
    ),
    ("sublime", &["com.sublimetext.4", "com.sublimetext.3"]),
    // Terminals
    ("terminal", &["com.apple.Terminal"]),
    ("warp", &["dev.warp.Warp-Stable"]),
    ("ghostty", &["com.mitchellh.ghostty"]),
    ("iterm2", &["com.googlecode.iterm2"]),
    // Git clients
    ("tower", &["com.fournova.Tower3"]),
    ("fork", &["com.DanPristupov.Fork"]),
    ("github-desktop", &["com.github.GitHubClient"]),
    ("sourcetree", &["com.torusknot.SourceTreeNotMac"]),
];

/// The tool ids with at least one bundle id that `is_installed` accepts.
pub(crate) fn installed_tool_ids(is_installed: impl Fn(&str) -> bool) -> Vec<String> {
    KNOWN_APPS
        .iter()
        .filter(|(_, bundle_ids)| bundle_ids.iter().any(|id| is_installed(id)))
        .map(|(tool, _)| tool.to_string())
        .collect()
}

/// The installed bundle id for a tool, else its first known one.
pub(crate) fn bundle_id_for(tool: &str) -> Option<&'static str> {
    let (_, bundle_ids) = KNOWN_APPS.iter().find(|(id, _)| *id == tool)?;
    #[cfg(target_os = "macos")]
    if let Some(id) = bundle_ids.iter().find(|id| is_bundle_installed(id)) {
        return Some(id);
    }
    bundle_ids.first().copied()
}

/// Ask Launch Services whether an app with this bundle id is installed.
#[cfg(target_os = "macos")]
pub(crate) fn is_bundle_installed(bundle_id: &str) -> bool {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::NSString;
    NSWorkspace::sharedWorkspace()
        .URLForApplicationWithBundleIdentifier(&NSString::from_str(bundle_id))
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_tools_with_any_installed_bundle_id() {
        let installed =
            installed_tool_ids(|id| matches!(id, "com.fournova.Tower3" | "com.sublimetext.3"));
        assert_eq!(installed, vec!["sublime".to_string(), "tower".to_string()]);
    }

    #[test]
    fn lists_nothing_when_nothing_is_installed() {
        assert!(installed_tool_ids(|_| false).is_empty());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn launch_services_finds_terminal_but_not_a_made_up_app() {
        assert!(is_bundle_installed("com.apple.Terminal"));
        assert!(!is_bundle_installed("com.example.does-not-exist"));
    }

    #[test]
    fn unknown_tool_has_no_bundle_id() {
        assert_eq!(bundle_id_for("notepad"), None);
    }
}
