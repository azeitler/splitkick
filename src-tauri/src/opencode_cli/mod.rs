//! OpenCode CLI management module
//!
//! Handles resolving, installing, and authenticating the OpenCode CLI binary.

mod commands;
mod config;

pub use commands::*;
pub use config::resolve_cli_binary;
