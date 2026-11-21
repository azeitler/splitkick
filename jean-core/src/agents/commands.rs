//! Agent commands: create, adopt a session, change, remove, and the guards
//! that keep an agent from pointing at a session that is gone.

use serde::Serialize;
use tauri::AppHandle;

use super::store::{self, Agent, AgentScope};
use crate::chat::types::SessionMetadata;
use crate::http_server::EmitExt;
use crate::projects::storage::{load_projects_data, save_projects_data};
use crate::projects::types::ProjectsData;

/// An agent as the UI and MCP see it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentView {
    pub id: String,
    pub name: String,
    /// `global` | `project`
    pub scope: String,
    /// The project the agent's workspace is in (to open the session). For a
    /// project agent this is its scope; for a global agent it is its home.
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub role_id: Option<String>,
    pub worktree_id: String,
    pub worktree_path: Option<String>,
    /// `None` = "No session": it was archived or deleted. Restart the agent.
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub past_session_ids: Vec<String>,
    pub created_at: u64,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Tell every client that agents (and what shows them) changed.
pub(super) fn emit(app: &AppHandle) {
    let keys = ["agents", "sessions", "projects"];
    if let Err(e) = app.emit_all("cache:invalidate", &serde_json::json!({ "keys": keys })) {
        log::error!("Failed to emit cache:invalidate for agents: {e}");
    }
}

/// A session an agent can point at.
struct LiveSession {
    id: String,
    name: String,
    worktree_id: String,
    /// `None` for a session that never sent a message.
    metadata: Option<SessionMetadata>,
}

enum SessionState {
    /// It exists and can run: not archived, in a worktree that exists and is
    /// not archived.
    Live(Box<LiveSession>),
    /// Archived or deleted: the agent has no session.
    Gone,
    /// It cannot run now, but it may be back: its metadata could not be read,
    /// or its worktree was archived automatically because its folder is
    /// missing (a drive that is not mounted). The agent keeps its pointer.
    Unknown,
}

fn session_state(app: &AppHandle, data: &ProjectsData, session_id: &str) -> SessionState {
    let metadata = match crate::chat::storage::load_metadata(app, session_id) {
        Ok(metadata) => metadata,
        Err(e) => {
            log::warn!("agents: cannot read the metadata of session {session_id}: {e}");
            return SessionState::Unknown;
        }
    };
    // A session that never sent a message has no metadata file yet; the
    // worktree index knows it.
    let (worktree_id, name, archived_at) = match &metadata {
        Some(m) => (m.worktree_id.clone(), m.name.clone(), m.archived_at),
        None => match crate::chat::schedules::find_session(app, session_id) {
            Ok(found) => (found.worktree_id, found.name, found.archived_at),
            Err(_) => return SessionState::Gone,
        },
    };
    if archived_at.is_some() {
        return SessionState::Gone;
    }
    match data.find_worktree(&worktree_id) {
        None => SessionState::Gone,
        Some(worktree) if worktree.archived_at.is_some() => {
            if worktree.auto_archived {
                SessionState::Unknown
            } else {
                SessionState::Gone
            }
        }
        Some(_) => SessionState::Live(Box::new(LiveSession {
            id: session_id.to_string(),
            name,
            worktree_id,
            metadata,
        })),
    }
}

fn live_session(app: &AppHandle, data: &ProjectsData, session_id: &str) -> Option<LiveSession> {
    match session_state(app, data, session_id) {
        SessionState::Live(session) => Some(*session),
        SessionState::Gone | SessionState::Unknown => None,
    }
}

/// Drop the pointer of every agent whose session is gone, keeping the id in
/// its history. The safety net behind [`session_gone`]: a path that archives
/// or deletes a session without calling it still cannot leave a dead pointer.
fn healed(app: &AppHandle, data: &ProjectsData) -> Result<Vec<Agent>, String> {
    let agents = store::load(app)?;
    let dead: Vec<String> = agents
        .iter()
        .filter_map(|a| a.session_id.clone())
        .filter(|id| matches!(session_state(app, data, id), SessionState::Gone))
        .collect();
    if dead.is_empty() {
        return Ok(agents);
    }
    let agents = store::update(app, |agents| {
        for agent in agents.iter_mut() {
            if agent
                .session_id
                .as_ref()
                .is_some_and(|id| dead.contains(id))
            {
                release_session(agent);
            }
        }
        Ok(agents.clone())
    })?;
    // Other clients hold the old pointer. The refetch this causes finds
    // nothing left to heal, so it does not emit again.
    emit(app);
    Ok(agents)
}

fn release_session(agent: &mut Agent) {
    if let Some(old) = agent.session_id.take() {
        agent.past_session_ids.retain(|id| id != &old);
        agent.past_session_ids.insert(0, old);
    }
}

