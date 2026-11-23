//! Save this instance's Web Access connection as a 1Password item.
//!
//! Runs the 1Password CLI (`op`) only when the user clicks "Add to 1Password"
//! in Settings → Web Access. The access token goes to `op` as a JSON item
//! template on **stdin**, never on argv (`docs/developer/process-secrets.md`).
//!
//! `op` docs: <https://developer.1password.com/docs/cli/item-create>
//! (`op item create … -` reads a template from stdin),
//! <https://developer.1password.com/docs/cli/item-template-json>
//! (template shape) and
//! <https://developer.1password.com/docs/cli/reference/management-commands/item>
//! (`op item edit <id>` with a piped template, `op item list --tags`).

use std::ffi::{OsStr, OsString};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

/// Tag on every item Splitkick writes. "Add to 1Password" updates only an
/// item that has this tag and the same title, never an item the user made.
pub const ITEM_TAG: &str = "splitkick";

/// Places a GUI app does not have on its PATH (Homebrew, the .pkg installer).
const FALLBACK_OP_PATHS: &[&str] = &["/opt/homebrew/bin/op", "/usr/local/bin/op"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnePasswordStatus {
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnePasswordSaveResult {
    pub title: String,
    /// True when an earlier Splitkick item with this title was updated.
    pub updated: bool,
}

/// An access URL and the label 1Password shows next to it.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct ItemUrl {
    pub label: String,
    pub href: String,
}

fn op_file_name() -> &'static str {
    if cfg!(windows) {
        "op.exe"
    } else {
        "op"
    }
}

/// Find `op` in `path_var` (a PATH value), then in the fixed install paths.
pub fn find_op_in(path_var: Option<&OsStr>, fallbacks: &[&str]) -> Option<PathBuf> {
    let name = op_file_name();
    path_var
        .into_iter()
        .flat_map(std::env::split_paths)
        .map(|dir| dir.join(name))
        .chain(fallbacks.iter().map(PathBuf::from))
        .find(|candidate| candidate.is_file())
}

pub fn find_op() -> Option<PathBuf> {
    let path_var: Option<OsString> = std::env::var_os("PATH");
    find_op_in(path_var.as_deref(), FALLBACK_OP_PATHS)
}

pub fn onepassword_status() -> OnePasswordStatus {
    OnePasswordStatus {
        installed: find_op().is_some(),
    }
}

pub fn item_title(instance_name: &str) -> String {
    format!("{} – {instance_name}", crate::brand::PRODUCT_NAME)
}

/// The Login item `op` reads on stdin. The token is the concealed `password`
/// field; the first URL is the primary one.
pub fn build_item_template(
    title: &str,
    instance_name: &str,
    urls: &[ItemUrl],
    token: Option<&str>,
) -> Value {
    let urls: Vec<Value> = urls
        .iter()
        .enumerate()
        .map(|(index, url)| json!({ "label": url.label, "href": url.href, "primary": index == 0 }))
        .collect();
    let mut fields = Vec::new();
    if let Some(token) = token.filter(|token| !token.is_empty()) {
        fields.push(json!({
            "id": "password",
            "type": "CONCEALED",
            "purpose": "PASSWORD",
            "label": "access token",
            "value": token,
        }));
    }
    fields.push(json!({
        "id": "notesPlain",
        "type": "STRING",
        "purpose": "NOTES",
        "label": "notesPlain",
        "value": format!(
            "{} Web Access of \"{instance_name}\". The password is the access token. To connect another {}, use Settings → Remote connections → Add.",
            crate::brand::PRODUCT_NAME,
            crate::brand::PRODUCT_NAME,
        ),
    }));
    json!({
        "title": title,
        "category": "LOGIN",
        "urls": urls,
        "fields": fields,
    })
}

pub fn list_args() -> Vec<String> {
    ["item", "list", "--tags", ITEM_TAG, "--format", "json"]
        .map(String::from)
        .to_vec()
}

