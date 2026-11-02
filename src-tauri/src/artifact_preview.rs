//! `splitkick-artifact:` — a dedicated origin for HTML artifact previews (#76).
//!
//! A `srcdoc` frame inherits the app's CSP. Release builds add hashes to the
//! app's `script-src`, which turns its `'unsafe-inline'` off, so inline
//! scripts in a preview would not run. This scheme serves one fixed bootstrap
//! page with its own policy; the page receives the artifact by `postMessage`
//! and writes it into itself (`artifact_preview_bootstrap.html`).
//!
//! The response is stateless: no artifact content ever reaches Rust.
//! Threat model: docs/developer/artifact-preview.md.

use tauri::http::{header, Response};

pub const SCHEME: &str = "splitkick-artifact";

/// Must match `PREVIEW_CSP` in `src/components/artifact-preview/sandbox.ts`
/// (a frontend test checks it), plus the `sandbox` directive: the document
/// gets an opaque origin even if the frame's `sandbox` attribute is missing.
pub const CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'; sandbox allow-scripts";

const BOOTSTRAP: &str = include_str!("artifact_preview_bootstrap.html");

/// The same page for every request.
pub fn response() -> Response<Vec<u8>> {
    Response::builder()
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CONTENT_SECURITY_POLICY, CSP)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::REFERRER_POLICY, "no-referrer")
        .body(BOOTSTRAP.as_bytes().to_vec())
        .expect("static artifact preview response")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_is_sandboxed_and_offline() {
        let response = response();
        let csp = response.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.starts_with("default-src 'none';"));
        assert!(csp.ends_with("; sandbox allow-scripts"));
        assert!(!csp.contains("allow-same-origin"));
        assert!(!csp.contains("http"));
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/html; charset=utf-8"
        );
        let body = String::from_utf8(response.body().clone()).unwrap();
        assert!(body.contains("event.source !== parent"));
    }
}
