//! Graph permissions of sessions. The user (UI commands) always has `manage`.

use tauri::AppHandle;

use super::model::{GraphActor, GraphPermission};
use crate::RoleProfile;

/// MCP `source` for callers that are not a Splitkick session.
pub const ANON_SOURCE: &str = "anon";

pub fn permission_allows(have: GraphPermission, need: GraphPermission) -> bool {
    have >= need
}

pub fn parse_permission(s: &str) -> Result<GraphPermission, String> {
    GraphPermission::parse(s).ok_or_else(|| format!("Unknown graph permission: {s}"))
}

pub fn role_profiles(app: &AppHandle) -> Vec<RoleProfile> {
    crate::load_preferences_sync(app)
        .map(|p| p.role_profiles)
        .unwrap_or_default()
}

pub fn find_role(app: &AppHandle, role_id: &str) -> Option<RoleProfile> {
    role_profiles(app).into_iter().find(|a| a.id == role_id)
}

/// `graph_permission`, else the agent's level, else `read`.
fn resolve(
    graph_permission: Option<&str>,
    role_id: Option<&str>,
    profiles: &[RoleProfile],
) -> GraphPermission {
    if let Some(p) = graph_permission.and_then(GraphPermission::parse) {
        return p;
    }
    role_id
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
            m.role_id.as_deref(),
            &role_profiles(app),
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
        role_id: metadata.and_then(|m| m.role_id),
    }
}

/// A session started from a saved role (#109). UI `create_session`
/// takes it; the agent fills what the caller leaves open.
#[derive(Debug, Clone, Default)]
pub struct SessionRoleStart {
    pub role_id: String,
    /// Lower than the agent's level for this session. `None` = the agent's level.
    pub permission: Option<String>,
    /// Graph refs. `None` = the agent's default serves; `Some(vec![])` = none.
    pub serves: Option<Vec<String>>,
}

/// What a new session takes from its agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleSessionDefaults {
    pub name: String,
    pub backend: Option<String>,
    pub model: Option<String>,
    pub permission: GraphPermission,
    pub serves: Vec<String>,
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

/// Resolve the agent's defaults for a new session, as the agent dialog does:
/// the caller's backend wins; the agent's model applies only with the agent's
/// own backend; the permission may be lowered, never raised.
pub fn role_session_defaults(
    agent: &RoleProfile,
    start: &SessionRoleStart,
    backend: Option<&str>,
) -> Result<RoleSessionDefaults, String> {
    let level = parse_permission(&agent.permission)?;
    let permission = match start.permission.as_deref() {
        Some(p) => {
            let p = parse_permission(p)?;
            if p > level {
                return Err(format!(
                    "The permission cannot exceed the agent's level ({})",
                    level.as_str()
                ));
            }
            p
        }
        None => level,
    };
    let agent_backend = non_empty(agent.backend.as_deref());
    let backend = non_empty(backend);
    let model = if backend.is_none() || backend == agent_backend {
        non_empty(agent.model.as_deref())
    } else {
        None
    };
    let serves = match &start.serves {
        Some(list) => list
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        None => non_empty(agent.default_serves.as_deref())
            .into_iter()
            .collect(),
    };
    Ok(RoleSessionDefaults {
        name: agent.name.clone(),
        backend: backend.or(agent_backend),
        model,
        permission,
        serves,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(id: &str, permission: &str) -> RoleProfile {
        RoleProfile {
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

    fn start(role_id: &str) -> SessionRoleStart {
        SessionRoleStart {
            role_id: role_id.into(),
            ..Default::default()
        }
    }

    #[test]
    fn agent_defaults_fill_backend_model_permission_and_serves() {
        let mut a = agent("reviewer", "write");
        a.backend = Some("codex".into());
        a.model = Some("gpt-5.5".into());
        a.default_serves = Some("g1#n1".into());
        let d = role_session_defaults(&a, &start("reviewer"), None).unwrap();
        assert_eq!(
            d,
            RoleSessionDefaults {
                name: "reviewer".into(),
                backend: Some("codex".into()),
                model: Some("gpt-5.5".into()),
                permission: GraphPermission::Write,
                serves: vec!["g1#n1".into()],
            }
        );
    }

    #[test]
    fn agent_defaults_respect_caller_choices() {
        let mut a = agent("reviewer", "write");
        a.backend = Some("codex".into());
        a.model = Some("gpt-5.5".into());
        a.default_serves = Some("g1#n1".into());
        let req = SessionRoleStart {
            role_id: "reviewer".into(),
            permission: Some("read".into()),
            serves: Some(vec![]),
        };
        let d = role_session_defaults(&a, &req, Some("claude")).unwrap();
        assert_eq!(d.backend.as_deref(), Some("claude"));
        // The agent's model belongs to its own backend.
        assert_eq!(d.model, None);
        assert_eq!(d.permission, GraphPermission::Read);
        assert!(d.serves.is_empty());
        // Same backend as the agent: its model applies.
        let d = role_session_defaults(&a, &req, Some("codex")).unwrap();
        assert_eq!(d.model.as_deref(), Some("gpt-5.5"));
    }

    #[test]
    fn agent_defaults_never_raise_the_permission() {
        let a = agent("reader", "read");
        let req = SessionRoleStart {
            role_id: "reader".into(),
            permission: Some("manage".into()),
            serves: None,
        };
        assert!(role_session_defaults(&a, &req, None).is_err());
        let d = role_session_defaults(&a, &start("reader"), None).unwrap();
        assert_eq!(d.backend, None);
        assert!(d.serves.is_empty());
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