/// `op item create … -`: `-` makes `op` read the template from stdin.
pub fn create_args() -> Vec<String> {
    [
        "item", "create", "--tags", ITEM_TAG, "--format", "json", "-",
    ]
    .map(String::from)
    .to_vec()
}

/// `op item edit <id>` replaces the item with the template piped on stdin.
pub fn edit_args(item_id: &str) -> Vec<String> {
    vec![
        "item".into(),
        "edit".into(),
        item_id.into(),
        "--tags".into(),
        ITEM_TAG.into(),
        "--format".into(),
        "json".into(),
    ]
}

/// Id of the Splitkick item with exactly this title in `op item list` output.
pub fn find_item_id(list_json: &str, title: &str) -> Option<String> {
    let items: Vec<Value> = serde_json::from_str(list_json).ok()?;
    items
        .iter()
        .find(|item| item.get("title").and_then(Value::as_str) == Some(title))
        .and_then(|item| item.get("id").and_then(Value::as_str))
        .map(str::to_string)
}

/// Turn `op`'s stderr into a message for a toast, with a hint for the usual
/// causes: locked or signed-out app integration, a dismissed prompt.
pub fn friendly_op_error(stderr: &str) -> String {
    // `op` writes `[ERROR] 2026/11/23 10:00:00 <message>`.
    let message = stderr
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .unwrap_or("")
        .trim_start_matches("[ERROR]")
        .trim();
    let message = match message.split_once(' ') {
        Some((date, rest)) if date.contains('/') => match rest.split_once(' ') {
            Some((time, rest)) if time.contains(':') => rest.trim(),
            _ => message,
        },
        _ => message,
    };
    let message = if message.is_empty() {
        "1Password CLI failed"
    } else {
        message
    };
    let lower = message.to_lowercase();
    if lower.contains("dismissed") || lower.contains("cancel") || lower.contains("denied") {
        format!("Cancelled in 1Password ({message}).")
    } else if lower.contains("sign in")
        || lower.contains("signed in")
        || lower.contains("signin")
        || lower.contains("no account")
        || lower.contains("locked")
        || lower.contains("not currently")
        || lower.contains("connect")
    {
        format!(
            "{message}. Unlock the 1Password app and turn on Settings → Developer → Integrate with 1Password CLI, or run `op signin` in a terminal."
        )
    } else {
        message.to_string()
    }
}