fn view(app: &AppHandle, data: &ProjectsData, agent: &Agent) -> AgentView {
    let worktree = data.find_worktree(&agent.worktree_id);
    // A project agent belongs to its project also when its workspace is gone:
    // the Agents tab groups it there and offers Restart.
    let project = match &agent.scope {
        AgentScope::Project { project_id } => data.find_project(project_id),
        AgentScope::Global => worktree.and_then(|w| data.find_project(&w.project_id)),
    };
    let session = agent
        .session_id
        .as_deref()
        .and_then(|id| live_session(app, data, id));
    AgentView {
        id: agent.id.clone(),
        name: agent.name.clone(),
        scope: match agent.scope {
            AgentScope::Global => "global",
            AgentScope::Project { .. } => "project",
        }
        .to_string(),
        project_id: project.map(|p| p.id.clone()),
        project_name: project.map(|p| p.name.clone()),
        role_id: agent.role_id.clone(),
        worktree_id: agent.worktree_id.clone(),
        worktree_path: worktree.map(|w| w.path.clone()),
        session_id: session.as_ref().map(|s| s.id.clone()),
        session_name: session.map(|s| s.name),
        past_session_ids: agent.past_session_ids.clone(),
        created_at: agent.created_at,
    }
}

/// One agent's view, by id.
pub(super) fn view_of(app: &AppHandle, agent_id: &str) -> Result<AgentView, String> {
    let data = load_projects_data(app)?;
    store::load(app)?
        .iter()
        .find(|a| a.id == agent_id)
        .map(|a| view(app, &data, a))
        .ok_or_else(|| format!("Unknown agent: {agent_id}"))
}

pub async fn list_agents(app: AppHandle) -> Result<Vec<AgentView>, String> {
    let data = load_projects_data(&app)?;
    Ok(healed(&app, &data)?
        .iter()
        .map(|a| view(&app, &data, a))
        .collect())
}

/// The agent's current session when it can run. Heals a dead pointer.
pub fn current_session(app: &AppHandle, agent_id: &str) -> Result<Option<String>, String> {
    let data = load_projects_data(app)?;
    Ok(healed(app, &data)?
        .into_iter()
        .find(|a| a.id == agent_id)
        .and_then(|a| a.session_id))
}

fn require_role(app: &AppHandle, role_id: Option<&str>) -> Result<(), String> {
    match role_id {
        Some(id) if crate::graphs::permissions::find_role(app, id).is_none() => {
            Err(format!("Unknown role: {id}"))
        }
        _ => Ok(()),
    }
}

/// `~/splitkick/agents/<name>`: where a global agent lives by default.
fn default_home(name: &str) -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;
    let dir = crate::projects::storage::sanitize_directory_name(&name.to_lowercase());
    Ok(home
        .join(crate::brand::WORKTREES_DIR_NAME)
        .join("agents")
        .join(dir)
        .to_string_lossy()
        .to_string())
}

fn expand_home(folder: &str) -> Result<String, String> {
    match folder.strip_prefix("~/") {
        Some(rest) => {
            let home =
                dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;
            Ok(home.join(rest).to_string_lossy().to_string())
        }
        None => Ok(folder.to_string()),
    }
}

/// Create an agent with a new session. With `project_id` it is that
/// project's agent and runs in the project's base session. Without, it is a
/// global agent in `folder` (default `~/splitkick/agents/<name>`), which
/// becomes a hidden plain project unless it already is a project.
pub async fn create_agent(
    app: AppHandle,
    name: String,
    project_id: Option<String>,
    role_id: Option<String>,
    folder: Option<String>,
) -> Result<AgentView, String> {
    let scope = match &project_id {
        Some(project_id) => AgentScope::Project {
            project_id: project_id.clone(),
        },
        None => AgentScope::Global,
    };
    // Every check that can fail runs before anything is created.
    let name = store::check_name(&store::load(&app)?, &name, &scope, None)?;
    require_role(&app, role_id.as_deref())?;

    let data = load_projects_data(&app)?;
    let mut home_project_id = None;
    let run_in_project = match &project_id {
        Some(project_id) => {
            let project = data
                .find_project(project_id)
                .filter(|p| !p.is_folder)
                .ok_or_else(|| format!("Project not found: {project_id}"))?;
            project.id.clone()
        }
        None => {
            let folder = match folder.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
                Some(folder) => expand_home(folder)?,
                None => default_home(&name)?,
            };
            match data
                .projects
                .iter()
                .find(|p| !p.is_folder && p.path == folder)
            {
                Some(existing) => existing.id.clone(),
                None => {
                    let project =
                        crate::projects::add_project(app.clone(), folder, None, true).await?;
                    let mut data = load_projects_data(&app)?;
                    if let Some(p) = data.find_project_mut(&project.id) {
                        p.hidden = true;
                    }
                    save_projects_data(&app, &data)?;
                    home_project_id = Some(project.id.clone());
                    project.id
                }
            }
        }
    };

    let created = start_agent(
        &app,
        &name,
        scope,
        role_id,
        &run_in_project,
        &home_project_id,
    )
    .await;
    match created {
        Ok(agent_id) => {
            emit(&app);
            view_of(&app, &agent_id)
        }
        Err(e) => {
            // Leave nothing behind: the hidden project was made for this agent.
            if let Some(id) = &home_project_id {
                if let Ok(mut data) = load_projects_data(&app) {
                    data.remove_project(id);
                    data.worktrees.retain(|w| &w.project_id != id);
                    let _ = save_projects_data(&app, &data);
                }
            }
            Err(e)
        }
    }
}

