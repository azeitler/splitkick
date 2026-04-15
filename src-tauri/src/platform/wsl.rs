//! WSL (Windows Subsystem for Linux) support
//!
//! When WSL mode is enabled, all subprocess execution is routed through `wsl.exe`
//! with proper path translation. Native Windows remains the default.

use std::process::Command;
use std::sync::{OnceLock, RwLock};

use super::silent_command;

/// Cached WSL configuration, initialized at app startup from preferences.
static WSL_CONFIG: OnceLock<RwLock<WslConfig>> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct WslConfig {
    pub enabled: bool,
    pub distro: String,
}

impl Default for WslConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            distro: String::new(),
        }
    }
}

/// Initialize the WSL config cache from app preferences.
/// Called once at app startup.
pub fn init_wsl_config(enabled: bool, distro: String) {
    let config = WslConfig { enabled, distro };
    let lock = WSL_CONFIG.get_or_init(|| RwLock::new(WslConfig::default()));
    if let Ok(mut w) = lock.write() {
        *w = config;
    }
}

/// Read the current WSL config (cheap clone).
pub fn get_wsl_config() -> WslConfig {
    WSL_CONFIG
        .get()
        .and_then(|lock| lock.read().ok().map(|r| r.clone()))
        .unwrap_or_default()
}

/// Update WSL config at runtime (e.g., when preferences change).
pub fn update_wsl_config(enabled: bool, distro: String) {
    if let Some(lock) = WSL_CONFIG.get() {
        if let Ok(mut w) = lock.write() {
            w.enabled = enabled;
            w.distro = distro;
        }
    }
}

/// Convert a Windows path to a WSL Unix path.
///
/// Handles:
/// - UNC paths: `\\wsl.localhost\Ubuntu\home\user` -> `/home/user`
/// - UNC paths: `\\wsl$\Ubuntu\home\user` -> `/home/user`
/// - Drive paths: `C:\Users\foo` -> `/mnt/c/Users/foo`
pub fn win_to_wsl_path(path: &str) -> String {
    // Normalize backslashes
    let normalized = path.replace('\\', "/");

    // Handle \\wsl.localhost\Distro\... or \\wsl$\Distro\...
    for prefix in &["//wsl.localhost/", "//wsl$/"] {
        if let Some(rest) = normalized.strip_prefix(prefix) {
            // rest = "Ubuntu/home/user/..."
            // Skip the distro name to get the Unix path
            if let Some(slash_pos) = rest.find('/') {
                return rest[slash_pos..].to_string();
            }
            // Path is just the distro root
            return "/".to_string();
        }
    }

    // Handle drive letter paths: C:\... -> /mnt/c/...
    if normalized.len() >= 3
        && normalized.as_bytes()[0].is_ascii_alphabetic()
        && &normalized[1..3] == ":/"
    {
        let drive = (normalized.as_bytes()[0] as char).to_ascii_lowercase();
        return format!("/mnt/{drive}/{}", &normalized[3..]);
    }

    // Already a Unix path or unknown format — return as-is
    normalized
}

/// Convert a WSL Unix path to a Windows UNC path.
///
/// `/home/user` -> `\\wsl.localhost\<distro>\home\user`
pub fn wsl_to_win_path(unix_path: &str, distro: &str) -> String {
    if unix_path.starts_with("/mnt/") && unix_path.len() >= 6 {
        // /mnt/c/Users/foo -> C:\Users\foo
        let drive = (unix_path.as_bytes()[5] as char).to_ascii_uppercase();
        let rest = if unix_path.len() > 6 {
            &unix_path[6..]
        } else {
            "\\"
        };
        return format!("{drive}:{}", rest.replace('/', "\\"));
    }

    format!(
        "\\\\wsl.localhost\\{distro}{}",
        unix_path.replace('/', "\\")
    )
}

/// Create a Command that routes through WSL when enabled.
///
/// On non-Windows or when WSL is disabled, this is equivalent to `silent_command(program)`
/// with an optional `current_dir`.
pub fn wsl_aware_command(program: &str, cwd: Option<&std::path::Path>) -> Command {
    let config = get_wsl_config();

    if !config.enabled {
        let mut cmd = silent_command(program);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        return cmd;
    }

    // Route through wsl.exe
    let mut cmd = silent_command("wsl.exe");
    let mut args = vec!["-d".to_string(), config.distro.clone()];

    if let Some(dir) = cwd {
        let dir_str = dir.to_string_lossy();
        let unix_path = win_to_wsl_path(&dir_str);
        args.extend(["--cd".to_string(), unix_path]);
    }

    args.extend(["--".to_string(), program.to_string()]);
    cmd.args(&args);
    cmd
}