fn run_op(op: &Path, args: &[String], stdin: Option<&[u8]>) -> Result<String, String> {
    let mut command = crate::platform::silent_command(op);
    command
        .args(args)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start the 1Password CLI: {e}"))?;
    if let Some(bytes) = stdin {
        let mut pipe = child
            .stdin
            .take()
            .ok_or("Could not open stdin of the 1Password CLI")?;
        pipe.write_all(bytes)
            .map_err(|e| format!("Could not write to the 1Password CLI: {e}"))?;
        // Close stdin so `op` sees the end of the template.
        drop(pipe);
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("1Password CLI failed: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(friendly_op_error(&String::from_utf8_lossy(&output.stderr)))
    }
}

/// Create the item, or update the Splitkick item with the same title, so a
/// second click after "Regenerate token" replaces the old token instead of
/// leaving two items with different tokens.
pub fn save_item(
    op: &Path,
    title: &str,
    template: &Value,
) -> Result<OnePasswordSaveResult, String> {
    let bytes = serde_json::to_vec(template).map_err(|e| e.to_string())?;
    let existing = find_item_id(&run_op(op, &list_args(), None)?, title);
    match existing {
        Some(id) => {
            run_op(op, &edit_args(&id), Some(&bytes))?;
            Ok(OnePasswordSaveResult {
                title: title.to_string(),
                updated: true,
            })
        }
        None => {
            run_op(op, &create_args(), Some(&bytes))?;
            Ok(OnePasswordSaveResult {
                title: title.to_string(),
                updated: false,
            })
        }
    }
}

/// Tauri/dispatch command. The UI sends the access URLs it shows; the name and
/// the token are read here, so the token never travels through the frontend.
pub async fn save_web_access_to_onepassword(
    app: AppHandle,
    urls: Vec<ItemUrl>,
) -> Result<OnePasswordSaveResult, String> {
    // A headless server has nobody at the screen to approve the 1Password
    // prompt, and the item would land in the server's vault.
    crate::platform::ensure_native_open_allowed("1Password")?;
    let op = find_op().ok_or("The 1Password CLI (op) is not installed")?;
    let urls: Vec<ItemUrl> = urls
        .into_iter()
        .filter(|url| !url.href.trim().is_empty())
        .collect();
    if urls.is_empty() {
        return Err("Start the HTTP server first: there is no access URL to save".to_string());
    }

    let prefs = crate::load_preferences(app.clone()).await?;
    let status = crate::http_server::server::get_server_status(app.clone()).await;
    let token = prefs
        .http_server_token_required
        .then(|| status.token.or(prefs.http_server_token.clone()))
        .flatten();
    let instance_name = crate::session_backup::device_name(&prefs);
    let title = item_title(&instance_name);
    let template = build_item_template(&title, &instance_name, &urls, token.as_deref());

    tokio::task::spawn_blocking(move || save_item(&op, &title, &template))
        .await
        .map_err(|e| format!("1Password task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "SECRET-TOKEN-123";

    fn urls() -> Vec<ItemUrl> {
        vec![
            ItemUrl {
                label: "Web Access".into(),
                href: "http://192.168.1.20:3456".into(),
            },
            ItemUrl {
                label: "Tailscale".into(),
                href: "https://box.tail1234.ts.net".into(),
            },
        ]
    }

    #[test]
    fn template_holds_token_as_concealed_password_and_urls() {
        let template = build_item_template("Splitkick – Mac 1", "Mac 1", &urls(), Some(TOKEN));
        assert_eq!(template["title"], "Splitkick – Mac 1");
        assert_eq!(template["category"], "LOGIN");
        assert_eq!(template["urls"][0]["href"], "http://192.168.1.20:3456");
        assert_eq!(template["urls"][0]["primary"], true);
        assert_eq!(template["urls"][1]["href"], "https://box.tail1234.ts.net");
        assert_eq!(template["urls"][1]["primary"], false);
        let password = &template["fields"][0];
        assert_eq!(password["id"], "password");
        assert_eq!(password["type"], "CONCEALED");
        assert_eq!(password["value"], TOKEN);
    }

    #[test]
    fn template_without_token_has_no_password_field() {
        let template = build_item_template("t", "Mac 1", &urls(), None);
        let fields = template["fields"].as_array().unwrap();
        assert!(fields.iter().all(|field| field["id"] != "password"));
    }

    #[test]
    fn title_uses_product_and_instance_name() {
        assert_eq!(item_title("Mac 1"), "Splitkick – Mac 1");
    }

    #[test]
    fn argv_never_holds_the_token() {
        for args in [list_args(), create_args(), edit_args("abc123")] {
            assert!(args.iter().all(|arg| !arg.contains(TOKEN)), "{args:?}");
        }
        assert_eq!(create_args().last().map(String::as_str), Some("-"));
    }

    #[test]
    fn finds_item_by_exact_title() {
        let list =
            r#"[{"id":"a1","title":"Splitkick – Mac 2"},{"id":"b2","title":"Splitkick – Mac 1"}]"#;
        assert_eq!(
            find_item_id(list, "Splitkick – Mac 1").as_deref(),
            Some("b2")
        );
        assert_eq!(find_item_id(list, "Splitkick – Mac"), None);
        assert_eq!(find_item_id("not json", "x"), None);
    }

    #[test]
    fn errors_get_a_hint() {
        let locked = friendly_op_error(
            "[ERROR] 2026/11/23 10:00:00 error initializing client: connecting to desktop app: 1Password app is locked\n",
        );
        assert!(locked.starts_with("error initializing client"), "{locked}");
        assert!(locked.contains("Unlock the 1Password app"), "{locked}");
        let dismissed = friendly_op_error(
            "[ERROR] 2026/11/23 10:00:00 authorization prompt dismissed, please try again",
        );
        assert!(
            dismissed.starts_with("Cancelled in 1Password"),
            "{dismissed}"
        );
        assert_eq!(friendly_op_error(""), "1Password CLI failed");
    }

    #[test]
    fn finds_op_on_path_then_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let op = dir.path().join(op_file_name());
        std::fs::write(&op, "").unwrap();
        let path = std::env::join_paths([dir.path()]).unwrap();
        assert_eq!(find_op_in(Some(&path), &[]), Some(op.clone()));
        let empty = tempfile::tempdir().unwrap();
        let path = std::env::join_paths([empty.path()]).unwrap();
        assert_eq!(find_op_in(Some(&path), &[]), None);
        let fallback = op.to_string_lossy().into_owned();
        assert_eq!(
            find_op_in(Some(&path), &[fallback.as_str()]),
            Some(op.clone())
        );
    }

    /// A fake `op` records its argv and stdin; the token must reach stdin only.
    #[cfg(unix)]
    fn fake_op(dir: &Path, list_output: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let op = dir.join("op");
        let log = dir.join("calls.log");
        let script = format!(
            "#!/bin/sh\necho \"ARGS $*\" >> '{log}'\nif [ \"$2\" = list ]; then echo '{list_output}'; exit 0; fi\necho \"STDIN $(cat)\" >> '{log}'\necho '{{\"id\":\"new1\"}}'\n",
            log = log.display()
        );
        std::fs::write(&op, script).unwrap();
        std::fs::set_permissions(&op, std::fs::Permissions::from_mode(0o755)).unwrap();
        op
    }

    #[cfg(unix)]
    #[test]
    fn creates_item_with_token_on_stdin_only() {
        let dir = tempfile::tempdir().unwrap();
        let op = fake_op(dir.path(), "[]");
        let title = "Splitkick – Mac 1";
        let template = build_item_template(title, "Mac 1", &urls(), Some(TOKEN));
        let result = save_item(&op, title, &template).unwrap();
        assert!(!result.updated);
        let log = std::fs::read_to_string(dir.path().join("calls.log")).unwrap();
        let args: Vec<&str> = log.lines().filter(|l| l.starts_with("ARGS")).collect();
        assert_eq!(
            args,
            [
                "ARGS item list --tags splitkick --format json",
                "ARGS item create --tags splitkick --format json -"
            ]
        );
        assert!(args.iter().all(|line| !line.contains(TOKEN)));
        let stdin = log.lines().find(|l| l.starts_with("STDIN")).unwrap();
        assert!(stdin.contains(TOKEN), "{stdin}");
    }

    #[cfg(unix)]
    #[test]
    fn updates_existing_splitkick_item_with_same_title() {
        let dir = tempfile::tempdir().unwrap();
        let op = fake_op(dir.path(), r#"[{"id":"old9","title":"Splitkick – Mac 1"}]"#);
        let title = "Splitkick – Mac 1";
        let template = build_item_template(title, "Mac 1", &urls(), Some(TOKEN));
        let result = save_item(&op, title, &template).unwrap();
        assert!(result.updated);
        let log = std::fs::read_to_string(dir.path().join("calls.log")).unwrap();
        assert!(
            log.contains("ARGS item edit old9 --tags splitkick --format json\n"),
            "{log}"
        );
        assert!(!log.contains("item create"));
    }

    #[cfg(unix)]
    #[test]
    fn op_failure_becomes_friendly_error() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let op = dir.path().join("op");
        std::fs::write(
            &op,
            "#!/bin/sh\necho '[ERROR] 2026/11/23 10:00:00 You are not currently signed in.' >&2\nexit 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&op, std::fs::Permissions::from_mode(0o755)).unwrap();
        let template = build_item_template("t", "Mac 1", &urls(), Some(TOKEN));
        let error = save_item(&op, "t", &template).unwrap_err();
        assert!(
            error.starts_with("You are not currently signed in."),
            "{error}"
        );
        assert!(error.contains("op signin"), "{error}");
    }
}
