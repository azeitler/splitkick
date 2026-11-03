//! Graph layer: roadmap graphs stored as YAML files, with a registry, change
//! log and requests in app data. Contract: `docs/developer/graph-layer.md`.

pub mod changes;
pub mod commands;
pub mod derive;
pub mod location;
pub mod model;
pub mod permissions;
pub mod requests;
pub mod store;

pub use commands::*;
pub use model::*;
pub use permissions::{effective_permission, permission_allows, session_actor};
pub use requests::create_request;
pub use store::emit_graphs_changed;

#[cfg(test)]
mod tests;