async fn start_agent(
    app: &AppHandle,
    name: &str,
    scope: AgentScope,
    role_id: Option<String>,
    project_id: &str,
    home_project_id: &Option<String>,
) -> Result<String, String> {
    let worktree =
        crate::projects::create_base_session(app.clone(), project_id.to_string()).await?;
    let session = crate::chat::create_session(
        app.clone(),
        worktree.id.clone(),
        worktree.path.clone(),
        Some(name.to_string()),
        None,
        None,
        None,
        None,
        None,
        None,
        role_id
            .clone()
            .map(|role_id| crate::graphs::permissions::SessionRoleStart {
                role_id,
                ..Default::default()
            }),
    )
    .await?;
    // A home made for this agent holds nothing but the agent: remove the
    // empty default session that every new workspace starts with.
    if home_project_id.is_some() {
        let others: Vec<String> =
            crate::chat::storage::load_sessions(app, &worktree.path, &worktree.id)?
                .sessions
                .into_iter()
                .map(|s| s.id)
                .filter(|id| id != &session.id)
                .collect();
        for id in others {
            crate::chat::close_session(app.clone(), worktree.id.clone(), worktree.path.clone(), id)
                .await?;
        }
    }
    let agent = Agent {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        scope,
        role_id,
        session_id: Some(session.id.clone()),
        worktree_id: worktree.id,
        past_session_ids: Vec::new(),
        home_project_id: home_project_id.clone(),
        created_at: now(),
    };
    let id = agent.id.clone();
    store::update(app, |agents| {
        store::check_name(agents, &agent.name, &agent.scope, None)?;
        agents.push(agent);
        Ok(())
    })?;
    Ok(id)
}

/// Make an existing session an agent: of its project, or global.
pub async fn make_session_agent(
    app: AppHandle,
    session_id: String,
    name: String,
    global: bool,
) -> Result<AgentView, String> {
    let data = load_projects_data(&app)?;
    let session =
        match session_state(&app, &data, &session_id) {
            SessionState::Live(session) => *session,
            SessionState::Gone => return Err(
                "This session is archived or deleted and cannot be an agent. Unarchive it first."
                    .to_string(),
            ),
            SessionState::Unknown => {
                return Err("This session cannot be read now. Try again.".to_string())
            }
        };
    let worktree = data
        .find_worktree(&session.worktree_id)
        .ok_or_else(|| "The session's worktree no longer exists".to_string())?;
    let scope = if global {
        AgentScope::Global
    } else {
        AgentScope::Project {
            project_id: worktree.project_id.clone(),
        }
    };
    let agent = Agent {
        id: uuid::Uuid::new_v4().to_string(),
        name: String::new(),
        scope,
        role_id: session.metadata.as_ref().and_then(|m| m.role_id.clone()),
        session_id: Some(session_id.clone()),
        worktree_id: worktree.id.clone(),
        past_session_ids: Vec::new(),
        home_project_id: None,
        created_at: now(),
    };
    let id = agent.id.clone();
    store::update(&app, |agents| {
        let name = store::check_name(agents, &name, &agent.scope, None)?;
        store::check_session_free(agents, &session_id, None)?;
        agents.push(Agent { name, ..agent });
        Ok(())
    })?;
    emit(&app);
    view_of(&app, &id)
}

/// Rename an agent and/or change its role. `role_id`: `None` keeps the role,
/// `Some(None)` clears it. The current session takes the new role at once.
pub async fn update_agent(
    app: AppHandle,
    agent_id: String,
    name: Option<String>,
    role_id: Option<Option<String>>,
) -> Result<AgentView, String> {
    if let Some(role_id) = &role_id {
        require_role(&app, role_id.as_deref())?;
    }
    let session_id = store::update(&app, |agents| {
        let index = agents
            .iter()
            .position(|a| a.id == agent_id)
            .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;
        if let Some(name) = &name {
            let scope = agents[index].scope.clone();
            agents[index].name = store::check_name(agents, name, &scope, Some(&agent_id))?;
        }
        if let Some(role_id) = &role_id {
            agents[index].role_id = role_id.clone();
        }
        Ok(agents[index].session_id.clone())
    })?;
    if let (Some(role_id), Some(session_id)) = (role_id, session_id) {
        if let Err(e) =
            crate::graphs::set_session_role(app.clone(), session_id, role_id, None).await
        {
            log::warn!("update_agent: could not set the session role: {e}");
        }
    }
    emit(&app);
    view_of(&app, &agent_id)
}

