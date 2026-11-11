//! Tauri commands for Claude CLI management

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use tokio::sync::Mutex as AsyncMutex;

use super::accounts::{self as accounts, ResolvedClaudeAccount};
use super::config::{
    ensure_cli_dir, get_cli_binary_path, get_cli_dir, get_wsl_cli_binary_path, get_wsl_cli_dir,
    resolve_cli_binary,
};
use crate::http_server::EmitExt;
#[cfg(target_os = "macos")]
use crate::platform::silent_command;

/// Extract semver version number from a version string
/// Handles formats like: "1.0.28", "v1.0.28", "Claude CLI 1.0.28"
fn extract_version_number(version_str: &str) -> String {
    // Try to find a semver-like pattern (digits.digits.digits)
    for word in version_str.split_whitespace() {
        let trimmed = word.trim_start_matches('v');
        // Check if it looks like a version number (starts with digit, contains dots)
        if trimmed
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
            && trimmed.contains('.')
        {
            return trimmed.to_string();
        }
    }
    // Fallback: return original string
    version_str.to_string()
}

/// Base URL for Claude CLI binary distribution
const CLAUDE_DIST_BUCKET: &str =
    "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases";
const CLAUDE_CREDENTIALS_FILE: &str = ".claude/.credentials.json";
const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_USAGE_CACHE_TTL_SECS: u64 = 5 * 60;
/// Stale cache is still served on 429 / transient API failures (OpenUsage pattern).
const CLAUDE_USAGE_STALE_CACHE_MAX_SECS: u64 = 6 * 60 * 60;

/// Shown for an account whose token expired and that has no stored usage yet.
/// Not an error: the account was simply not used recently. The frontend
/// matches the "Not used recently" prefix to show it as a note.
pub const CLAUDE_TOKEN_IDLE_MESSAGE: &str =
    "Not used recently. Usage shows after the next run with this account.";
/// Shown for such an account while the Claude CLI renews its token (#134). The
/// frontend matches the "Updating" prefix and checks again soon.
pub const CLAUDE_TOKEN_RENEWING_MESSAGE: &str = "Updating usage…";
const CLAUDE_USAGE_USER_AGENT: &str = "claude-code/2.1.69";
static CLAUDE_USAGE_FETCH_LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();

fn claude_usage_fetch_lock() -> &'static AsyncMutex<()> {
    CLAUDE_USAGE_FETCH_LOCK.get_or_init(|| AsyncMutex::new(()))
}

/// Status of the Claude CLI installation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCliStatus {
    /// Whether Claude CLI is installed
    pub installed: bool,
    /// Installed version (if any)
    pub version: Option<String>,
    /// Path to the CLI binary (if installed)
    pub path: Option<String>,
    /// Whether the CLI supports the `auth` subcommand (older CLIs lack it)
    #[serde(default)]
    pub supports_auth_command: bool,
}

/// Information about a Claude CLI release from GitHub
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseInfo {
    /// Version string (e.g., "1.0.0")
    pub version: String,
    /// Git tag name (e.g., "v1.0.0")
    pub tag_name: String,
    /// Publication date in ISO format
    pub published_at: String,
    /// Whether this is a prerelease
    pub prerelease: bool,
}

/// Progress event for CLI installation
#[derive(Debug, Clone, Serialize)]
pub struct InstallProgress {
    /// Current stage of installation
    pub stage: String,
    /// Progress message
    pub message: String,
    /// Percentage complete (0-100)
    pub percent: u8,
}

/// Check if Claude CLI is installed and get its status
pub async fn check_claude_cli_installed(app: AppHandle) -> Result<ClaudeCliStatus, String> {
    log::trace!("Checking Claude CLI installation status");

    let wsl = crate::platform::get_wsl_config();
    let binary_path = resolve_cli_binary(&app);

    // In WSL mode, `binary_path` is either an absolute Unix path (Jean-managed
    // install inside the distro) or a bare tool name ("claude" for system
    // PATH). Neither form satisfies `.exists()` on the Windows filesystem —
    // verify inside WSL. Absolute paths use `test -x` (Jean install location
    // is not on $PATH); bare names use `which`.
    if wsl.enabled {
        let tool = binary_path.to_string_lossy().to_string();
        let installed = if tool.starts_with('/') {
            crate::platform::wsl_file_executable(&wsl.distro, &tool)
        } else {
            crate::platform::check_wsl_tool(&wsl.distro, &tool)
        };
        if !installed {
            log::trace!("Claude CLI not found inside WSL distro {}", wsl.distro);
            return Ok(ClaudeCliStatus {
                installed: false,
                version: None,
                path: None,
                supports_auth_command: false,
            });
        }
        let raw_ver = crate::platform::wsl_tool_version(&wsl.distro, &tool);
        let version = raw_ver.map(|v| extract_version_number(&v));
        let supports_auth_command = version
            .as_ref()
            .map(|v| {
                v.split('.')
                    .next()
                    .and_then(|major| major.parse::<u32>().ok())
                    .unwrap_or(0)
                    >= 1
            })
            .unwrap_or(false);
        return Ok(ClaudeCliStatus {
            installed: true,
            version,
            path: Some(tool),
            supports_auth_command,
        });
    }

    if !binary_path.exists() {
        log::trace!("Claude CLI not found at {:?}", binary_path);
        return Ok(ClaudeCliStatus {
            installed: false,
            version: None,
            path: None,
            supports_auth_command: false,
        });
    }

    // Try to get the version by running claude --version
    // Use the binary directly - shell wrapper causes PowerShell parsing issues on Windows
    let version = match crate::platform::cli_command(&binary_path.to_string_lossy(), None)
        .arg("--version")
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                let version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                log::trace!("Claude CLI raw version output: {}", version_str);
                // claude --version returns just the version number like "1.0.28"
                // but handle any prefix like "v1.0.28" or "Claude CLI 1.0.28"
                let version = extract_version_number(&version_str);
                log::trace!("Claude CLI parsed version: {}", version);
                Some(version)
            } else {
                log::warn!("Failed to get Claude CLI version");
                None
            }
        }
        Err(e) => {
            log::warn!("Failed to execute Claude CLI: {}", e);
            None
        }
    };

    // Infer auth support from version instead of spawning another process.
    // The `auth` subcommand was added in Claude CLI ~1.0.16; all 1.x+ versions have it.
    let supports_auth_command = version
        .as_ref()
        .map(|v| {
            v.split('.')
                .next()
                .and_then(|major| major.parse::<u32>().ok())
                .unwrap_or(0)
                >= 1
        })
        .unwrap_or(false);
    log::trace!(
        "Claude CLI supports auth command: {supports_auth_command} (inferred from version)"
    );

    Ok(ClaudeCliStatus {
        installed: true,
        version,
        path: Some(binary_path.to_string_lossy().to_string()),
        supports_auth_command,
    })
}

/// npm package metadata for version listing
#[derive(Debug, Deserialize)]
struct NpmPackageInfo {
    versions: std::collections::HashMap<String, serde_json::Value>,
    time: std::collections::HashMap<String, String>,
    #[serde(rename = "dist-tags")]
    dist_tags: std::collections::HashMap<String, String>,
}

/// Platform-specific release information from manifest
#[derive(Debug, Deserialize)]
struct PlatformInfo {
    checksum: String,
}

/// Release manifest containing checksums for all platforms
#[derive(Debug, Deserialize)]
struct Manifest {
    platforms: std::collections::HashMap<String, PlatformInfo>,
}

/// Parse version string into comparable parts
fn parse_version(version: &str) -> Vec<u32> {
    version.split('.').filter_map(|s| s.parse().ok()).collect()
}

/// Get available Claude CLI versions from npm registry
pub async fn get_available_cli_versions() -> Result<Vec<ReleaseInfo>, String> {
    log::trace!("Fetching available Claude CLI versions from npm registry");

    let client = reqwest::Client::new();
    let response = client
        .get("https://registry.npmjs.org/@anthropic-ai/claude-code")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch versions: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "npm registry returned status: {}",
            response.status()
        ));
    }

    let package_info: NpmPackageInfo = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse npm response: {e}"))?;

    // Get the latest stable version from dist-tags
    // Versions > latest (e.g., "next" tag) don't have manifests in the bucket
    let latest_version = package_info
        .dist_tags
        .get("latest")
        .ok_or("No 'latest' tag found in npm dist-tags")?;
    let latest_parts = parse_version(latest_version);

    // Filter versions to only include those <= latest (excludes prereleases like "next")
    let mut versions: Vec<ReleaseInfo> = package_info
        .versions
        .keys()
        .filter(|version| {
            // Exclude prerelease versions (e.g., 1.0.0-beta)
            if version.contains('-') {
                return false;
            }
            // Exclude versions > latest
            let parts = parse_version(version);
            parts <= latest_parts
        })
        .map(|version| {
            let published_at = package_info.time.get(version).cloned().unwrap_or_default();
            ReleaseInfo {
                version: version.clone(),
                tag_name: format!("v{version}"),
                published_at,
                prerelease: false,
            }
        })
        .collect();

    // Sort by version descending (newest first)
    versions.sort_by(|a, b| {
        let a_parts = parse_version(&a.version);
        let b_parts = parse_version(&b.version);
        b_parts.cmp(&a_parts)
    });

    // Take only the 5 most recent versions
    versions.truncate(5);

    log::trace!("Found {} Claude CLI versions", versions.len());
    Ok(versions)
}