/// Check if WSL is available on this system.
#[cfg(windows)]
pub fn is_wsl_available() -> bool {
    silent_command("wsl.exe")
        .arg("--status")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub fn is_wsl_available() -> bool {
    false
}

/// List available WSL distributions.
#[cfg(windows)]
pub fn list_wsl_distros() -> Vec<String> {
    let output = match silent_command("wsl.exe").args(["-l", "-q"]).output() {
        Ok(o) if o.status.success() => o,
        _ => return vec![],
    };

    // wsl -l -q on Windows outputs UTF-16LE
    let stdout = &output.stdout;
    let text = if stdout.len() >= 2 && stdout[0] == 0xFF && stdout[1] == 0xFE {
        // UTF-16LE BOM
        decode_utf16le(&stdout[2..])
    } else if stdout.iter().any(|&b| b == 0) {
        // No BOM but has null bytes — likely UTF-16LE
        decode_utf16le(stdout)
    } else {
        String::from_utf8_lossy(stdout).to_string()
    };

    text.lines()
        .map(|l| l.trim().trim_matches('\0'))
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

#[cfg(not(windows))]
pub fn list_wsl_distros() -> Vec<String> {
    vec![]
}

/// Decode a byte slice as UTF-16LE to a String.
fn decode_utf16le(bytes: &[u8]) -> String {
    let u16s: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    String::from_utf16_lossy(&u16s)
}

/// Check if a tool exists inside a WSL distro.
#[cfg(windows)]
pub fn check_wsl_tool(distro: &str, tool: &str) -> bool {
    silent_command("wsl.exe")
        .args(["-d", distro, "--", "which", tool])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub fn check_wsl_tool(_distro: &str, _tool: &str) -> bool {
    false
}

/// Get the home directory inside a WSL distro.
#[cfg(windows)]
pub fn get_wsl_home_dir(distro: &str) -> Result<String, String> {
    let output = silent_command("wsl.exe")
        .args(["-d", distro, "--", "sh", "-c", "echo $HOME"])
        .output()
        .map_err(|e| format!("Failed to run wsl.exe: {e}"))?;

    if !output.status.success() {
        return Err("Failed to get WSL home directory".to_string());
    }

    let home = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if home.is_empty() {
        return Err("WSL home directory is empty".to_string());
    }
    Ok(home)
}

#[cfg(not(windows))]
pub fn get_wsl_home_dir(_distro: &str) -> Result<String, String> {
    Err("WSL is not available on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_win_to_wsl_path_unc_localhost() {
        assert_eq!(
            win_to_wsl_path(r"\\wsl.localhost\Ubuntu\home\user\project"),
            "/home/user/project"
        );
    }

    #[test]
    fn test_win_to_wsl_path_unc_wsl_dollar() {
        assert_eq!(
            win_to_wsl_path(r"\\wsl$\Ubuntu\home\user"),
            "/home/user"
        );
    }

    #[test]
    fn test_win_to_wsl_path_drive_letter() {
        assert_eq!(
            win_to_wsl_path(r"C:\Users\foo\project"),
            "/mnt/c/Users/foo/project"
        );
    }

    #[test]
    fn test_win_to_wsl_path_unix_passthrough() {
        assert_eq!(win_to_wsl_path("/home/user"), "/home/user");
    }

    #[test]
    fn test_wsl_to_win_path_home() {
        assert_eq!(
            wsl_to_win_path("/home/user/project", "Ubuntu"),
            r"\\wsl.localhost\Ubuntu\home\user\project"
        );
    }

    #[test]
    fn test_wsl_to_win_path_mnt() {
        assert_eq!(
            wsl_to_win_path("/mnt/c/Users/foo", "Ubuntu"),
            r"C:\Users\foo"
        );
    }

    #[test]
    fn test_wsl_aware_command_disabled() {
        // With default (disabled) config, should behave like silent_command
        let cmd = wsl_aware_command("git", Some(std::path::Path::new("/tmp")));
        let program = format!("{:?}", cmd.get_program());
        assert!(program.contains("git"));
    }

    #[test]
    fn test_decode_utf16le() {
        let input = "Ubuntu\0".encode_utf16().flat_map(|c| c.to_le_bytes()).collect::<Vec<_>>();
        let result = decode_utf16le(&input);
        assert!(result.contains("Ubuntu"));
    }
}