/// Remove the agent; its session stays as a normal session. The hidden home
/// of a global agent becomes a normal plain project, so the session and its
/// history stay reachable. Nothing on disk is deleted.
pub async fn remove_agent(app: AppHandle, agent_id: String) -> Result<(), String> {
    let agent = store::update(&app, |agents| {
        let index = agents
            .iter()
            .position(|a| a.id == agent_id)
            .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;
        Ok(agents.remove(index))
    })?;
    if let Some(project_id) = &agent.home_project_id {
        let mut data = load_projects_data(&app)?;
        if let Some(project) = data.find_project_mut(project_id) {
            project.hidden = false;
            save_projects_data(&app, &data)?;
        }
    }
    emit(&app);
    Ok(())
}

/// Start the agent again in a fresh session, in the same workspace and role.
/// The first message of the new session hands over the history of the old
/// one (`SessionMetadata.pending_handoff_from`). The old session stays as a
/// normal session. Also the way back from "No session".
pub async fn restart_agent(app: AppHandle, agent_id: String) -> Result<AgentView, String> {
    let data = load_projects_data(&app)?;
    let agent = store::load(&app)?
        .into_iter()
        .find(|a| a.id == agent_id)
        .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;
    let worktree = match data
        .find_worktree(&agent.worktree_id)
        .filter(|w| w.archived_at.is_none())
    {
        Some(worktree) => worktree.clone(),
        // The workspace is gone. An agent that has a project of its own (its
        // scope, or the home made for it) continues in that project's base
        // workspace.
        None => {
            let project_id = match &agent.scope {
                AgentScope::Project { project_id } => Some(project_id.clone()),
                AgentScope::Global => agent.home_project_id.clone(),
            }
            .filter(|id| data.find_project(id).is_some())
            .ok_or_else(|| {
                "The agent's workspace no longer exists. Remove the agent and create it again."
                    .to_string()
            })?;
            crate::projects::create_base_session(app.clone(), project_id).await?
        }
    };
    // The newest earlier session that still has data gives the handoff.
    let source = agent
        .session_id
        .iter()
        .chain(agent.past_session_ids.iter())
        .find_map(|id| crate::chat::storage::load_metadata(&app, id).ok().flatten());
    // A role that was deleted since does not stop the restart.
    let role_id = agent
        .role_id
        .clone()
        .filter(|id| crate::graphs::permissions::find_role(&app, id).is_some());

    let session = crate::chat::create_session(
        app.clone(),
        worktree.id.clone(),
        worktree.path.clone(),
        Some(agent.name.clone()),
        None,
        None,
        None,
        None,
        None,
        None,
        role_id.map(|role_id| crate::graphs::permissions::SessionRoleStart {
            role_id,
            permission: source.as_ref().and_then(|m| m.graph_permission.clone()),
            serves: source.as_ref().map(|m| m.serves.clone()),
        }),
    )
    .await?;

    let moved = (|| {
        if let Some(source) = &source {
            crate::chat::storage::with_existing_metadata_mut(&app, &session.id, |m| {
                m.pending_handoff_from = Some(source.id.clone());
            })?;
        }
        store::update(&app, |agents| {
            let agent = agents
                .iter_mut()
                .find(|a| a.id == agent_id)
                .ok_or_else(|| "The agent was removed".to_string())?;
            release_session(agent);
            agent.session_id = Some(session.id.clone());
            agent.worktree_id = worktree.id.clone();
            Ok(())
        })
    })();
    if let Err(e) = moved {
        // No orphan: the new session goes away, the pointer is unchanged.
        if let Err(close_error) = crate::chat::close_session(
            app.clone(),
            worktree.id.clone(),
            worktree.path.clone(),
            session.id.clone(),
        )
        .await
        {
            log::warn!("restart_agent: could not remove the new session: {close_error}");
        }
        return Err(e);
    }
    emit(&app);
    view_of(&app, &agent_id)
}

/// True when the session is the current session of an agent.
pub fn is_agent_session(app: &AppHandle, session_id: &str) -> bool {
    store::load(app).is_ok_and(|agents| store::for_session(&agents, session_id).is_some())
}

/// A session was archived or deleted: its agent, if any, has no session now.
/// Every path that archives or deletes a session should call this; `healed`
/// covers the ones that do not.
pub fn session_gone(app: &AppHandle, session_id: &str) {
    if !is_agent_session(app, session_id) {
        return;
    }
    let result = store::update(app, |agents| {
        for agent in agents.iter_mut() {
            if agent.session_id.as_deref() == Some(session_id) {
                release_session(agent);
            }
        }
        Ok(())
    });
    match result {
        Ok(()) => emit(app),
        Err(e) => log::warn!("agents::session_gone({session_id}): {e}"),
    }
}

/// A project was removed: its agents go with it.
pub fn remove_for_project(app: &AppHandle, project_id: &str) {
    let belongs = |a: &Agent| {
        matches!(&a.scope, AgentScope::Project { project_id: id } if id == project_id)
            || a.home_project_id.as_deref() == Some(project_id)
    };
    if !store::load(app).is_ok_and(|agents| agents.iter().any(belongs)) {
        return;
    }
    match store::update(app, |agents| {
        agents.retain(|a| !belongs(a));
        Ok(())
    }) {
        Ok(()) => emit(app),
        Err(e) => log::warn!("agents::remove_for_project({project_id}): {e}"),
    }
}