/// Fetch the latest version string from the distribution bucket
async fn fetch_latest_version() -> Result<String, String> {
    let url = format!("{CLAUDE_DIST_BUCKET}/latest");
    log::trace!("Fetching latest version from {url}");

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch stable version: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch stable version: HTTP {}",
            response.status()
        ));
    }

    let version = response
        .text()
        .await
        .map_err(|e| format!("Failed to read latest version: {e}"))?
        .trim()
        .to_string();

    log::trace!("Latest version: {version}");
    Ok(version)
}

/// Get the platform string for the current system
fn get_platform() -> Result<&'static str, String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Ok("darwin-arm64");
    }

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Ok("darwin-x64");
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Ok("linux-x64");
    }

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return Ok("linux-arm64");
    }

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Ok("win32-x64");
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

/// Fetch the release manifest containing checksums for all platforms
async fn fetch_manifest(version: &str) -> Result<Manifest, String> {
    let url = format!("{CLAUDE_DIST_BUCKET}/{version}/manifest.json");
    log::trace!("Fetching manifest from {url}");

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch manifest: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch manifest: HTTP {}",
            response.status()
        ));
    }

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse manifest: {e}"))
}

pub async fn check_claude_cli_version_exists(version: String) -> Result<bool, String> {
    let version = version.trim().trim_start_matches('v');
    if version.is_empty() {
        return Ok(false);
    }

    match fetch_manifest(version).await {
        Ok(_) => Ok(true),
        Err(error) if error.contains("HTTP 404") => Ok(false),
        Err(error) => Err(error),
    }
}

/// Verify SHA256 checksum of downloaded data
fn verify_checksum(data: &[u8], expected: &str) -> Result<(), String> {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let computed = format!("{:x}", hasher.finalize());

    if computed != expected.to_lowercase() {
        return Err(format!(
            "Checksum mismatch: expected {expected}, got {computed}"
        ));
    }
    Ok(())
}

/// Install Claude CLI by downloading the binary directly from Anthropic's distribution bucket
pub async fn install_claude_cli(app: AppHandle, version: Option<String>) -> Result<(), String> {
    log::trace!("Installing Claude CLI, version: {:?}", version);

    // Check if any Claude processes are running - cannot replace binary while in use
    let running_sessions = crate::chat::registry::get_running_sessions();
    if !running_sessions.is_empty() {
        let count = running_sessions.len();
        return Err(format!(
            "Cannot install Claude CLI while {} Claude {} running. Please stop all active sessions first.",
            count,
            if count == 1 { "session is" } else { "sessions are" }
        ));
    }

    let wsl = crate::platform::get_wsl_config();

    emit_progress(&app, "starting", "Preparing installation...", 0);

    // Determine version (use provided or fetch stable)
    let version = match version {
        Some(v) => v,
        None => fetch_latest_version().await?,
    };

    // Detect platform. In WSL mode the target is the distro's architecture,
    // not the Windows host's.
    let platform: &str = if wsl.enabled {
        crate::platform::wsl_detect_arch(&wsl.distro).ok_or_else(|| {
            "Unsupported WSL architecture (expected x86_64 or aarch64)".to_string()
        })?
    } else {
        get_platform()?
    };
    log::trace!("Installing version {version} for platform {platform}");

    // Fetch manifest and get expected checksum
    emit_progress(
        &app,
        "fetching_manifest",
        "Fetching release manifest...",
        10,
    );
    let manifest = fetch_manifest(&version).await?;
    let expected_checksum = manifest
        .platforms
        .get(platform)
        .ok_or_else(|| format!("No checksum found for platform {platform}"))?
        .checksum
        .clone();
    log::trace!("Expected checksum for {platform}: {expected_checksum}");

    // Build download URL. Target binary name comes from the platform string,
    // NOT the host OS — a Windows host installing into WSL downloads the
    // Linux `claude`, not `claude.exe`.
    let binary_name = if platform.starts_with("win32") {
        "claude.exe"
    } else {
        "claude"
    };
    let download_url = format!("{CLAUDE_DIST_BUCKET}/{version}/{platform}/{binary_name}");
    log::trace!("Downloading from: {download_url}");

    // Emit progress: downloading
    emit_progress(&app, "downloading", "Downloading Claude CLI...", 25);

    // Download the binary
    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download Claude CLI: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download Claude CLI: HTTP {}",
            response.status()
        ));
    }

    let binary_content = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read binary content: {e}"))?;

    log::trace!("Downloaded {} bytes", binary_content.len());

    // Verify checksum before writing to disk
    emit_progress(&app, "verifying_checksum", "Verifying checksum...", 55);
    verify_checksum(&binary_content, &expected_checksum)?;
    log::trace!("Checksum verified successfully");

    if wsl.enabled {
        // WSL branch: stream the bytes into the distro at
        // $HOME/.local/share/jean/claude-cli/claude and make it executable.
        let unix_path = get_wsl_cli_binary_path(&wsl.distro)?;
        emit_progress(&app, "installing", "Installing Claude CLI into WSL...", 65);
        log::trace!("Writing Claude CLI to WSL at {unix_path}");
        crate::platform::wsl_write_bytes(&wsl.distro, &unix_path, &binary_content)
            .map_err(|e| format!("Failed to write binary into WSL: {e}"))?;
        crate::platform::wsl_chmod_exec(&wsl.distro, &unix_path)?;
        emit_progress(&app, "complete", "Installation complete!", 100);
        log::trace!("Claude CLI installed successfully at WSL:{unix_path}");
        return Ok(());
    }

    // Native branch: write to %AppData%/jean/claude-cli/claude(.exe).
    let _cli_dir = ensure_cli_dir(&app)?;
    let binary_path = get_cli_binary_path(&app)?;

    emit_progress(&app, "installing", "Installing Claude CLI...", 65);

    // Uses platform::write_binary_file which writes to a temp file then atomically renames.
    // This handles Windows file-locking (OS error 32) and macOS code-signing inode taint
    // (SIGKILL) when the existing binary is in use by another process.
    log::trace!("Creating binary file at {:?}", binary_path);
    crate::platform::write_binary_file(&binary_path, &binary_content)
        .map_err(|e| format!("Failed to create binary file: {e}"))?;
    log::trace!("Binary file written successfully");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        log::trace!(
            "Setting executable permissions (0o755) on {:?}",
            binary_path
        );
        let mut perms = std::fs::metadata(&binary_path)
            .map_err(|e| format!("Failed to get binary metadata: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&binary_path, perms)
            .map_err(|e| format!("Failed to set binary permissions: {e}"))?;
        log::trace!("Executable permissions set successfully");
    }

    #[cfg(target_os = "macos")]
    {
        log::trace!("Removing quarantine attribute from {:?}", binary_path);
        let _ = silent_command("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(&binary_path)
            .output();
        // Ignore errors - attribute might not exist
    }

    emit_progress(&app, "complete", "Installation complete!", 100);

    log::trace!("Claude CLI installed successfully at {:?}", binary_path);
    Ok(())
}

/// Uninstall the Jean-managed Claude CLI by deleting its directory.
///
/// Refuses to run while any Claude sessions are active. Idempotent: returns
/// `Ok(())` if the directory does not exist.
pub async fn uninstall_claude_cli(app: AppHandle) -> Result<(), String> {
    let running_sessions = crate::chat::registry::get_running_sessions();
    if !running_sessions.is_empty() {
        let count = running_sessions.len();
        return Err(format!(
            "Cannot uninstall Claude CLI while {} Claude {} running. Please stop all active sessions first.",
            count,
            if count == 1 { "session is" } else { "sessions are" }
        ));
    }

    let wsl = crate::platform::get_wsl_config();
    if wsl.enabled {
        let cli_dir = get_wsl_cli_dir(&wsl.distro)?;
        crate::platform::wsl_remove_path(&wsl.distro, &cli_dir)
            .map_err(|e| format!("Failed to remove Claude CLI directory inside WSL: {e}"))?;
        log::info!(
            "Removed Splitkick-managed Claude CLI inside WSL distro {} at {}",
            wsl.distro,
            cli_dir
        );
        return Ok(());
    }

    let cli_dir = get_cli_dir(&app)?;
    if cli_dir.exists() {
        std::fs::remove_dir_all(&cli_dir)
            .map_err(|e| format!("Failed to remove Claude CLI directory: {e}"))?;
        log::info!("Removed Splitkick-managed Claude CLI at {:?}", cli_dir);
    }
    Ok(())
}

/// Result of checking Claude CLI authentication status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeAuthStatus {
    /// Whether the CLI is authenticated (can execute queries)
    pub authenticated: bool,
    /// Error message if authentication check failed
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageWindowSnapshot {
    pub used_percent: f64,
    pub resets_at: Option<u64>,
}

/// One entry of the usage endpoint's `limits` array.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageLimitSnapshot {
    /// `weekly_all`, `weekly_scoped`, ...
    pub kind: String,
    pub used_percent: f64,
    /// `normal`, `warning` or `critical`.
    pub severity: Option<String>,
    pub resets_at: Option<u64>,
    /// Model name of a `weekly_scoped` limit, for example "Fable".
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageSnapshot {
    pub plan_type: Option<String>,
    /// Signed-in account email, from `oauthAccount` in `~/.claude.json`.
    #[serde(default)]
    pub account_email: Option<String>,
    pub session: Option<ClaudeUsageWindowSnapshot>,
    pub weekly: Option<ClaudeUsageWindowSnapshot>,
    pub sonnet_weekly: Option<ClaudeUsageWindowSnapshot>,
    /// The endpoint's `limits` array: severity and model-scoped limits.
    #[serde(default)]
    pub limits: Vec<ClaudeUsageLimitSnapshot>,
    pub extra_usage_spent: Option<f64>,
    pub extra_usage_limit: Option<f64>,
    pub fetched_at: u64,
    /// Stored figures while the Claude CLI renews this account's token (#134).
    #[serde(default)]
    pub renewing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeUsageCacheEntry {
    cached_at: u64,
    snapshot: ClaudeUsageSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ClaudeOauthCredentials {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default, deserialize_with = "de_opt_u64")]
    expires_at: Option<u64>,
    #[serde(default)]
    subscription_type: Option<String>,
    #[serde(default)]
    rate_limit_tier: Option<String>,
    /// Granted OAuth scopes. Usage endpoint needs `user:profile`.
    #[serde(default)]
    scopes: Option<Vec<String>>,
    /// Preserve unknown Claude CLI fields so token rotation never strips them.
    /// OpenUsage-style safety: writing back a partial oauth object can log the user out.
    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ClaudeCredentialsFile {
    #[serde(rename = "claudeAiOauth", default)]
    claude_ai_oauth: Option<ClaudeOauthCredentials>,
    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

#[derive(Debug, Deserialize)]
struct ClaudeUsageWindow {
    #[serde(default, deserialize_with = "de_opt_f64")]
    utilization: Option<f64>,
    #[serde(default, deserialize_with = "de_opt_reset_time")]
    resets_at: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ClaudeUsageLimit {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default, deserialize_with = "de_opt_f64")]
    percent: Option<f64>,
    #[serde(default)]
    severity: Option<String>,
    #[serde(default, deserialize_with = "de_opt_reset_time")]
    resets_at: Option<u64>,
    #[serde(default)]
    scope: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct ClaudeExtraUsage {
    #[serde(default)]
    is_enabled: Option<bool>,
    #[serde(default, deserialize_with = "de_opt_f64")]
    used_credits: Option<f64>,
    #[serde(default, deserialize_with = "de_opt_f64")]
    monthly_limit: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct ClaudeUsageApiResponse {
    #[serde(default)]
    five_hour: Option<ClaudeUsageWindow>,
    #[serde(default)]
    seven_day: Option<ClaudeUsageWindow>,
    #[serde(default)]
    seven_day_sonnet: Option<ClaudeUsageWindow>,
    #[serde(default)]
    limits: Vec<ClaudeUsageLimit>,
    #[serde(default)]
    extra_usage: Option<ClaudeExtraUsage>,
}

fn de_opt_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    let Some(value) = value else {
        return Ok(None);
    };
    Ok(match value {
        Value::Number(num) => num.as_f64(),
        Value::String(s) => s.parse::<f64>().ok(),
        _ => None,
    })
}

fn de_opt_u64<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    let Some(value) = value else {
        return Ok(None);
    };
    Ok(match value {
        Value::Number(num) => num.as_u64(),
        Value::String(s) => s.parse::<u64>().ok(),
        _ => None,
    })
}

/// The endpoint sends an RFC 3339 date; older responses sent a number.
fn de_opt_reset_time<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(match value {
        Some(Value::Number(num)) => num.as_u64(),
        Some(Value::String(s)) => s.parse::<u64>().ok().or_else(|| {
            chrono::DateTime::parse_from_rfc3339(&s)
                .ok()
                .and_then(|date| u64::try_from(date.timestamp()).ok())
        }),
        _ => None,
    })
}

fn map_limits(limits: Vec<ClaudeUsageLimit>) -> Vec<ClaudeUsageLimitSnapshot> {
    limits
        .into_iter()
        .filter_map(|limit| {
            let model = limit
                .scope
                .as_ref()
                .and_then(|scope| scope.pointer("/model/display_name"))
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(ClaudeUsageLimitSnapshot {
                kind: limit.kind?,
                used_percent: limit.percent?,
                severity: limit.severity,
                resets_at: limit.resets_at,
                model,
            })
        })
        .collect()
}

fn build_usage_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create usage HTTP client: {e}"))
}

