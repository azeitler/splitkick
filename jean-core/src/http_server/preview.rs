//! Static previews of project/worktree files for remote clients.
//!
//! A connection window drives a backend on another machine, so a `file://`
//! URL to an agent's HTML page names a file the client does not have. The
//! backend serves the page instead under
//! `/preview/<rootId>/<sig>/<relative path>`:
//!
//! - `rootId` is a worktree or project id; the path is relative to its root,
//!   so a page's relative `css/site.css` or `../img/a.png` resolves.
//! - `sig` is an HMAC of `rootId` keyed by the server token. It works as a
//!   capability for the whole root, because sub-resource requests cannot
//!   carry the server token. The token itself never appears in the URL.

use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Base64url characters kept from the HMAC (132 bits).
const SIG_LEN: usize = 22;

pub fn preview_sig(token: &str, root_id: &str) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(token.as_bytes()).expect("HMAC accepts any key length");
    mac.update(root_id.as_bytes());
    let digest = mac.finalize().into_bytes();
    let mut sig = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, digest);
    sig.truncate(SIG_LEN);
    sig
}

pub fn sig_is_valid(token: &str, root_id: &str, sig: &str) -> bool {
    super::auth::validate_token(sig, &preview_sig(token, root_id))
}

/// Known roots as `(id, canonical path)`: every worktree and every
/// non-folder project.
fn known_roots(app: &AppHandle) -> Result<Vec<(String, PathBuf)>, String> {
    let data = crate::projects::storage::load_projects_data(app)?;
    let projects = data
        .projects
        .into_iter()
        .filter(|p| !p.is_folder && !p.path.is_empty())
        .map(|p| (p.id, p.path));
    let worktrees = data.worktrees.into_iter().map(|w| (w.id, w.path));
    Ok(projects
        .chain(worktrees)
        .filter_map(|(id, path)| Some((id, Path::new(&path).canonicalize().ok()?)))
        .collect())
}

/// The file a preview request names, or `None` when the root is unknown or
/// the path is missing or escapes the root (`..`, symlinks). A directory
/// serves its `index.html`.
pub fn resolve_preview_file(app: &AppHandle, root_id: &str, relpath: &str) -> Option<PathBuf> {
    let roots = known_roots(app).ok()?;
    let (_, root) = roots.iter().find(|(id, _)| id == root_id)?;
    resolve_in_root(root, relpath)
}

fn resolve_in_root(root: &Path, relpath: &str) -> Option<PathBuf> {
    let mut path = root
        .join(relpath.trim_start_matches('/'))
        .canonicalize()
        .ok()?;
    if !path.starts_with(root) {
        return None;
    }
    if path.is_dir() {
        path = path.join("index.html");
    }
    path.is_file().then_some(path)
}

/// The preview URL path (no host) for an absolute backend path. Picks the
/// innermost known root containing it, so a worktree inside a project
/// directory wins over the project.
pub fn preview_url_path(app: &AppHandle, token: &str, path: &str) -> Result<String, String> {
    let canonical = Path::new(path)
        .canonicalize()
        .map_err(|_| format!("File not found: {path}"))?;
    let roots = known_roots(app)?;
    let (id, root) = roots
        .iter()
        .filter(|(_, root)| canonical.starts_with(root))
        .max_by_key(|(_, root)| root.components().count())
        .ok_or_else(|| format!("Not inside a project or worktree: {path}"))?;
    let rel = canonical.strip_prefix(root).map_err(|e| e.to_string())?;
    Ok(build_url_path(id, &preview_sig(token, id), rel))
}

fn build_url_path(root_id: &str, sig: &str, rel: &Path) -> String {
    let rel = rel
        .components()
        .map(|c| encode_segment(&c.as_os_str().to_string_lossy()))
        .collect::<Vec<_>>()
        .join("/");
    format!("/preview/{}/{sig}/{rel}", encode_segment(root_id))
}

fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// MIME type for a previewed file. Covers what a static web page links.
pub fn preview_mime(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json" | "map") => "application/json; charset=utf-8",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("pdf") => "application/pdf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sig_depends_on_token_and_root() {
        let sig = preview_sig("token", "root-1");
        assert_eq!(sig.len(), SIG_LEN);
        assert!(sig_is_valid("token", "root-1", &sig));
        assert!(!sig_is_valid("other", "root-1", &sig));
        assert!(!sig_is_valid("token", "root-2", &sig));
        assert!(!sig_is_valid("token", "root-1", "short"));
    }

    #[test]
    fn resolve_in_root_serves_files_and_index_and_blocks_escape() {
        let base = std::env::temp_dir().join(format!("jean-preview-{}", uuid::Uuid::new_v4()));
        let root = base.join("root");
        std::fs::create_dir_all(root.join("site/css")).unwrap();
        std::fs::write(root.join("site/index.html"), "<h1>hi</h1>").unwrap();
        std::fs::write(root.join("site/css/a.css"), "body{}").unwrap();
        std::fs::write(base.join("secret.txt"), "no").unwrap();
        let root = root.canonicalize().unwrap();

        assert_eq!(
            resolve_in_root(&root, "site/css/a.css"),
            Some(root.join("site/css/a.css"))
        );
        assert_eq!(
            resolve_in_root(&root, "site"),
            Some(root.join("site/index.html"))
        );
        assert_eq!(resolve_in_root(&root, "../secret.txt"), None);
        assert_eq!(resolve_in_root(&root, "missing.html"), None);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(base.join("secret.txt"), root.join("link.txt")).unwrap();
            assert_eq!(resolve_in_root(&root, "link.txt"), None);
        }

        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn build_url_path_encodes_segments_but_keeps_slashes() {
        assert_eq!(
            build_url_path("wt-1", "SIG", Path::new("my site/index.html")),
            "/preview/wt-1/SIG/my%20site/index.html"
        );
    }

    #[test]
    fn preview_mime_covers_web_assets() {
        assert_eq!(
            preview_mime(Path::new("a/INDEX.HTML")),
            "text/html; charset=utf-8"
        );
        assert_eq!(preview_mime(Path::new("a.css")), "text/css; charset=utf-8");
        assert_eq!(preview_mime(Path::new("a.woff2")), "font/woff2");
        assert_eq!(preview_mime(Path::new("a.bin")), "application/octet-stream");
    }
}
