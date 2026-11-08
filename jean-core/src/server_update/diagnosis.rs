//! Names the cause when the native updater's check fails (#113).
//!
//! tauri-plugin-updater (2.10.x) turns a non-2xx answer from the release feed
//! into `ReleaseNotFound` ("Could not fetch a valid release JSON from the
//! remote") and drops the HTTP status. After a failed check the frontend
//! calls `diagnose_update_check`: it fetches the feed once, the way the plugin
//! does, and returns one short line for the toast and the log.

use std::time::Duration;

/// Same `Accept` header as the plugin, so GitHub answers the same way.
const ACCEPT_JSON: &str = "application/json";
const TIMEOUT: Duration = Duration::from_secs(30);
/// Longest body excerpt quoted for a parse error.
const BODY_EXCERPT_CHARS: usize = 80;

/// Fetch the desktop release feed once and describe what came back.
pub async fn diagnose_update_check() -> String {
    let url = super::desktop_manifest_url(super::DESKTOP_RELEASE_FEED.get().map(String::as_str));
    let diagnosis = fetch_and_describe(url).await;
    log::warn!("Update check diagnosis for {url}: {diagnosis}");
    diagnosis
}

async fn fetch_and_describe(url: &str) -> String {
    let host = host_of(url);
    let client = match reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!(
            "splitkick-update-diagnosis/",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
    {
        Ok(client) => client,
        Err(error) => return format!("could not create an HTTP client: {}", error_chain(&error)),
    };
    let response = match client
        .get(url)
        .header(reqwest::header::ACCEPT, ACCEPT_JSON)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return format!("could not reach {host}: {}", error_chain(&error)),
    };
    // Redirects are followed; name the host that gave the final answer.
    let final_host = response.url().host_str().unwrap_or("?").to_string();
    let source = if final_host == host {
        host
    } else {
        format!("{host} → {final_host}")
    };
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("no content type")
        .to_string();
    let body = match response.bytes().await {
        Ok(body) => body,
        Err(error) => {
            return format!(
                "{source} answered HTTP {status} but the body could not be read: {}",
                error_chain(&error)
            )
        }
    };
    describe_response(&source, status, &content_type, &body, &platform_keys())
}

/// One line for a fetched feed. `platform_keys` are the `platforms` entries
/// the plugin accepts for this machine, most specific first.
fn describe_response(
    source: &str,
    status: u16,
    content_type: &str,
    body: &[u8],
    platform_keys: &[String],
) -> String {
    if !(200..300).contains(&status) {
        return format!("{source} answered HTTP {status} ({content_type})");
    }
    let manifest: serde_json::Value = match serde_json::from_slice(body) {
        Ok(manifest) => manifest,
        Err(error) => {
            return format!(
                "{source} answered HTTP {status} ({content_type}), but the body is not valid JSON ({error}): {}",
                excerpt(body)
            )
        }
    };
    let version = manifest
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("without a version");
    let Some(platforms) = manifest.get("platforms").and_then(|p| p.as_object()) else {
        return format!(
            "{source} answered HTTP {status}, but manifest {version} has no `platforms`"
        );
    };
    let wanted = platform_keys.last().map(String::as_str).unwrap_or("?");
    match platform_keys.iter().find(|key| platforms.contains_key(*key)) {
        Some(key) => format!(
            "{source} answered HTTP {status} with manifest {version} for {key}; the feed works now, try again"
        ),
        None => {
            let mut listed: Vec<&str> = platforms.keys().map(String::as_str).collect();
            listed.sort_unstable();
            format!(
                "manifest {version} from {source} has no entry for {wanted} (has: {})",
                listed.join(", ")
            )
        }
    }
}

