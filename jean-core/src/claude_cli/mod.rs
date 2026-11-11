//! Claude CLI management module
//!
//! Handles downloading, installing, and managing the Claude CLI binary
//! embedded within the Jean application.

pub mod accounts;
mod commands;
mod config;
pub mod mcp;
mod usage_renew;

pub use accounts::{normalize_accounts, ClaudeAccount};
pub use commands::*;
pub use config::*;
pub use usage_renew::claude_usage_renews_settled;