#[cfg(target_os = "macos")]
fn decode_hex_utf8(hex: &str) -> Option<String> {
    if hex.is_empty() || hex.len() % 2 != 0 {
        return None;
    }
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }

    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for idx in (0..hex.len()).step_by(2) {
        let byte = u8::from_str_radix(&hex[idx..idx + 2], 16).ok()?;
        bytes.push(byte);
    }
    String::from_utf8(bytes).ok()
}

#[cfg(target_os = "macos")]
fn parse_credentials_json(raw: &str) -> Option<ClaudeCredentialsFile> {
    if let Ok(creds) = serde_json::from_str::<ClaudeCredentialsFile>(raw) {
        return Some(creds);
    }
    let trimmed = raw.trim().trim_start_matches("0x").trim_start_matches("0X");
    let decoded = decode_hex_utf8(trimmed)?;
    serde_json::from_str::<ClaudeCredentialsFile>(&decoded).ok()
}

fn get_claude_credentials_path(config_dir: Option<&str>) -> Result<PathBuf, String> {
    accounts::credentials_file(config_dir).ok_or_else(|| "No home directory found".to_string())
}

fn wsl_claude_credentials_path(home: &str) -> String {
    format!("{}/{}", home.trim_end_matches('/'), CLAUDE_CREDENTIALS_FILE)
}

fn credentials_have_access_token(credentials: &ClaudeCredentialsFile) -> bool {
    credentials
        .claude_ai_oauth
        .as_ref()
        .and_then(|o| o.access_token.as_ref())
        .is_some()
}

fn parse_claude_credentials(raw: &str) -> Result<ClaudeCredentialsFile, String> {
    serde_json::from_str::<ClaudeCredentialsFile>(raw)
        .map_err(|e| format!("Failed to parse Claude credentials JSON: {e}"))
}

fn read_wsl_claude_credentials(distro: &str, path: &str) -> Result<ClaudeCredentialsFile, String> {
    let output = crate::platform::wsl_aware_command("cat", None)
        .arg(path)
        .output()
        .map_err(|e| format!("Failed to read Claude credentials inside WSL: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Claude credentials not found inside WSL distro {distro}. Run `claude` inside WSL to authenticate."
        ));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    parse_claude_credentials(&raw)
}

/// The account Jean wrote under before azeitler/jean#30. Still read, because on a
/// machine that never re-ran `claude` the duplicate Jean created may hold the only
/// credentials left.
#[cfg(target_os = "macos")]
const CLAUDE_KEYCHAIN_LEGACY_ACCOUNT: &str = "claude";

