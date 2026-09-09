pub mod notifications;

#[cfg(target_os = "macos")]
pub mod flavor_seed;

#[cfg(target_os = "macos")]
pub use flavor_seed::seed_flavor_state;

#[cfg(target_os = "linux")]
pub mod linux_webkit;

#[cfg(target_os = "linux")]
pub use linux_webkit::apply_linux_webkit_env;

pub mod windows_webview;
pub use windows_webview::install_process_failed_recovery;
