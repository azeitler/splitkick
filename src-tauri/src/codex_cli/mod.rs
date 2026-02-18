//! Codex CLI management module
//!
//! Handles resolving, installing, and authenticating the Codex CLI binary.

mod commands;
mod config;

pub use commands::*;
pub use config::{get_cli_binary_path, resolve_cli_binary};