/// The `platforms` keys the plugin looks up: `{os}-{arch}-{installer}` first,
/// then `{os}-{arch}` (tauri-plugin-updater `Updater::get_urls`).
fn platform_keys() -> Vec<String> {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86" => "i686",
        "arm" => "armv7",
        other => other,
    };
    let target = format!("{os}-{arch}");
    let installer = match os {
        "darwin" => Some("app"),
        "windows" => Some("nsis"),
        _ => None,
    };
    let mut keys = Vec::new();
    if let Some(installer) = installer {
        keys.push(format!("{target}-{installer}"));
    }
    keys.push(target);
    keys
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .unwrap_or_else(|| url.to_string())
}

/// The error and its sources: reqwest hides the TLS/DNS/proxy cause there.
fn error_chain(error: &dyn std::error::Error) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let cause_text = cause.to_string();
        if !text.contains(&cause_text) {
            text.push_str(": ");
            text.push_str(&cause_text);
        }
        source = cause.source();
    }
    text
}

fn excerpt(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > BODY_EXCERPT_CHARS {
        let cut: String = flat.chars().take(BODY_EXCERPT_CHARS).collect();
        format!("{cut}…")
    } else {
        flat
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mac_arm() -> Vec<String> {
        vec!["darwin-aarch64-app".into(), "darwin-aarch64".into()]
    }

    fn mac_intel() -> Vec<String> {
        vec!["darwin-x86_64-app".into(), "darwin-x86_64".into()]
    }

    const MANIFEST: &str = r#"{
      "version": "1.5.4",
      "platforms": {
        "darwin-aarch64": { "signature": "s", "url": "https://x/a.tar.gz" },
        "windows-x86_64": { "signature": "s", "url": "https://x/a.exe" }
      }
    }"#;

    #[test]
    fn names_the_status_of_a_gateway_timeout() {
        let body = b"<html><body><h1>504 Gateway Time-out</h1></body></html>";
        assert_eq!(
            describe_response("github.com", 504, "text/html", body, &mac_arm()),
            "github.com answered HTTP 504 (text/html)"
        );
    }

    #[test]
    fn quotes_a_body_that_is_not_json() {
        let text = describe_response(
            "github.com",
            200,
            "text/html",
            b"<html>\n  <body>login</body></html>",
            &mac_arm(),
        );
        assert!(text.starts_with(
            "github.com answered HTTP 200 (text/html), but the body is not valid JSON"
        ));
        assert!(
            text.ends_with(": <html> <body>login</body></html>"),
            "{text}"
        );
    }

    #[test]
    fn names_the_missing_platform_key() {
        assert_eq!(
            describe_response("github.com", 200, "application/json", MANIFEST.as_bytes(), &mac_intel()),
            "manifest 1.5.4 from github.com has no entry for darwin-x86_64 (has: darwin-aarch64, windows-x86_64)"
        );
    }

    #[test]
    fn reports_a_working_feed() {
        assert_eq!(
            describe_response(
                "github.com → release-assets.githubusercontent.com",
                200,
                "application/octet-stream",
                MANIFEST.as_bytes(),
                &mac_arm()
            ),
            "github.com → release-assets.githubusercontent.com answered HTTP 200 with manifest 1.5.4 for darwin-aarch64; the feed works now, try again"
        );
    }

    #[test]
    fn this_machine_looks_up_the_plain_target_last() {
        let keys = platform_keys();
        let plain = keys.last().unwrap();
        assert!(plain.contains('-') && !plain.ends_with("-app"), "{keys:?}");
    }

    #[test]
    fn long_bodies_are_cut() {
        let body = "x".repeat(200);
        assert_eq!(
            excerpt(body.as_bytes()).chars().count(),
            BODY_EXCERPT_CHARS + 1
        );
    }

    #[tokio::test]
    async fn an_unreachable_feed_names_the_host() {
        // Port 9 (discard) on localhost is closed on CI and dev machines.
        let text = fetch_and_describe("https://127.0.0.1:9/latest.json").await;
        assert!(text.starts_with("could not reach 127.0.0.1: "), "{text}");
    }
}