/// True when an agent's current session is in this worktree. Auto-archive
/// leaves such a worktree alone: an agent outlives a merged PR.
pub fn worktree_has_agent(app: &AppHandle, worktree_id: &str) -> bool {
    store::load(app).is_ok_and(|agents| {
        agents
            .iter()
            .any(|a| a.session_id.is_some() && a.worktree_id == worktree_id)
    })
}

/// A project agent belongs to its project: its session cannot move to
/// another one. Called before a session move starts.
pub fn check_session_move(
    app: &AppHandle,
    session_id: &str,
    target_project_id: &str,
) -> Result<(), String> {
    let agents = store::load(app)?;
    match store::for_session(&agents, session_id) {
        Some(Agent {
            name,
            scope: AgentScope::Project { project_id },
            ..
        }) if project_id != target_project_id => Err(format!(
            "This session is the agent \"{name}\" of its project and cannot move to another project. Remove the agent first."
        )),
        _ => Ok(()),
    }
}

/// An agent's session moved: the agent now runs, and restarts, there.
pub fn session_moved(app: &AppHandle, session_id: &str, target_worktree_id: &str) {
    if !is_agent_session(app, session_id) {
        return;
    }
    let result = store::update(app, |agents| {
        for agent in agents.iter_mut() {
            if agent.session_id.as_deref() == Some(session_id) {
                agent.worktree_id = target_worktree_id.to_string();
            }
        }
        Ok(())
    });
    match result {
        Ok(()) => emit(app),
        Err(e) => log::warn!("agents::session_moved({session_id}): {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// One git project `p1` with worktree `wt` and session `s1`.
    fn fixture() -> (tempfile::TempDir, AppHandle) {
        let temp = tempfile::tempdir().unwrap();
        let app = AppHandle::new(temp.path().join("data"), temp.path().into()).unwrap();
        let worktree_path = temp.path().join("wt");
        std::fs::create_dir_all(&worktree_path).unwrap();
        let data: crate::projects::types::ProjectsData = serde_json::from_value(json!({
            "projects": [{
                "id": "p1", "name": "splitkick", "path": temp.path().join("repo"),
                "default_branch": "main", "added_at": 0, "order": 0,
            }],
            "worktrees": [{
                "id": "wt", "project_id": "p1", "name": "fuzzy-tiger",
                "path": worktree_path, "branch": "feature", "created_at": 0,
            }],
        }))
        .unwrap();
        save_projects_data(&app, &data).unwrap();
        add_session(&app, "s1", "release work");
        (temp, app)
    }

    fn add_session(app: &AppHandle, id: &str, name: &str) {
        crate::chat::storage::with_sessions_mut(app, "", "wt", |stored| {
            let mut session = crate::chat::types::Session::new(
                name.to_string(),
                stored.sessions.len() as u32,
                crate::chat::types::Backend::Claude,
            );
            session.id = id.to_string();
            stored.sessions.push(session);
            Ok(())
        })
        .unwrap();
    }

    fn block_on<T>(f: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    #[test]
    fn make_agent_adopts_a_session_and_keeps_it_unique() {
        let (_t, app) = fixture();
        let a = block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            " Release manager ".into(),
            false,
        ))
        .unwrap();
        assert_eq!(a.name, "Release manager");
        assert_eq!(a.scope, "project");
        assert_eq!(a.project_id.as_deref(), Some("p1"));
        assert_eq!(a.project_name.as_deref(), Some("splitkick"));
        assert_eq!(a.session_id.as_deref(), Some("s1"));
        assert_eq!(a.session_name.as_deref(), Some("release work"));
        assert!(is_agent_session(&app, "s1"));
        // The same session cannot be a second agent.
        let again = block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "Other".into(),
            true,
        ));
        assert!(again.unwrap_err().contains("already the agent"));
        // The name is taken in this project, free as a global name.
        add_session(&app, "s2", "other work");
        let taken = block_on(make_session_agent(
            app.clone(),
            "s2".into(),
            "release MANAGER".into(),
            false,
        ));
        assert!(taken.unwrap_err().contains("already has an agent"));
        let global = block_on(make_session_agent(
            app.clone(),
            "s2".into(),
            "Release manager".into(),
            true,
        ))
        .unwrap();
        assert_eq!(global.scope, "global");
    }

    #[test]
    fn a_new_global_agent_gets_a_hidden_plain_project() {
        let (t, app) = fixture();
        let folder = t.path().join("assistant-home");
        let folder_text = folder.to_string_lossy().to_string();
        let a = block_on(create_agent(
            app.clone(),
            "Assistant".into(),
            None,
            None,
            Some(folder_text.clone()),
        ))
        .unwrap();
        assert_eq!(a.scope, "global");
        assert!(a.session_id.is_some());
        assert_eq!(a.session_name.as_deref(), Some("Assistant"));
        assert_eq!(a.worktree_path.as_deref(), Some(folder_text.as_str()));
        assert!(folder.is_dir());
        let data = load_projects_data(&app).unwrap();
        let home = data
            .projects
            .iter()
            .find(|p| p.path == folder_text)
            .unwrap();
        assert!(home.hidden && !home.is_git);
        // The home holds the agent's session only, no empty default beside it.
        let sessions =
            crate::chat::storage::load_sessions(&app, &folder_text, &a.worktree_id).unwrap();
        let names: Vec<&str> = sessions.sessions.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["Assistant"]);
        assert_eq!(sessions.active_session_id, a.session_id);

        // Name taken: nothing is created.
        let again = t.path().join("second-home");
        let failed = block_on(create_agent(
            app.clone(),
            "assistant".into(),
            None,
            None,
            Some(again.to_string_lossy().into()),
        ));
        assert!(failed.is_err());
        assert!(!again.exists());
        assert_eq!(load_projects_data(&app).unwrap().projects.len(), 2);
    }

    #[test]
    fn an_archived_session_leaves_the_agent_without_a_session() {
        let (_t, app) = fixture();
        let a = block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "A".into(),
            true,
        ))
        .unwrap();
        session_gone(&app, "s1");
        let listed = block_on(list_agents(app.clone())).unwrap();
        let a = listed.iter().find(|x| x.id == a.id).unwrap();
        assert_eq!(a.session_id, None);
        assert_eq!(a.past_session_ids, vec!["s1".to_string()]);
        assert!(!is_agent_session(&app, "s1"));
    }

    // No path told the agent store: the list still does not point at a
    // session that cannot run.
    #[test]
    fn list_agents_heals_a_pointer_to_an_archived_session() {
        let (_t, app) = fixture();
        block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "A".into(),
            true,
        ))
        .unwrap();
        crate::chat::storage::with_existing_metadata_mut(&app, "s1", |m| {
            m.archived_at = Some(1);
        })
        .unwrap();
        let listed = block_on(list_agents(app.clone())).unwrap();
        assert_eq!(listed[0].session_id, None);
        assert_eq!(store::load(&app).unwrap()[0].session_id, None);
    }

    #[test]
    fn removing_a_global_agent_turns_its_home_into_a_normal_project() {
        let (t, app) = fixture();
        let folder = t.path().join("home");
        let a = block_on(create_agent(
            app.clone(),
            "Assistant".into(),
            None,
            None,
            Some(folder.to_string_lossy().into()),
        ))
        .unwrap();
        block_on(remove_agent(app.clone(), a.id)).unwrap();
        let data = load_projects_data(&app).unwrap();
        assert_eq!(data.projects.len(), 2);
        assert!(!data.projects.iter().any(|p| p.hidden));
        assert!(folder.is_dir());
        assert!(block_on(list_agents(app.clone())).unwrap().is_empty());
    }

    #[test]
    fn removing_a_project_removes_its_agents_only() {
        let (_t, app) = fixture();
        block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "A".into(),
            false,
        ))
        .unwrap();
        add_session(&app, "s2", "other");
        block_on(make_session_agent(
            app.clone(),
            "s2".into(),
            "G".into(),
            true,
        ))
        .unwrap();
        remove_for_project(&app, "p1");
        let left = store::load(&app).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].name, "G");
    }

    #[test]
    fn rename_checks_the_scope_and_role_must_exist() {
        let (_t, app) = fixture();
        let a = block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "A".into(),
            true,
        ))
        .unwrap();
        add_session(&app, "s2", "other");
        block_on(make_session_agent(
            app.clone(),
            "s2".into(),
            "B".into(),
            true,
        ))
        .unwrap();
        let clash = block_on(update_agent(
            app.clone(),
            a.id.clone(),
            Some("b".into()),
            None,
        ));
        assert!(clash.is_err());
        let renamed = block_on(update_agent(
            app.clone(),
            a.id.clone(),
            Some("Alpha".into()),
            None,
        ))
        .unwrap();
        assert_eq!(renamed.name, "Alpha");
        let ghost = block_on(update_agent(
            app.clone(),
            a.id,
            None,
            Some(Some("ghost".into())),
        ));
        assert!(ghost.unwrap_err().contains("Unknown role"));
    }

    #[test]
    fn a_project_agent_stays_in_its_project_when_its_session_moves() {
        let (_t, app) = fixture();
        block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "Release manager".into(),
            false,
        ))
        .unwrap();
        assert!(check_session_move(&app, "s1", "p1").is_ok());
        let refused = check_session_move(&app, "s1", "p2").unwrap_err();
        assert!(refused.contains("Release manager"), "{refused}");
        // A session that is no agent, and a global agent, move freely.
        add_session(&app, "s2", "other");
        assert!(check_session_move(&app, "s2", "p2").is_ok());
        block_on(make_session_agent(
            app.clone(),
            "s2".into(),
            "G".into(),
            true,
        ))
        .unwrap();
        assert!(check_session_move(&app, "s2", "p2").is_ok());

        // After a move the agent restarts in the new worktree.
        session_moved(&app, "s2", "wt-2");
        let agents = store::load(&app).unwrap();
        let global = agents.iter().find(|a| a.name == "G").unwrap();
        assert_eq!(global.worktree_id, "wt-2");
    }

    #[test]
    fn a_worktree_with_an_agent_session_is_known() {
        let (_t, app) = fixture();
        assert!(!worktree_has_agent(&app, "wt"));
        block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "A".into(),
            true,
        ))
        .unwrap();
        assert!(worktree_has_agent(&app, "wt"));
        session_gone(&app, "s1");
        assert!(!worktree_has_agent(&app, "wt"));
    }

    #[test]
    fn restart_moves_the_pointer_and_marks_the_handoff() {
        let (_t, app) = fixture();
        let a = block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "A".into(),
            false,
        ))
        .unwrap();
        let b = block_on(restart_agent(app.clone(), a.id.clone())).unwrap();
        let new_id = b.session_id.clone().unwrap();
        assert_ne!(new_id, "s1");
        assert_eq!(b.session_name.as_deref(), Some("A"));
        assert_eq!(b.past_session_ids, vec!["s1".to_string()]);
        let meta = crate::chat::storage::load_metadata(&app, &new_id)
            .unwrap()
            .unwrap();
        assert_eq!(meta.pending_handoff_from.as_deref(), Some("s1"));
        assert_eq!(meta.worktree_id, "wt");
        // The old session is a normal session again and is not archived.
        assert!(!is_agent_session(&app, "s1"));
        assert!(is_agent_session(&app, &new_id));
        let old = crate::chat::storage::load_metadata(&app, "s1")
            .unwrap()
            .unwrap();
        assert!(old.archived_at.is_none());
    }

    #[test]
    fn restart_works_without_a_session_and_hands_over_the_last_one() {
        let (_t, app) = fixture();
        let a = block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "A".into(),
            false,
        ))
        .unwrap();
        session_gone(&app, "s1");
        let b = block_on(restart_agent(app.clone(), a.id)).unwrap();
        let new_id = b.session_id.unwrap();
        assert_eq!(b.past_session_ids, vec!["s1".to_string()]);
        let meta = crate::chat::storage::load_metadata(&app, &new_id)
            .unwrap()
            .unwrap();
        assert_eq!(meta.pending_handoff_from.as_deref(), Some("s1"));
    }

    #[test]
    fn a_restart_that_cannot_start_keeps_the_pointer() {
        let (_t, app) = fixture();
        // A global agent adopted from a project has no project to fall back to.
        let a = block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "A".into(),
            true,
        ))
        .unwrap();
        // The agent's workspace is gone: no new session can be made.
        let mut data = load_projects_data(&app).unwrap();
        data.worktrees.clear();
        save_projects_data(&app, &data).unwrap();
        let failed = block_on(restart_agent(app.clone(), a.id.clone()));
        assert!(failed.unwrap_err().contains("workspace"));
        let agents = store::load(&app).unwrap();
        assert_eq!(agents[0].session_id.as_deref(), Some("s1"));
        assert!(agents[0].past_session_ids.is_empty());
    }

    fn metadata_file(app: &AppHandle, session_id: &str) -> std::path::PathBuf {
        use tauri::Manager;
        app.path()
            .app_data_dir()
            .unwrap()
            .join("sessions")
            .join("data")
            .join(session_id)
            .join("metadata.json")
    }

    // The default session of a new workspace has no metadata file until its
    // first message. It is a session all the same.
    #[test]
    fn a_session_that_never_sent_a_message_can_be_an_agent() {
        let (_t, app) = fixture();
        let _ = std::fs::remove_file(metadata_file(&app, "s1"));
        assert!(crate::chat::storage::load_metadata(&app, "s1")
            .unwrap()
            .is_none());
        let a = block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "A".into(),
            false,
        ))
        .unwrap();
        assert_eq!(a.session_id.as_deref(), Some("s1"));
        assert_eq!(a.session_name.as_deref(), Some("release work"));
        // And listing does not take it for a dead session.
        let listed = block_on(list_agents(app.clone())).unwrap();
        assert_eq!(listed[0].session_id.as_deref(), Some("s1"));
    }

    // "Cannot tell" is not "gone": the pointer is dropped for good, so it is
    // dropped only when the session is surely gone.
    #[test]
    fn healing_keeps_the_pointer_when_the_session_state_is_unknown() {
        let (t, app) = fixture();
        block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "A".into(),
            true,
        ))
        .unwrap();

        // A worktree on a drive that is not mounted: loading the projects
        // archives it automatically, and restores it when the folder is back.
        let folder = t.path().join("wt");
        std::fs::remove_dir_all(&folder).unwrap();
        let data = load_projects_data(&app).unwrap();
        assert!(data.worktrees[0].auto_archived, "the fixture's premise");
        let listed = block_on(list_agents(app.clone())).unwrap();
        assert_eq!(listed[0].session_id, None, "it cannot run now");
        assert_eq!(
            store::load(&app).unwrap()[0].session_id.as_deref(),
            Some("s1"),
            "but the agent keeps it"
        );
        std::fs::create_dir_all(&folder).unwrap();
        let listed = block_on(list_agents(app.clone())).unwrap();
        assert_eq!(listed[0].session_id.as_deref(), Some("s1"));

        // A metadata file that cannot be read.
        std::fs::write(metadata_file(&app, "s1"), "{ not json").unwrap();
        let listed = block_on(list_agents(app.clone())).unwrap();
        assert_eq!(listed[0].session_id, None);
        assert_eq!(
            store::load(&app).unwrap()[0].session_id.as_deref(),
            Some("s1")
        );
    }

    // Deleting the worktree of an adopted session must not hide the agent:
    // the tab groups by project, and the name stays taken.
    #[test]
    fn a_project_agent_survives_the_loss_of_its_workspace() {
        let (_t, app) = fixture();
        let a = block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "Release manager".into(),
            false,
        ))
        .unwrap();
        let mut data = load_projects_data(&app).unwrap();
        data.worktrees.clear();
        save_projects_data(&app, &data).unwrap();

        let listed = block_on(list_agents(app.clone())).unwrap();
        assert_eq!(listed[0].scope, "project");
        assert_eq!(listed[0].project_id.as_deref(), Some("p1"));
        assert_eq!(listed[0].project_name.as_deref(), Some("splitkick"));
        assert_eq!(listed[0].session_id, None);

        // Restart brings it back in the project's base workspace.
        let b = block_on(restart_agent(app.clone(), a.id)).unwrap();
        assert!(b.session_id.is_some());
        assert_eq!(b.project_id.as_deref(), Some("p1"));
        let data = load_projects_data(&app).unwrap();
        let base = data.find_base_session("p1").expect("a base session");
        assert_eq!(b.worktree_id, base.id);
    }

    // "Send later…" and "Repeat…" in the session of an agent, and "New
    // Schedule…" on the agent: the schedule is the agent's.
    #[test]
    fn a_schedule_made_in_an_agent_session_follows_the_agent() {
        use crate::chat::schedules::{self, ScheduleOptions, ScheduleTarget};
        let (_t, app) = fixture();
        add_session(&app, "s2", "plain session");
        let a = block_on(make_session_agent(
            app.clone(),
            "s1".into(),
            "A".into(),
            true,
        ))
        .unwrap();
        let later = Some(now() + 3600);
        let with = |target| ScheduleOptions {
            target,
            ..Default::default()
        };

        let into_session =
            schedules::create(&app, "s1", "p", later, None, with(ScheduleTarget::Session)).unwrap();
        assert_eq!(into_session.target, ScheduleTarget::Agent);
        assert_eq!(into_session.agent_id.as_deref(), Some(a.id.as_str()));

        // A new session per run is a different wish: it stays.
        let fresh = schedules::create(
            &app,
            "s1",
            "p",
            later,
            None,
            with(ScheduleTarget::NewSession),
        )
        .unwrap();
        assert_eq!(fresh.target, ScheduleTarget::NewSession);
        assert_eq!(fresh.agent_id, None);

        // A session that is no agent is not touched, and cannot ask for one.
        let plain =
            schedules::create(&app, "s2", "p", later, None, with(ScheduleTarget::Session)).unwrap();
        assert_eq!(plain.target, ScheduleTarget::Session);
        let refused = schedules::create(&app, "s2", "p", later, None, with(ScheduleTarget::Agent));
        assert!(refused.unwrap_err().contains("not an agent"));

        for id in [into_session.id, fresh.id, plain.id] {
            schedules::delete(&app, &id).unwrap();
        }
    }

    /// dispatch_command's future needs more than a debug test thread's stack.
    fn dispatch(
        app: &AppHandle,
        command: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        std::thread::scope(|scope| {
            std::thread::Builder::new()
                .stack_size(32 * 1024 * 1024)
                .spawn_scoped(scope, || {
                    block_on(crate::http_server::dispatch::dispatch_command(
                        app, command, args,
                    ))
                })
                .unwrap()
                .join()
                .unwrap()
        })
    }

    #[test]
    fn the_agent_commands_are_reachable_from_the_app_and_web_access() {
        let (_t, app) = fixture();
        let made = dispatch(
            &app,
            "make_session_agent",
            json!({ "sessionId": "s1", "name": "Release manager" }),
        )
        .unwrap();
        assert_eq!(made["scope"], "project");
        assert_eq!(made["sessionId"], "s1");
        let id = made["id"].as_str().unwrap().to_string();

        let renamed =
            dispatch(&app, "update_agent", json!({ "agentId": id, "name": "RM" })).unwrap();
        assert_eq!(renamed["name"], "RM");
        let listed = dispatch(&app, "list_agents", json!({})).unwrap();
        assert_eq!(listed.as_array().unwrap().len(), 1);
        assert_eq!(listed[0]["projectName"], "splitkick");

        dispatch(&app, "remove_agent", json!({ "agentId": id })).unwrap();
        assert!(dispatch(&app, "list_agents", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }
}