/// The macOS user name. Claude Code stores its keychain item under this account.
#[cfg(target_os = "macos")]
fn macos_user_account() -> Option<String> {
    for key in ["USER", "LOGNAME"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    dirs::home_dir()?
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
/// Pull `acct` out of `security`'s attribute dump. The line is either
/// `"acct"<blob>="alice"` or, for a non-ASCII name, `"acct"<blob>=0x616C  "alic\303\251"`,
/// so take the last quoted run.
///
/// The hex form's readable part is octal-escaped and does not round-trip: reading it
/// back with `-a` finds nothing. That costs us only a candidate, because
/// `macos_user_account` supplies the same account correctly encoded.
fn parse_keychain_account(attributes: &str) -> Option<String> {
    attributes.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("\"acct\"")?;
        let end = rest.rfind('"')?;
        let start = rest[..end].rfind('"')? + 1;
        let value = &rest[start..end];
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// Account of the item `security` returns when no `-a` is given. This is the lookup
/// that used to pick the stale duplicate, so its result is one candidate among
/// several rather than the answer.
#[cfg(target_os = "macos")]
fn default_keychain_account(service: &str) -> Option<String> {
    let output = silent_command("security")
        .args(["find-generic-password", "-s", service])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_keychain_account(&String::from_utf8_lossy(&output.stdout))
}

/// Read the item for `account`, or `None` when it does not exist.
#[cfg(target_os = "macos")]
fn read_keychain_item(service: &str, account: &str) -> Option<ClaudeCredentialsFile> {
    let output = silent_command("security")
        .args(["find-generic-password", "-s", service, "-a", account, "-w"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let payload = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_credentials_json(&payload)
}

#[cfg(target_os = "macos")]
/// Choose the item Claude Code is actually using.
///
/// The login keychain can hold several items under one service name. Jean's own
/// pre-#30 write-back created one, and because the account-less lookup returns
/// whichever item comes first, that duplicate kept winning long after it expired.
/// Ranking by expiry means a stale copy can never win.
///
/// Callers must pass the least trustworthy candidate first: `max_by_key` keeps the
/// last of equal keys, so on a tie the user's own item beats Jean's old duplicate.
fn pick_freshest_credentials(
    candidates: Vec<(String, ClaudeCredentialsFile)>,
) -> Option<(String, ClaudeCredentialsFile)> {
    candidates
        .into_iter()
        .filter(|(_, creds)| credentials_have_access_token(creds))
        .max_by_key(|(_, creds)| {
            creds
                .claude_ai_oauth
                .as_ref()
                .and_then(oauth_expires_at_ms)
                .unwrap_or(0)
        })
}

/// Returns the account the credentials came from, so the write-back updates that
/// same item instead of creating another one.
#[cfg(target_os = "macos")]
fn load_credentials_from_keychain(
    config_dir: Option<&str>,
) -> Option<(String, ClaudeCredentialsFile)> {
    let service = accounts::keychain_service(config_dir);
    let mut accounts: Vec<String> = Vec::new();
    for account in [
        // Jean's pre-#30 duplicate only ever existed for the root install.
        config_dir
            .is_none()
            .then(|| CLAUDE_KEYCHAIN_LEGACY_ACCOUNT.to_string()),
        default_keychain_account(&service),
        macos_user_account(),
    ]
    .into_iter()
    .flatten()
    {
        if !accounts.contains(&account) {
            accounts.push(account);
        }
    }

    let candidates = accounts
        .into_iter()
        .filter_map(|account| read_keychain_item(&service, &account).map(|creds| (account, creds)))
        .collect();
    pick_freshest_credentials(candidates)
}

/// Reads the signed-in account email from `~/.claude.json` (or `<dir>/.claude.json`
/// for another config folder). Claude Code keeps the OAuth profile there under
/// `oauthAccount`. Returns `None` in WSL mode.
fn read_claude_account_email(config_dir: Option<&str>) -> Option<String> {
    if crate::platform::get_wsl_config().enabled {
        return None;
    }
    let path = accounts::global_config_file(config_dir)?;
    let raw = std::fs::read_to_string(path).ok()?;
    email_from_claude_config(&serde_json::from_str(&raw).ok()?)
}

fn email_from_claude_config(config: &Value) -> Option<String> {
    config
        .get("oauthAccount")?
        .get("emailAddress")?
        .as_str()
        .map(str::trim)
        .filter(|email| !email.is_empty())
        .map(str::to_string)
}

fn load_claude_credentials(config_dir: Option<&str>) -> Result<ClaudeCredentialsFile, String> {
    let wsl = crate::platform::get_wsl_config();
    if wsl.enabled {
        if config_dir.is_some() {
            return Err("Extra Claude accounts are not supported in WSL mode yet.".to_string());
        }
        let home = crate::platform::get_wsl_home_dir(&wsl.distro)?;
        let cred_path = wsl_claude_credentials_path(&home);
        let parsed = read_wsl_claude_credentials(&wsl.distro, &cred_path)?;
        if credentials_have_access_token(&parsed) {
            return Ok(parsed);
        }
        return Err(format!(
            "Claude credentials not found inside WSL distro {}. Run `claude` inside WSL to authenticate.",
            wsl.distro
        ));
    }

    // OpenUsage order: macOS keychain is Claude Code's source of truth and must win
    // over a potentially stale ~/.claude/.credentials.json.
    #[cfg(target_os = "macos")]
    {
        if let Some((_, parsed)) = load_credentials_from_keychain(config_dir) {
            // `pick_freshest_credentials` already dropped items with no access token.
            return Ok(parsed);
        }
    }

    let cred_path = get_claude_credentials_path(config_dir)?;
    if cred_path.exists() {
        let raw = std::fs::read_to_string(&cred_path)
            .map_err(|e| format!("Failed to read Claude credentials file: {e}"))?;
        let parsed = parse_claude_credentials(&raw)?;
        if credentials_have_access_token(&parsed) {
            return Ok(parsed);
        }
    }

    Err("Claude credentials not found. Run `claude` to authenticate.".to_string())
}

/// Expiry in epoch milliseconds. Claude stores milliseconds; older items used
/// seconds, so normalize before comparing.
fn oauth_expires_at_ms(oauth: &ClaudeOauthCredentials) -> Option<u64> {
    let expires_at = oauth.expires_at?;
    Some(if expires_at > 1_000_000_000_000 {
        expires_at
    } else {
        expires_at.saturating_mul(1000)
    })
}

/// Past its expiry, with no buffer. An expired token cannot work, so the usage
/// request is skipped instead of earning a 401 or 429.
fn token_is_expired(oauth: &ClaudeOauthCredentials, now_ms: u64) -> bool {
    oauth_expires_at_ms(oauth).is_some_and(|expires_ms| now_ms >= expires_ms)
}

fn oauth_has_usage_scope(oauth: &ClaudeOauthCredentials) -> bool {
    match &oauth.scopes {
        Some(scopes) if !scopes.is_empty() => scopes.iter().any(|s| s == "user:profile"),
        // Older credentials predate scopes field — allow and let the API reject if needed.
        _ => true,
    }
}

fn get_usage_cache_dir() -> Option<PathBuf> {
    let base = dirs::cache_dir().or_else(|| dirs::home_dir().map(|h| h.join(".cache")))?;
    Some(base.join("jean").join("usage-cache"))
}

fn get_claude_usage_cache_path(config_dir: Option<&str>) -> Option<PathBuf> {
    Some(get_usage_cache_dir()?.join(accounts::usage_cache_file_name(config_dir)))
}

fn load_cached_claude_usage(
    cache_path: Option<&std::path::Path>,
    now_secs: u64,
) -> Option<ClaudeUsageSnapshot> {
    let path = cache_path?;
    let content = std::fs::read_to_string(path).ok()?;
    let entry: ClaudeUsageCacheEntry = serde_json::from_str(&content).ok()?;
    if now_secs.saturating_sub(entry.cached_at) <= CLAUDE_USAGE_CACHE_TTL_SECS {
        return Some(entry.snapshot);
    }
    None
}

/// Serve last-good usage during 429 / transient failures (OpenUsage cooldown pattern).
fn load_stale_cached_claude_usage(
    cache_path: Option<&std::path::Path>,
    now_secs: u64,
) -> Option<ClaudeUsageSnapshot> {
    let path = cache_path?;
    let content = std::fs::read_to_string(path).ok()?;
    let entry: ClaudeUsageCacheEntry = serde_json::from_str(&content).ok()?;
    if now_secs.saturating_sub(entry.cached_at) <= CLAUDE_USAGE_STALE_CACHE_MAX_SECS {
        return Some(entry.snapshot);
    }
    None
}

/// The last stored usage of any age. For an expired token: an account that is
/// not active gets no `claude` run, so its token is not refreshed for days,
/// and old figures (with their age and reset times) beat an error.
fn load_any_cached_claude_usage(
    cache_path: Option<&std::path::Path>,
) -> Option<ClaudeUsageSnapshot> {
    let content = std::fs::read_to_string(cache_path?).ok()?;
    let entry: ClaudeUsageCacheEntry = serde_json::from_str(&content).ok()?;
    Some(entry.snapshot)
}

fn save_cached_claude_usage(
    cache_path: Option<&std::path::Path>,
    snapshot: &ClaudeUsageSnapshot,
    now_secs: u64,
) {
    let Some(path) = cache_path else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let entry = ClaudeUsageCacheEntry {
        cached_at: now_secs,
        snapshot: snapshot.clone(),
    };
    if let Ok(serialized) = serde_json::to_string_pretty(&entry) {
        let _ = std::fs::write(path, serialized);
    }
}

/// True when Claude can run via env API key (no OAuth login required).
fn claude_env_api_key_present() -> bool {
    std::env::var_os("ANTHROPIC_API_KEY")
        .map(|v| !v.is_empty())
        .unwrap_or(false)
}

/// Fallback auth signals when `claude auth status` is false or unavailable.
/// Covers keychain/credentials.json OAuth tokens and ANTHROPIC_API_KEY.
fn claude_credentials_or_env_authenticated(config_dir: Option<&str>) -> bool {
    if claude_env_api_key_present() {
        return true;
    }
    match load_claude_credentials(config_dir) {
        Ok(creds) => credentials_have_access_token(&creds),
        Err(_) => false,
    }
}

/// Check if Claude CLI is authenticated.
///
/// `account_id`: `None` checks the active account (the one new runs use), `"root"`
/// the root install, any other id that account's config folder.
pub async fn check_claude_cli_auth(
    app: AppHandle,
    account_id: Option<String>,
) -> Result<ClaudeAuthStatus, String> {
    log::trace!("Checking Claude CLI authentication status");
    let account = match account_id.as_deref() {
        Some(id) => accounts::load_account(&app, Some(id)),
        None => accounts::load_active_account(&app),
    };
    let config_dir = account.config_dir.as_deref();

    let wsl = crate::platform::get_wsl_config();
    let binary_path = resolve_cli_binary(&app);

    if !wsl.enabled && !binary_path.exists() {
        return Ok(ClaudeAuthStatus {
            authenticated: false,
            error: Some("Claude CLI not installed".to_string()),
        });
    }
    if wsl.enabled {
        let tool = binary_path.to_string_lossy().to_string();
        let installed = if tool.starts_with('/') {
            crate::platform::wsl_file_executable(&wsl.distro, &tool)
        } else {
            crate::platform::check_wsl_tool(&wsl.distro, &tool)
        };
        if !installed {
            return Ok(ClaudeAuthStatus {
                authenticated: false,
                error: Some("Claude CLI not installed inside WSL".to_string()),
            });
        }
    }

    log::trace!("Running auth check: {:?}", binary_path);

    let binary_str = binary_path.to_string_lossy().to_string();
    let mut cmd = crate::platform::wsl_aware_command(&binary_str, None);
    cmd.args(["auth", "status"]);
    account.apply_env(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute Claude CLI: {e}"))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        log::trace!("Claude CLI auth check output: {stdout}");
        // Parse JSON response: {"loggedIn": true, ...}
        let logged_in = serde_json::from_str::<serde_json::Value>(&stdout)
            .ok()
            .and_then(|v| v.get("loggedIn")?.as_bool())
            .unwrap_or(false);
        if logged_in {
            return Ok(ClaudeAuthStatus {
                authenticated: true,
                error: None,
            });
        }
        // `auth status` can false-negative while credentials/API key still work
        // (custom providers, credential store vs CLI status desync). Fall back.
        if claude_credentials_or_env_authenticated(config_dir) {
            log::trace!(
                "Claude auth status reported loggedOut; treating as authenticated via credentials/env"
            );
            return Ok(ClaudeAuthStatus {
                authenticated: true,
                error: None,
            });
        }
        Ok(ClaudeAuthStatus {
            authenticated: false,
            error: Some(if stdout.is_empty() {
                "Not authenticated".to_string()
            } else {
                stdout
            }),
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::warn!("Claude CLI auth check failed: {stderr}");
        if claude_credentials_or_env_authenticated(config_dir) {
            log::trace!(
                "Claude auth status command failed; treating as authenticated via credentials/env"
            );
            return Ok(ClaudeAuthStatus {
                authenticated: true,
                error: None,
            });
        }
        Ok(ClaudeAuthStatus {
            authenticated: false,
            error: Some(if stderr.is_empty() {
                "Not authenticated".to_string()
            } else {
                stderr
            }),
        })
    }
}

/// Get current Claude usage of one account. `None` is the root install.
pub async fn get_claude_usage(
    app: AppHandle,
    account_id: Option<String>,
) -> Result<ClaudeUsageSnapshot, String> {
    let prefs = crate::load_preferences_sync(&app).unwrap_or_default();
    let account = accounts::resolve_account(&prefs, account_id.as_deref());
    // The frontend asks only while the popover or the Settings pane is open.
    let renew = renew_request(&app, &account, &accounts::active_account(&prefs));
    let config_dir = account.config_dir.as_deref();
    let cache_path = get_claude_usage_cache_path(config_dir);
    fetch_claude_usage(
        "ui",
        config_dir,
        CLAUDE_USAGE_URL,
        cache_path.as_deref(),
        false,
        renew.as_ref(),
    )
    .await
}

/// Lets the Claude CLI renew an expired token of an account that is not active
/// (#134). Only for on-demand reads: the usage popover, the Settings pane and
/// Refresh. Never for background loops.
struct RenewRequest {
    cli_path: PathBuf,
    account: ResolvedClaudeAccount,
    is_active: bool,
}

fn renew_request(
    app: &AppHandle,
    account: &ResolvedClaudeAccount,
    active: &ResolvedClaudeAccount,
) -> Option<RenewRequest> {
    // In WSL the account's process list lives inside the distro; skip.
    if crate::platform::get_wsl_config().enabled {
        return None;
    }
    Some(RenewRequest {
        cli_path: resolve_cli_binary(app),
        account: account.clone(),
        is_active: account.id == active.id,
    })
}

/// Starts the CLI renew when the rules allow it. True while a renew of this
/// account runs (started now or before).
fn maybe_renew(
    renew: Option<&RenewRequest>,
    config_dir: Option<&str>,
    oauth: &ClaudeOauthCredentials,
    now_ms: u64,
) -> bool {
    use super::usage_renew;
    let Some(request) = renew else {
        return usage_renew::is_renewing(config_dir);
    };
    let expires_at = oauth_expires_at_ms(oauth).unwrap_or(0);
    let inputs = usage_renew::RenewInputs {
        expired: token_is_expired(oauth, now_ms),
        has_refresh_token: oauth
            .refresh_token
            .as_deref()
            .is_some_and(|token| !token.trim().is_empty()),
        is_active: request.is_active,
        claude_running: request
            .account
            .config_path()
            .is_some_and(|path| usage_renew::claude_running(&path)),
        already_tried: usage_renew::already_tried(config_dir, expires_at),
    };
    match usage_renew::renew_decision(inputs) {
        Ok(()) if request.cli_path.exists() => {
            if usage_renew::try_begin(config_dir, expires_at) {
                log::info!(
                    "Claude account {} token expired; asking the Claude CLI to renew it",
                    request.account.id
                );
                let work_dir = get_usage_cache_dir()
                    .unwrap_or_else(std::env::temp_dir)
                    .join("renew");
                usage_renew::spawn_renew(
                    request.cli_path.clone(),
                    request.account.clone(),
                    work_dir,
                );
            }
        }
        Ok(()) => log::trace!("No token renew: Claude CLI not installed"),
        Err(reason) => log::trace!(
            "No token renew for Claude account {}: {reason}",
            request.account.id
        ),
    }
    usage_renew::is_renewing(config_dir)
}

/// Usage of one Claude account, for the all-accounts list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAccountUsage {
    pub account_id: String,
    pub label: String,
    pub active: bool,
    pub usage: Option<ClaudeUsageSnapshot>,
    pub error: Option<String>,
}

/// Usage of every configured Claude account, root first. One account at a time,
/// each through its own 5-minute cache, so this adds no request storm.
pub async fn get_claude_accounts_usage(app: AppHandle) -> Result<Vec<ClaudeAccountUsage>, String> {
    accounts_usage(app, false).await
}

/// Same list, but skips the 5-minute cache: an explicit "Refresh now".
pub async fn refresh_claude_accounts_usage(
    app: AppHandle,
) -> Result<Vec<ClaudeAccountUsage>, String> {
    accounts_usage(app, true).await
}

async fn accounts_usage(
    app: AppHandle,
    skip_cache: bool,
) -> Result<Vec<ClaudeAccountUsage>, String> {
    let prefs = crate::load_preferences_sync(&app).unwrap_or_default();
    let active = accounts::active_account(&prefs);
    let active_id = active.id.clone();
    let mut result = Vec::new();
    for account in accounts::all_accounts(&prefs) {
        let cache_path = get_claude_usage_cache_path(account.config_dir.as_deref());
        // Only the explicit Refresh may renew; the menu bar's 5-minute loop not.
        let renew = skip_cache
            .then(|| renew_request(&app, &account, &active))
            .flatten();
        let fetched = fetch_claude_usage(
            "accounts",
            account.config_dir.as_deref(),
            CLAUDE_USAGE_URL,
            cache_path.as_deref(),
            skip_cache,
            renew.as_ref(),
        )
        .await;
        result.push(ClaudeAccountUsage {
            active: account.id == active_id,
            account_id: account.id,
            label: account.label,
            usage: fetched.as_ref().ok().cloned(),
            error: fetched.err(),
        });
    }
    Ok(result)
}

fn claude_usage_request(
    client: &reqwest::Client,
    usage_url: &str,
    access_token: &str,
) -> reqwest::RequestBuilder {
    client
        .get(usage_url)
        .bearer_auth(access_token.trim())
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::USER_AGENT, CLAUDE_USAGE_USER_AGENT)
        .header("anthropic-beta", "oauth-2025-04-20")
}

pub(crate) async fn get_claude_usage_with_source(
    request_source: &'static str,
    account: &ResolvedClaudeAccount,
) -> Result<ClaudeUsageSnapshot, String> {
    let config_dir = account.config_dir.as_deref();
    let cache_path = get_claude_usage_cache_path(config_dir);
    fetch_claude_usage(
        request_source,
        config_dir,
        CLAUDE_USAGE_URL,
        cache_path.as_deref(),
        false,
        None,
    )
    .await
}

async fn fetch_claude_usage(
    request_source: &'static str,
    config_dir: Option<&str>,
    usage_url: &str,
    cache_path: Option<&std::path::Path>,
    skip_cache: bool,
    renew: Option<&RenewRequest>,
) -> Result<ClaudeUsageSnapshot, String> {
    // Serialize usage fetches so UI + background polls share one request and cache write.
    let _usage_lock = claude_usage_fetch_lock().lock().await;
    log::trace!("Claude usage fetch start (source={request_source})");

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Some(cached) = (!skip_cache)
        .then(|| load_cached_claude_usage(cache_path, now_secs))
        .flatten()
    {
        log::trace!("Claude usage fetch hit cache (source={request_source})");
        return Ok(cached);
    }

    let credentials = load_claude_credentials(config_dir)?;
    let usage_client = build_usage_client()?;

    let oauth = credentials.claude_ai_oauth.clone().ok_or_else(|| {
        "Claude OAuth credentials missing. Run `claude` to authenticate.".to_string()
    })?;

    if !oauth_has_usage_scope(&oauth) {
        return Err(
            "Claude login can run models but lacks usage access (missing user:profile scope). Run `claude` and sign in again."
                .to_string(),
        );
    }

    let access_token = oauth
        .access_token
        .clone()
        .ok_or_else(|| "Claude access token missing. Run `claude` to authenticate.".to_string())?;

    // Jean never refreshes the Claude token. Refresh tokens are single-use: a refresh
    // here revokes the one every running `claude` process holds, and their next
    // refresh fails with "OAuth session expired and could not be refreshed". The
    // Claude CLI owns rotation; Jean reads the new token on a later poll.
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if token_is_expired(&oauth, now_ms) {
        // The Claude CLI may renew it (#134); until then the stored figures stay.
        let renewing = maybe_renew(renew, config_dir, &oauth, now_ms);
        if let Some(mut stale) = load_any_cached_claude_usage(cache_path) {
            log::trace!(
                "Claude access token expired; serving stale cache until Claude refreshes it (source={request_source})"
            );
            stale.renewing = renewing;
            return Ok(stale);
        }
        return Err(if renewing {
            CLAUDE_TOKEN_RENEWING_MESSAGE
        } else {
            CLAUDE_TOKEN_IDLE_MESSAGE
        }
        .to_string());
    }

    let response = claude_usage_request(&usage_client, usage_url, &access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Claude usage: {e}"))?;

    // OpenUsage: 429 is common — serve stale cache instead of failing hard / re-login.
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        if let Some(stale) = load_stale_cached_claude_usage(cache_path, now_secs) {
            log::info!(
                "Claude usage rate-limited (429); serving stale cache (source={request_source})"
            );
            return Ok(stale);
        }
        return Err(
            "Claude usage API is rate-limiting requests. Try again in a few minutes.".to_string(),
        );
    }

    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        if let Some(stale) = load_stale_cached_claude_usage(cache_path, now_secs) {
            log::warn!("Claude usage auth failed; serving stale cache (source={request_source})");
            return Ok(stale);
        }
        return Err("Claude token expired. Run `claude` to log in again.".to_string());
    }
    if !response.status().is_success() {
        if let Some(stale) = load_stale_cached_claude_usage(cache_path, now_secs) {
            log::warn!(
                "Claude usage HTTP {}; serving stale cache (source={request_source})",
                response.status()
            );
            return Ok(stale);
        }
        return Err(format!(
            "Claude usage request failed (HTTP {}).",
            response.status()
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Claude usage response body: {e}"))?;
    let usage = serde_json::from_str::<ClaudeUsageApiResponse>(&body).map_err(|e| {
        let snippet = body.chars().take(200).collect::<String>();
        format!("Failed to parse Claude usage response JSON: {e}. Body starts with: {snippet}")
    })?;

    let fetched_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let map_window = |window: Option<ClaudeUsageWindow>| -> Option<ClaudeUsageWindowSnapshot> {
        let w = window?;
        Some(ClaudeUsageWindowSnapshot {
            used_percent: w.utilization?,
            resets_at: w.resets_at,
        })
    };

    let (extra_usage_spent, extra_usage_limit) = usage
        .extra_usage
        .and_then(|e| {
            if e.is_enabled.unwrap_or(false) {
                Some((e.used_credits, e.monthly_limit))
            } else {
                None
            }
        })
        .unwrap_or((None, None));

    let snapshot = ClaudeUsageSnapshot {
        plan_type: credentials
            .claude_ai_oauth
            .as_ref()
            .and_then(|o| o.subscription_type.clone()),
        account_email: read_claude_account_email(config_dir),
        session: map_window(usage.five_hour),
        weekly: map_window(usage.seven_day),
        sonnet_weekly: map_window(usage.seven_day_sonnet),
        limits: map_limits(usage.limits),
        extra_usage_spent,
        extra_usage_limit,
        fetched_at,
        renewing: false,
    };

    save_cached_claude_usage(cache_path, &snapshot, fetched_at);
    log::trace!("Claude usage fetch success (source={request_source})");
    Ok(snapshot)
}

/// Result of detecting Claude CLI in system PATH
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudePathDetection {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub package_manager: Option<String>,
}

/// Detect Claude CLI in system PATH (excluding Jean-managed binary)
pub async fn detect_claude_in_path(app: AppHandle) -> Result<ClaudePathDetection, String> {
    log::trace!("Detecting Claude CLI in system PATH");

    let jean_managed_path = get_cli_binary_path(&app)
        .ok()
        .and_then(|p| std::fs::canonicalize(&p).ok());
    let wsl = crate::platform::get_wsl_config();
    let jean_managed_wsl = if wsl.enabled {
        get_wsl_cli_binary_path(&wsl.distro).ok()
    } else {
        None
    };

    let detection = crate::platform::detect_cli_in_path(
        "claude",
        jean_managed_path.as_deref(),
        jean_managed_wsl.as_deref(),
    );

    if !detection.found {
        log::trace!("Claude CLI not found in PATH");
        return Ok(ClaudePathDetection {
            found: false,
            path: None,
            version: None,
            package_manager: None,
        });
    }

    let version = detection.version.map(|v| extract_version_number(&v));

    log::trace!(
        "Found Claude CLI in PATH: {:?} (version: {:?}, pkg_mgr: {:?})",
        detection.path,
        version,
        detection.package_manager
    );

    Ok(ClaudePathDetection {
        found: true,
        path: detection.path,
        version,
        package_manager: detection.package_manager,
    })
}

/// Helper function to emit installation progress events
fn emit_progress(app: &AppHandle, stage: &str, message: &str, percent: u8) {
    let progress = InstallProgress {
        stage: stage.to_string(),
        message: message.to_string(),
        percent,
    };

    if let Err(e) = app.emit_all("claude-cli:install-progress", &progress) {
        log::warn!("Failed to emit install progress: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_expired_token_serves_stored_usage_of_any_age() {
        // An account that is not active is not refreshed for days (#131).
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude-acc.json");
        let snapshot = ClaudeUsageSnapshot {
            plan_type: Some("max".into()),
            account_email: None,
            session: None,
            weekly: None,
            sonnet_weekly: None,
            limits: vec![],
            extra_usage_spent: None,
            extra_usage_limit: None,
            fetched_at: 1_000,
            renewing: false,
        };
        save_cached_claude_usage(Some(&path), &snapshot, 1_000);
        let two_days_later = 1_000 + 2 * 24 * 60 * 60;

        assert!(load_stale_cached_claude_usage(Some(&path), two_days_later).is_none());
        let served = load_any_cached_claude_usage(Some(&path)).expect("stored usage");
        assert_eq!(served.fetched_at, 1_000);
        assert!(load_any_cached_claude_usage(Some(&dir.path().join("none.json"))).is_none());
    }

    #[test]
    fn email_from_claude_config_reads_oauth_account() {
        let config = serde_json::json!({"oauthAccount": {"emailAddress": " a@b.co "}});
        assert_eq!(email_from_claude_config(&config).as_deref(), Some("a@b.co"));
        let blank = serde_json::json!({"oauthAccount": {"emailAddress": ""}});
        assert_eq!(email_from_claude_config(&blank), None);
        assert_eq!(email_from_claude_config(&serde_json::json!({})), None);
    }

    #[test]
    fn wsl_credentials_path_uses_wsl_home() {
        assert_eq!(
            wsl_claude_credentials_path("/home/alice"),
            "/home/alice/.claude/.credentials.json"
        );
        assert_eq!(
            wsl_claude_credentials_path("/home/alice/"),
            "/home/alice/.claude/.credentials.json"
        );
    }

    #[test]
    fn credentials_have_access_token_only_when_oauth_token_exists() {
        let mut credentials = ClaudeCredentialsFile::default();
        assert!(!credentials_have_access_token(&credentials));

        credentials.claude_ai_oauth = Some(ClaudeOauthCredentials {
            access_token: Some("token".to_string()),
            ..Default::default()
        });
        assert!(credentials_have_access_token(&credentials));
    }

    #[test]
    fn claude_env_api_key_present_when_non_empty() {
        // SAFETY: test-only env mutation in a single-threaded unit test.
        unsafe {
            std::env::remove_var("ANTHROPIC_API_KEY");
        }
        assert!(!claude_env_api_key_present());
        unsafe {
            std::env::set_var("ANTHROPIC_API_KEY", "sk-test");
        }
        assert!(claude_env_api_key_present());
        unsafe {
            std::env::remove_var("ANTHROPIC_API_KEY");
        }
    }

    #[test]
    fn token_is_expired_only_past_expiry() {
        let now_ms = 1_700_000_000_000u64;

        let near = ClaudeOauthCredentials {
            expires_at: Some(now_ms + 60_000), // 1 minute left
            ..Default::default()
        };
        assert!(!token_is_expired(&near, now_ms));

        let dead = ClaudeOauthCredentials {
            expires_at: Some(now_ms - 1), // one millisecond ago
            ..Default::default()
        };
        assert!(token_is_expired(&dead, now_ms));

        // Missing expiry: the token may still work, so do not treat it as expired.
        let unknown = ClaudeOauthCredentials {
            expires_at: None,
            ..Default::default()
        };
        assert!(!token_is_expired(&unknown, now_ms));

        // Legacy seconds form normalizes the same way.
        let secs = ClaudeOauthCredentials {
            expires_at: Some(now_ms / 1000 - 60),
            ..Default::default()
        };
        assert!(token_is_expired(&secs, now_ms));
    }

    #[cfg(target_os = "macos")]
    fn keychain_item(expires_at: Option<u64>, has_token: bool) -> ClaudeCredentialsFile {
        ClaudeCredentialsFile {
            claude_ai_oauth: Some(ClaudeOauthCredentials {
                access_token: has_token.then(|| "token".to_string()),
                expires_at,
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    /// The bug in azeitler/jean#30: two items under one service name, and the
    /// account-less lookup kept returning the expired one Jean wrote itself.
    #[cfg(target_os = "macos")]
    #[test]
    fn picks_the_fresh_item_over_a_stale_duplicate() {
        let now_ms = 1_700_000_000_000u64;
        let picked = pick_freshest_credentials(vec![
            (
                "claude".to_string(),
                keychain_item(Some(now_ms - 177 * 86_400_000), true),
            ),
            (
                "alice".to_string(),
                keychain_item(Some(now_ms + 3 * 3_600_000), true),
            ),
        ])
        .expect("an item with an access token");

        assert_eq!(picked.0, "alice");
    }

    /// Order of the candidates must not matter — only the expiry does.
    #[cfg(target_os = "macos")]
    #[test]
    fn picks_the_fresh_item_whichever_order_it_arrives_in() {
        let now_ms = 1_700_000_000_000u64;
        let picked = pick_freshest_credentials(vec![
            (
                "alice".to_string(),
                keychain_item(Some(now_ms + 3 * 3_600_000), true),
            ),
            (
                "claude".to_string(),
                keychain_item(Some(now_ms - 177 * 86_400_000), true),
            ),
        ])
        .expect("an item with an access token");

        assert_eq!(picked.0, "alice");
    }

    /// A single item wins even with no expiry, so a machine that only ever had
    /// Jean's own item keeps working.
    #[cfg(target_os = "macos")]
    #[test]
    fn picks_a_lone_item_without_an_expiry() {
        let picked =
            pick_freshest_credentials(vec![("claude".to_string(), keychain_item(None, true))])
                .expect("the only item");

        assert_eq!(picked.0, "claude");
    }

    /// Callers pass the least trustworthy candidate first, so a tie goes to the
    /// user's own item rather than Jean's legacy duplicate.
    #[cfg(target_os = "macos")]
    #[test]
    fn breaks_a_tie_in_favour_of_the_last_candidate() {
        let picked = pick_freshest_credentials(vec![
            ("claude".to_string(), keychain_item(None, true)),
            ("alice".to_string(), keychain_item(None, true)),
        ])
        .expect("an item with an access token");

        assert_eq!(picked.0, "alice");
    }

    /// An item with no access token is not a candidate, however fresh it looks.
    #[cfg(target_os = "macos")]
    #[test]
    fn skips_items_without_an_access_token() {
        let now_ms = 1_700_000_000_000u64;
        let picked = pick_freshest_credentials(vec![
            (
                "alice".to_string(),
                keychain_item(Some(now_ms + 86_400_000), false),
            ),
            (
                "claude".to_string(),
                keychain_item(Some(now_ms + 3_600_000), true),
            ),
        ])
        .expect("the item that has a token");

        assert_eq!(picked.0, "claude");

        assert!(pick_freshest_credentials(vec![(
            "alice".to_string(),
            keychain_item(Some(now_ms + 86_400_000), false),
        )])
        .is_none());
    }

    /// Reads the real login keychain, so it needs a Mac with a `claude` login and it
    /// will ask for keychain access. This is the check azeitler/jean#30 can only pass
    /// on the affected machine:
    ///
    /// ```sh
    /// cargo test --manifest-path jean-core/Cargo.toml --lib \
    ///   reports_the_real_keychain_item -- --ignored --nocapture
    /// ```
    ///
    /// It fails if the item Jean picks is not the one with the newest expiry — which
    /// is exactly what the stale duplicate used to cause.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "reads the real login keychain and prompts for access"]
    fn reports_the_real_keychain_item() {
        let service = accounts::keychain_service(None);
        let Some((account, creds)) = load_credentials_from_keychain(None) else {
            panic!("no Claude credentials in the keychain — run `claude` to log in first");
        };
        let picked_expiry = creds
            .claude_ai_oauth
            .as_ref()
            .and_then(oauth_expires_at_ms)
            .unwrap_or(0);

        println!("Jean picked account {account:?}, expires_at_ms {picked_expiry}");

        for candidate in [CLAUDE_KEYCHAIN_LEGACY_ACCOUNT.to_string()]
            .into_iter()
            .chain(default_keychain_account(&service))
            .chain(macos_user_account())
        {
            let expiry = read_keychain_item(&service, &candidate)
                .and_then(|c| c.claude_ai_oauth.as_ref().and_then(oauth_expires_at_ms));
            println!("  candidate {candidate:?}: expires_at_ms {expiry:?}");
            if let Some(expiry) = expiry {
                assert!(
                    picked_expiry >= expiry,
                    "picked {account:?} ({picked_expiry}) but {candidate:?} is newer ({expiry})"
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn parses_the_account_out_of_security_attributes() {
        let attributes = r#"keychain: "/Users/alice/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="Claude Code-credentials"
    "acct"<blob>="alice"
    "svce"<blob>="Claude Code-credentials"
"#;
        assert_eq!(
            parse_keychain_account(attributes),
            Some("alice".to_string())
        );

        // A non-ASCII name is printed as hex plus an octal-escaped readable form. We
        // return that form verbatim; it will not match a real account, and
        // `macos_user_account` is what covers the case.
        let hex = "    \"acct\"<blob>=0x616C6963C3A9  \"alic\\303\\251\"\n";
        assert_eq!(
            parse_keychain_account(hex),
            Some("alic\\303\\251".to_string())
        );

        assert_eq!(
            parse_keychain_account("attributes:\n    \"svce\"<blob>=\"x\"\n"),
            None
        );
    }

    #[test]
    fn oauth_credentials_roundtrip_preserves_unknown_fields() {
        let raw = r#"{
            "claudeAiOauth": {
                "accessToken": "a",
                "refreshToken": "r",
                "expiresAt": 1700000000000,
                "subscriptionType": "pro",
                "scopes": ["user:profile", "user:inference"],
                "rateLimitTier": "default_claude_ai",
                "customFutureField": {"nested": true}
            },
            "otherTopLevel": 1
        }"#;
        let parsed = parse_claude_credentials(raw).expect("parse");
        let oauth = parsed.claude_ai_oauth.as_ref().expect("oauth");
        assert_eq!(oauth.access_token.as_deref(), Some("a"));
        assert_eq!(oauth.subscription_type.as_deref(), Some("pro"));
        assert!(oauth_has_usage_scope(oauth));
        assert!(oauth.extra.contains_key("customFutureField"));

        let serialized = serde_json::to_value(&parsed).expect("serialize");
        assert_eq!(
            serialized["claudeAiOauth"]["customFutureField"]["nested"],
            true
        );
        assert_eq!(serialized["otherTopLevel"], 1);
    }

    #[test]
    fn oauth_has_usage_scope_detects_missing_profile() {
        let missing = ClaudeOauthCredentials {
            scopes: Some(vec!["user:inference".into()]),
            ..Default::default()
        };
        assert!(!oauth_has_usage_scope(&missing));

        let ok = ClaudeOauthCredentials {
            scopes: Some(vec!["user:profile".into(), "user:inference".into()]),
            ..Default::default()
        };
        assert!(oauth_has_usage_scope(&ok));
    }

    /// A one-endpoint HTTP server that answers each bearer token with its own
    /// usage figure and counts the requests it served.
    fn spawn_usage_server() -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/api/oauth/usage", listener.local_addr().unwrap());
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = hits.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let used = if request.contains("bearer tok-work") {
                    80
                } else {
                    10
                };
                let body = format!(
                    "{{\"five_hour\":{{\"utilization\":{used},\"resets_at\":null}},\"seven_day\":{{\"utilization\":5}}}}"
                );
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        (url, hits)
    }

    fn write_account(dir: &std::path::Path, token: &str, email: &str) {
        std::fs::create_dir_all(dir).unwrap();
        let expires = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            + 3_600_000;
        std::fs::write(
            dir.join(".credentials.json"),
            serde_json::json!({
                "claudeAiOauth": {
                    "accessToken": token,
                    "expiresAt": expires,
                    "scopes": ["user:inference", "user:profile"],
                    "subscriptionType": "max"
                }
            })
            .to_string(),
        )
        .unwrap();
        std::fs::write(
            dir.join(".claude.json"),
            serde_json::json!({ "oauthAccount": { "emailAddress": email } }).to_string(),
        )
        .unwrap();
    }

    #[test]
    fn usage_is_fetched_and_cached_per_account() {
        let temp = tempfile::tempdir().unwrap();
        let personal = temp.path().join("claude-personal");
        let work = temp.path().join("claude-work");
        write_account(&personal, "tok-personal", "me@example.com");
        write_account(&work, "tok-work", "me@work.example");
        let personal_dir = personal.to_string_lossy().to_string();
        let work_dir = work.to_string_lossy().to_string();
        let personal_cache = temp
            .path()
            .join(accounts::usage_cache_file_name(Some(&personal_dir)));
        let work_cache = temp
            .path()
            .join(accounts::usage_cache_file_name(Some(&work_dir)));
        assert_ne!(personal_cache, work_cache);
        let (url, hits) = spawn_usage_server();

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let fetch = |dir: &str, cache: &std::path::Path| {
            runtime
                .block_on(fetch_claude_usage(
                    "test",
                    Some(dir),
                    &url,
                    Some(cache),
                    false,
                    None,
                ))
                .unwrap()
        };

        let p = fetch(&personal_dir, &personal_cache);
        let w = fetch(&work_dir, &work_cache);
        assert_eq!(p.account_email.as_deref(), Some("me@example.com"));
        assert_eq!(w.account_email.as_deref(), Some("me@work.example"));
        assert_eq!(p.session.as_ref().unwrap().used_percent, 10.0);
        assert_eq!(w.session.as_ref().unwrap().used_percent, 80.0);
        assert_eq!(p.plan_type.as_deref(), Some("max"));
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 2);

        // Within five minutes each account is served from its own cache: no new request.
        let w_again = fetch(&work_dir, &work_cache);
        let p_again = fetch(&personal_dir, &personal_cache);
        assert_eq!(w_again.session.unwrap().used_percent, 80.0);
        assert_eq!(p_again.session.unwrap().used_percent, 10.0);
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    /// An expired idle account: the stored figures come back with `renewing`,
    /// and the Claude CLI (a fake that counts its calls) runs once (#134).
    #[cfg(unix)]
    #[test]
    fn an_expired_idle_account_is_renewed_once_by_the_cli() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let calls = temp.path().join("calls.log");
        let cli = temp.path().join("claude");
        std::fs::write(
            &cli,
            format!(
                "#!/bin/sh\necho \"$CLAUDE_CONFIG_DIR $*\" >> '{}'\nsleep 1\necho '{{\"is_error\":false,\"usage\":{{\"input_tokens\":5,\"output_tokens\":1}}}}'\n",
                calls.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();

        let account_dir = temp.path().join("idle");
        std::fs::create_dir_all(&account_dir).unwrap();
        let dir = account_dir.to_string_lossy().to_string();
        let expired_creds = |refresh: Option<&str>| {
            serde_json::json!({
                "claudeAiOauth": {
                    "accessToken": "expired-token",
                    "refreshToken": refresh,
                    "expiresAt": 1_700_000_000_000u64,
                    "scopes": ["user:inference", "user:profile"]
                }
            })
            .to_string()
        };
        std::fs::write(
            account_dir.join(".credentials.json"),
            expired_creds(Some("r")),
        )
        .unwrap();
        let cache = temp.path().join("cache.json");
        let stored = ClaudeUsageSnapshot {
            plan_type: Some("max".into()),
            account_email: None,
            session: None,
            weekly: None,
            sonnet_weekly: None,
            limits: vec![],
            extra_usage_spent: None,
            extra_usage_limit: None,
            fetched_at: 1_000,
            renewing: false,
        };
        save_cached_claude_usage(Some(&cache), &stored, 1_000);

        let (url, hits) = spawn_usage_server();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let request = |is_active: bool| RenewRequest {
            cli_path: cli.clone(),
            account: ResolvedClaudeAccount {
                id: "acc-idle".into(),
                label: "Idle".into(),
                config_dir: Some(dir.clone()),
            },
            is_active,
        };
        let fetch = |renew: &RenewRequest| {
            runtime.block_on(fetch_claude_usage(
                "test",
                Some(&dir),
                &url,
                Some(&cache),
                true,
                Some(renew),
            ))
        };
        let call_count = || {
            std::fs::read_to_string(&calls)
                .map(|text| text.lines().count())
                .unwrap_or(0)
        };

        // Active account: its runs renew it, Jean does not.
        let active = fetch(&request(true)).unwrap();
        assert!(!active.renewing);

        // Idle: stored figures with `renewing`, one CLI call; a second read
        // while it runs starts no second one (single-flight).
        let first = fetch(&request(false)).unwrap();
        assert!(first.renewing);
        assert_eq!(first.fetched_at, 1_000);
        let second = fetch(&request(false)).unwrap();
        assert!(second.renewing);
        runtime.block_on(super::super::usage_renew::claude_usage_renews_settled());
        assert_eq!(call_count(), 1);
        let line = std::fs::read_to_string(&calls).unwrap();
        assert!(
            line.starts_with(&dir),
            "runs under the account's CLAUDE_CONFIG_DIR"
        );
        assert!(line.contains("--safe-mode") && line.contains("--no-session-persistence"));

        // The CLI did not write a new token (fake): this token was tried, so
        // no retry loop, and the stored figures stay without the hint.
        let after = fetch(&request(false)).unwrap();
        assert!(!after.renewing);
        assert_eq!(call_count(), 1);
        // No usage request with an expired token.
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    /// Not logged in (no refresh token) or a running `claude` process: no renew.
    #[cfg(unix)]
    #[test]
    fn no_renew_without_refresh_token_or_while_claude_runs() {
        let temp = tempfile::tempdir().unwrap();
        let cli = temp.path().join("claude-missing-marker");
        std::fs::write(&cli, "").unwrap();
        for (name, refresh, running) in [("no-refresh", None, false), ("running", Some("r"), true)]
        {
            let account_dir = temp.path().join(name);
            std::fs::create_dir_all(account_dir.join("sessions")).unwrap();
            if running {
                std::fs::write(
                    account_dir
                        .join("sessions")
                        .join(format!("{}.json", std::process::id())),
                    "{}",
                )
                .unwrap();
            }
            std::fs::write(
                account_dir.join(".credentials.json"),
                serde_json::json!({
                    "claudeAiOauth": {
                        "accessToken": "expired-token",
                        "refreshToken": refresh,
                        "expiresAt": 1_700_000_000_000u64,
                        "scopes": ["user:profile"]
                    }
                })
                .to_string(),
            )
            .unwrap();
            let dir = account_dir.to_string_lossy().to_string();
            let renew = RenewRequest {
                cli_path: cli.clone(),
                account: ResolvedClaudeAccount {
                    id: name.into(),
                    label: name.into(),
                    config_dir: Some(dir.clone()),
                },
                is_active: false,
            };
            let result = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(fetch_claude_usage(
                    "test",
                    Some(&dir),
                    "http://127.0.0.1:9/unused",
                    Some(&temp.path().join(format!("{name}.json"))),
                    true,
                    Some(&renew),
                ));
            // No stored figures and no renew: the grey note of 1.5.10.
            assert_eq!(result.unwrap_err(), CLAUDE_TOKEN_IDLE_MESSAGE, "{name}");
            assert!(!super::super::usage_renew::is_renewing(Some(&dir)));
        }
    }

    #[test]
    fn usage_of_a_signed_out_account_fails_without_a_request() {
        let temp = tempfile::tempdir().unwrap();
        let empty = temp.path().join("claude-empty");
        std::fs::create_dir_all(&empty).unwrap();
        let (url, hits) = spawn_usage_server();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(fetch_claude_usage(
            "test",
            Some(&empty.to_string_lossy()),
            &url,
            Some(&temp.path().join("cache.json")),
            false,
            None,
        ));
        assert!(result.is_err());
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    /// Real usage of one extra account, read the way the app reads it. Prints no
    /// token and no email:
    /// ```text
    /// JEAN_TEST_CLAUDE_CONFIG_DIR=/abs/folder cargo test --lib \
    ///   reports_real_usage_of_an_extra_account -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "reads a real login and calls the usage API"]
    fn reports_real_usage_of_an_extra_account() {
        let dir = std::env::var("JEAN_TEST_CLAUDE_CONFIG_DIR")
            .expect("set JEAN_TEST_CLAUDE_CONFIG_DIR to a logged-in config folder");
        let cache = tempfile::tempdir().unwrap();
        let cache_path = cache.path().join("usage.json");
        let snapshot = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(fetch_claude_usage(
                "test",
                Some(&dir),
                CLAUDE_USAGE_URL,
                Some(&cache_path),
                false,
                None,
            ))
            .expect("usage of the extra account");
        println!(
            "keychain service {}, plan {:?}, email present {}, session {:?}, weekly {:?}",
            accounts::keychain_service(Some(&dir)),
            snapshot.plan_type,
            snapshot.account_email.is_some(),
            snapshot.session.map(|w| w.used_percent),
            snapshot.weekly.map(|w| w.used_percent),
        );
        assert!(snapshot.account_email.is_some());
    }

    #[test]
    fn usage_response_with_limits_and_date_resets() {
        let usage: ClaudeUsageApiResponse = serde_json::from_str(
            r#"{"five_hour":null,
                "seven_day":{"utilization":93.0,"resets_at":"2026-11-11T01:00:00+00:00"},
                "limits":[
                  {"kind":"weekly_all","percent":93,"severity":"critical","scope":null},
                  {"kind":"weekly_scoped","percent":34,"severity":"normal",
                   "resets_at":"2026-11-11T01:00:00+00:00",
                   "scope":{"model":{"id":null,"display_name":"Fable"}}}
                ]}"#,
        )
        .unwrap();
        assert!(usage.five_hour.is_none());
        assert_eq!(usage.seven_day.unwrap().resets_at, Some(1_794_358_800));
        let limits = map_limits(usage.limits);
        assert_eq!(limits[0].severity.as_deref(), Some("critical"));
        assert_eq!(limits[1].model.as_deref(), Some("Fable"));
        assert_eq!(limits[1].resets_at, Some(1_794_358_800));
    }

    #[test]
    fn a_number_reset_time_still_parses() {
        let window: ClaudeUsageWindow =
            serde_json::from_str(r#"{"utilization":1,"resets_at":1794358800}"#).unwrap();
        assert_eq!(window.resets_at, Some(1_794_358_800));
    }
}
