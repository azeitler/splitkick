//! `agents.json`: the agent records, their invariants and name lookup.

use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Where an agent's name is unique, and how other sessions find it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentScope {
    Global,
    Project { project_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub scope: AgentScope,
    #[serde(default)]
    pub role_id: Option<String>,
    /// The current session. `None` = "No session" (archived or deleted).
    #[serde(default)]
    pub session_id: Option<String>,
    /// Where the agent runs and restarts.
    pub worktree_id: String,
    /// Earlier sessions, newest first.
    #[serde(default)]
    pub past_session_ids: Vec<String>,
    /// The hidden plain project this agent owns (new global agents only).
    #[serde(default)]
    pub home_project_id: Option<String>,
    pub created_at: u64,
}

static LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;
    Ok(dir.join("agents.json"))
}

fn read(app: &AppHandle) -> Result<Vec<Agent>, String> {
    let path = path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read agents file: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse agents file: {e}"))
}

pub fn load(app: &AppHandle) -> Result<Vec<Agent>, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    read(app)
}

/// Serialized read-modify-write. `f` returns `Err` to abort without a write.
pub fn update<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut Vec<Agent>) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut agents = read(app)?;
    let out = f(&mut agents)?;
    let path = path(app)?;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let json = serde_json::to_string_pretty(&agents)
        .map_err(|e| format!("Failed to serialize agents: {e}"))?;
    std::fs::write(&tmp, json).map_err(|e| format!("Failed to write agents file: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Failed to save agents file: {e}")
    })?;
    Ok(out)
}

fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// The trimmed name, or why it cannot be used in `scope`.
pub fn check_name(
    agents: &[Agent],
    name: &str,
    scope: &AgentScope,
    except_id: Option<&str>,
) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("The agent needs a name".to_string());
    }
    let taken = agents
        .iter()
        .any(|a| Some(a.id.as_str()) != except_id && &a.scope == scope && same_name(&a.name, name));
    if taken {
        return Err(match scope {
            AgentScope::Global => format!("A global agent named \"{name}\" already exists"),
            AgentScope::Project { .. } => {
                format!("This project already has an agent named \"{name}\"")
            }
        });
    }
    Ok(name.to_string())
}

/// A session is the current session of one agent at most.
pub fn check_session_free(
    agents: &[Agent],
    session_id: &str,
    except_id: Option<&str>,
) -> Result<(), String> {
    match agents
        .iter()
        .find(|a| a.session_id.as_deref() == Some(session_id) && Some(a.id.as_str()) != except_id)
    {
        Some(a) => Err(format!("This session is already the agent \"{}\"", a.name)),
        None => Ok(()),
    }
}

/// The agent whose current session is `session_id`.
pub fn for_session<'a>(agents: &'a [Agent], session_id: &str) -> Option<&'a Agent> {
    agents
        .iter()
        .find(|a| a.session_id.as_deref() == Some(session_id))
}

pub enum Resolved<'a> {
    One(&'a Agent),
    None,
    Many(Vec<&'a Agent>),
}

/// `key` is an id or a name. A name is looked up in `project_id` first, then
/// among the global agents. A name that only project agents carry is taken
/// when exactly one has it.
pub fn resolve<'a>(agents: &'a [Agent], key: &str, project_id: Option<&str>) -> Resolved<'a> {
    if let Some(agent) = agents.iter().find(|a| a.id == key) {
        return Resolved::One(agent);
    }
    let named: Vec<&Agent> = agents.iter().filter(|a| same_name(&a.name, key)).collect();
    if let Some(pid) = project_id {
        let own = named
            .iter()
            .find(|a| matches!(&a.scope, AgentScope::Project { project_id } if project_id == pid));
        if let Some(agent) = own {
            return Resolved::One(agent);
        }
    }
    if let Some(agent) = named.iter().find(|a| a.scope == AgentScope::Global) {
        return Resolved::One(agent);
    }
    match named.len() {
        0 => Resolved::None,
        1 => Resolved::One(named[0]),
        _ => Resolved::Many(named),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(id: &str, name: &str, scope: AgentScope, session: Option<&str>) -> Agent {
        Agent {
            id: id.into(),
            name: name.into(),
            scope,
            role_id: None,
            session_id: session.map(str::to_string),
            worktree_id: "wt".into(),
            past_session_ids: vec![],
            home_project_id: None,
            created_at: 0,
        }
    }
    fn project(id: &str) -> AgentScope {
        AgentScope::Project {
            project_id: id.into(),
        }
    }

    #[test]
    fn a_name_is_unique_in_its_scope_only() {
        let agents = vec![agent("a", "Reviewer", AgentScope::Global, None)];
        assert!(check_name(&agents, "  reviewer ", &AgentScope::Global, None).is_err());
        assert_eq!(
            check_name(&agents, " Reviewer ", &project("p1"), None).unwrap(),
            "Reviewer"
        );
        // Renaming an agent to its own name is fine.
        assert!(check_name(&agents, "Reviewer", &AgentScope::Global, Some("a")).is_ok());
        assert!(check_name(&agents, "   ", &AgentScope::Global, None).is_err());
    }

    #[test]
    fn a_session_belongs_to_one_agent() {
        let agents = vec![agent("a", "A", AgentScope::Global, Some("s1"))];
        assert!(check_session_free(&agents, "s1", None).is_err());
        assert!(check_session_free(&agents, "s1", Some("a")).is_ok());
        assert!(check_session_free(&agents, "s2", None).is_ok());
        assert_eq!(for_session(&agents, "s1").map(|a| a.id.as_str()), Some("a"));
    }

    #[test]
    fn a_name_resolves_in_the_callers_project_first() {
        let agents = vec![
            agent("g", "Reviewer", AgentScope::Global, None),
            agent("p", "reviewer", project("p1"), None),
            agent("q", "Reviewer", project("p2"), None),
        ];
        assert!(
            matches!(resolve(&agents, "Reviewer", Some("p1")), Resolved::One(a) if a.id == "p")
        );
        assert!(
            matches!(resolve(&agents, "Reviewer", Some("p3")), Resolved::One(a) if a.id == "g")
        );
        assert!(matches!(resolve(&agents, "Reviewer", None), Resolved::One(a) if a.id == "g"));
        // By id.
        assert!(matches!(resolve(&agents, "q", None), Resolved::One(a) if a.id == "q"));
        assert!(matches!(resolve(&agents, "Nobody", None), Resolved::None));
    }

    #[test]
    fn a_project_only_name_from_outside_lists_the_candidates() {
        let agents = vec![
            agent("p", "Release manager", project("p1"), None),
            agent("q", "Release manager", project("p2"), None),
        ];
        assert!(
            matches!(resolve(&agents, "release manager", None), Resolved::Many(v) if v.len() == 2)
        );
        // Exactly one project agent of that name: it is unambiguous.
        assert!(
            matches!(resolve(&agents[..1], "Release manager", Some("p9")), Resolved::One(a) if a.id == "p")
        );
    }

    #[test]
    fn the_store_round_trips_and_aborts_without_a_write() {
        let temp = tempfile::tempdir().unwrap();
        let app = tauri::AppHandle::new(temp.path().join("data"), temp.path().into()).unwrap();
        assert!(load(&app).unwrap().is_empty());
        update(&app, |agents| {
            agents.push(agent("a", "A", project("p1"), Some("s1")));
            Ok(())
        })
        .unwrap();
        let failed: Result<(), String> = update(&app, |agents| {
            agents.clear();
            Err("no".to_string())
        });
        assert!(failed.is_err());
        let agents = load(&app).unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].scope, project("p1"));
    }
}
