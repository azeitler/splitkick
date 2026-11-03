//! Graph permissions of sessions. The user (UI commands) always has `manage`.

use tauri::AppHandle;

use super::model::{GraphActor, GraphPermission};
use crate::AgentProfile;

/// MCP `source` for callers that are not a Splitkick session.
pub const ANON_SOURCE: &str = "anon";

pub fn permission_allows(have: GraphPermission, need: GraphPermission) -> bool {
    have >= need
}

pub fn parse_permission(s: &str) -> Result<GraphPermission, String> {
    GraphPermission::parse(s).ok_or_else(|| format!("Unknown graph permission: {s}"))
}

pub fn agent_profiles(app: &AppHandle) -> Vec<AgentProfile> {
    crate::load_preferences_sync(app)
        .map(|p| p.agent_profiles)
        .unwrap_or_default()
}

pub fn find_agent(app: &AppHandle, agent_id: &str) -> Option<AgentProfile> {
    agent_profiles(app).into_iter().find(|a| a.id == agent_id)
}

/// `graph_permission`, else the agent's level, else `read`.
fn resolve(
    graph_permission: Option<&str>,
    agent_id: Option<&str>,
    profiles: &[AgentProfile],
) -> GraphPermission {
    if let Some(p) = graph_permission.and_then(GraphPermission::parse) {
        return p;
    }
    agent_id
        .and_then(|id| profiles.iter().find(|a| a.id == id))
        .and_then(|a| GraphPermission::parse(&a.permission))
        .unwrap_or(GraphPermission::Read)
}

/// Effective graph permission of a session. Unknown sessions and `anon` get `read`.
pub fn effective_permission(app: &AppHandle, session_id: &str) -> GraphPermission {
    if session_id == ANON_SOURCE || session_id.is_empty() {
        return GraphPermission::Read;
    }
    match crate::chat::storage::load_metadata(app, session_id) {
        Ok(Some(m)) => resolve(
            m.graph_permission.as_deref(),
            m.agent_id.as_deref(),
            &agent_profiles(app),
        ),
        _ => GraphPermission::Read,
    }
}

/// The change-log actor for a calling session (`anon` → a session actor named "anon").
pub fn session_actor(app: &AppHandle, session_id: &str) -> GraphActor {
    let metadata = crate::chat::storage::load_metadata(app, session_id)
        .ok()
        .flatten();
    GraphActor::Session {
        session_id: session_id.to_string(),
        session_name: metadata
            .as_ref()
            .map(|m| m.name.clone())
            .unwrap_or_else(|| session_id.to_string()),
        agent_id: metadata.and_then(|m| m.agent_id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(id: &str, permission: &str) -> AgentProfile {
        AgentProfile {
            id: id.into(),
            name: id.into(),
            color: String::new(),
            persona: String::new(),
            permission: permission.into(),
            backend: None,
            model: None,
            default_serves: None,
        }
    }

    #[test]
    fn override_then_agent_then_read() {
        let profiles = vec![agent("a1", "write")];
        assert_eq!(
            resolve(Some("manage"), Some("a1"), &profiles),
            GraphPermission::Manage
        );
        assert_eq!(resolve(None, Some("a1"), &profiles), GraphPermission::Write);
        assert_eq!(
            resolve(None, Some("gone"), &profiles),
            GraphPermission::Read
        );
        assert_eq!(resolve(None, None, &profiles), GraphPermission::Read);
    }

    #[test]
    fn levels_are_ordered() {
        assert!(permission_allows(
            GraphPermission::Manage,
            GraphPermission::Write
        ));
        assert!(permission_allows(
            GraphPermission::Write,
            GraphPermission::Write
        ));
        assert!(!permission_allows(
            GraphPermission::Read,
            GraphPermission::Write
        ));
    }
}
