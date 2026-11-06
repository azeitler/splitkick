mod attention;
mod commands;
mod pty;
mod registry;
mod types;

mod run_env;

// Re-export commands for registration in lib.rs
pub use commands::*;

// Re-export internal functions for app lifecycle cleanup
pub use pty::kill_all_terminals as cleanup_all_terminals;

/// Open terminal PTYs (memory report, issue #97).
pub(crate) fn terminal_count() -> usize {
    registry::TERMINAL_SESSIONS
        .lock()
        .map(|sessions| sessions.len())
        .unwrap_or(0)
}
