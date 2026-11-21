//! Agents: named, unique role holders. An agent is a record that points to
//! exactly one current session; a role (`RoleProfile`) is only a session
//! preset. See `docs/developer/agents.md`.

pub mod commands;
pub mod store;

pub use commands::*;
pub use store::{Agent, AgentScope};
