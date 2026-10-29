//! Search the session backups that other devices wrote into the shared folder.
//!
//! Unlike the local search this never touches raw run logs: each backed-up
//! session carries a `search-digest.json` with its message text, which is
//! about 1 % of the raw size. Remote hits are info only — the session lives
//! on another device — so a hit carries the device name and the project as
//! this device knows it (mapped by git remote), not a path to open.

use std::collections::HashMap;
use std::path::Path;

use serde_json::Value;
use tauri::AppHandle;

use super::{
    instance_id, list_instances, project_git_remote, BackupProject, InstanceInfo, SearchDigest,
    DIGEST_FILE,
};
use crate::chat::search::{
    build_snippet, SessionSearchHit, SessionSearchOptions, SessionSearchResponse,
    DEFAULT_SEARCH_LIMIT, MIN_QUERY_LEN,
};
use crate::projects::storage::load_projects_data;

/// The local project for a remote one: by git remote, else none.
type LocalProjects = HashMap<String, (String, String)>;

fn local_projects_by_remote(app: &AppHandle) -> LocalProjects {
    let Ok(data) = load_projects_data(app) else {
        return HashMap::new();
    };
    data.projects
        .iter()
        .filter(|p| !p.is_folder)
        .filter_map(|p| Some((project_git_remote(&p.path)?, (p.id.clone(), p.name.clone()))))
        .collect()
}

/// Where a remote worktree sits: project id, project name, worktree name.
fn worktree_places(
    projects: &[BackupProject],
    local: &LocalProjects,
) -> HashMap<String, (String, String, String)> {
    let mut places = HashMap::new();
    for project in projects {
        let (project_id, project_name) = project
            .git_remote
            .as_ref()
            .and_then(|remote| local.get(remote))
            .cloned()
            .unwrap_or_else(|| (project.project_id.clone(), project.name.clone()));
        for worktree in &project.worktrees {
            places.insert(
                worktree.id.clone(),
                (
                    project_id.clone(),
                    project_name.clone(),
                    worktree.name.clone(),
                ),
            );
        }
        // Base sessions are keyed by project, not by a worktree entry.
        places.entry(project.project_id.clone()).or_insert_with(|| {
            (
                project_id.clone(),
                project_name.clone(),
                project.name.clone(),
            )
        });
    }
    places
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// Newest activity of a session, from its metadata.
fn session_updated_at(metadata: &Value) -> u64 {
    let run_times = metadata
        .get("runs")
        .and_then(|runs| runs.as_array())
        .into_iter()
        .flatten()
        .filter_map(|run| {
            run.get("ended_at")
                .and_then(|v| v.as_u64())
                .or_else(|| run.get("started_at").and_then(|v| v.as_u64()))
        });
    run_times
        .max()
        .or_else(|| metadata.get("created_at").and_then(|v| v.as_u64()))
        .unwrap_or(0)
}

/// Search one instance folder. Pure file reads, so tests run it on a fixture.
pub(crate) fn search_instance(
    instance_dir: &Path,
    info: &InstanceInfo,
    local: &LocalProjects,
    query_lower: &str,
    options: &SessionSearchOptions,
) -> Vec<SessionSearchHit> {
    let projects: Vec<BackupProject> =
        read_json(&instance_dir.join("projects.json")).unwrap_or_default();
    let places = worktree_places(&projects, local);
    let Ok(sessions) = std::fs::read_dir(instance_dir.join("sessions").join("data")) else {
        return vec![];
    };

    let mut hits = Vec::new();
    for session in sessions.flatten() {
        let session_dir = session.path();
        let Some(metadata) = read_json::<Value>(&session_dir.join("metadata.json")) else {
            continue;
        };
        if !options.include_archived && metadata.get("archived_at").is_some_and(|v| !v.is_null()) {
            continue;
        }
        let str_field = |key: &str| {
            metadata
                .get(key)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string()
        };
        let session_id = str_field("id");
        let session_name = str_field("name");
        let worktree_id = str_field("worktree_id");
        let (project_id, project_name, worktree_name) = places
            .get(&worktree_id)
            .cloned()
            .unwrap_or_else(|| (String::new(), "Unknown project".to_string(), String::new()));
        if options
            .project_id
            .as_ref()
            .is_some_and(|wanted| wanted != &project_id)
        {
            continue;
        }

        let name_hit = options.match_names && session_name.to_lowercase().contains(query_lower);
        let digest: SearchDigest =
            read_json(&session_dir.join(DIGEST_FILE)).unwrap_or(SearchDigest { messages: vec![] });
        let matching: Vec<_> = digest
            .messages
            .iter()
            .filter(|m| m.content.to_lowercase().contains(query_lower))
            .collect();
        let snippet = matching
            .first()
            .and_then(|first| build_snippet(&first.content, query_lower));
        if snippet.is_none() && !name_hit {
            continue;
        }

        hits.push(SessionSearchHit {
            session_id,
            session_name,
            project_id,
            project_name,
            worktree_id,
            worktree_name,
            worktree_path: String::new(),
            snippet: snippet.clone().unwrap_or_default(),
            message_id: snippet.and(matching.first()).map(|first| first.id.clone()),
            match_count: matching.len(),
            updated_at: session_updated_at(&metadata),
            name_match: name_hit,
            device_name: Some(info.device_name.clone()),
            instance_id: Some(info.instance_id.clone()),
        });
    }
    hits
}

/// Search every other instance in the shared folder. Empty when no folder is
/// set or the user turned remote search off.
pub async fn search_remote_sessions(
    app: AppHandle,
    query: String,
    options: SessionSearchOptions,
) -> Result<SessionSearchResponse, String> {
    let empty = SessionSearchResponse {
        hits: vec![],
        truncated: false,
    };
    let query_lower = query.trim().to_lowercase();
    let limit = options.limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    if query_lower.chars().count() < MIN_QUERY_LEN || limit == 0 {
        return Ok(empty);
    }
    let prefs = crate::load_preferences_sync(&app)?;
    let Some(shared_dir) = prefs
        .session_backup_dir
        .filter(|dir| !dir.trim().is_empty() && prefs.session_backup_search_remote)
    else {
        return Ok(empty);
    };

    tauri::async_runtime::spawn_blocking(move || {
        let started = std::time::Instant::now();
        let own_id = instance_id(&app)?;
        let local = local_projects_by_remote(&app);
        let mut hits: Vec<SessionSearchHit> = list_instances(Path::new(&shared_dir))
            .into_iter()
            .filter(|(_, info)| info.instance_id != own_id)
            .flat_map(|(dir, info)| search_instance(&dir, &info, &local, &query_lower, &options))
            .collect();
        hits.sort_by_key(|hit| std::cmp::Reverse(hit.updated_at));
        let truncated = hits.len() > limit;
        hits.truncate(limit);
        log::info!(
            "[SessionBackup] remote search query={query_lower:?} hits={} in {} ms",
            hits.len(),
            started.elapsed().as_millis()
        );
        Ok(SessionSearchResponse { hits, truncated })
    })
    .await
    .map_err(|e| format!("Remote search failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::types::MessageRole;
    use crate::session_backup::{BackupWorktree, DigestMessage, FORMAT_VERSION};

    fn write_json<T: serde::Serialize>(path: &Path, value: &T) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, serde_json::to_string(value).unwrap()).unwrap();
    }

    fn info() -> InstanceInfo {
        InstanceInfo {
            format_version: FORMAT_VERSION,
            instance_id: "other".to_string(),
            device_name: "mb16".to_string(),
            app_version: "1.2.1".to_string(),
            last_sync_at: 1,
        }
    }

    fn fixture() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write_json(
            &root.join("projects.json"),
            &vec![BackupProject {
                project_id: "remote-project".to_string(),
                name: "jean".to_string(),
                git_remote: Some("github.com/azeitler/splitkick".to_string()),
                worktrees: vec![BackupWorktree {
                    id: "wt-1".to_string(),
                    name: "feature-x".to_string(),
                    branch: "feature-x".to_string(),
                }],
            }],
        );
        let session = |id: &str, name: &str, archived: bool, text: &str| {
            let dir = root.join("sessions").join("data").join(id);
            write_json(
                &dir.join("metadata.json"),
                &serde_json::json!({
                    "id": id, "name": name, "worktree_id": "wt-1",
                    "archived_at": if archived { Some(5) } else { None },
                    "created_at": 1,
                    "runs": [{"run_id": "r", "started_at": 10, "ended_at": if id == "s2" { 30 } else { 20 }}],
                }),
            );
            write_json(
                &dir.join(DIGEST_FILE),
                &SearchDigest {
                    messages: vec![DigestMessage {
                        id: format!("{id}-m1"),
                        role: MessageRole::Assistant,
                        content: text.to_string(),
                    }],
                },
            );
        };
        session(
            "s1",
            "Backup design",
            false,
            "We talked about the sync folder.",
        );
        session(
            "s2",
            "Other",
            false,
            "Nothing about that topic, but sync again.",
        );
        session("s3", "Old", true, "An archived sync note.");
        tmp
    }

    fn local() -> LocalProjects {
        HashMap::from([(
            "github.com/azeitler/splitkick".to_string(),
            ("local-project".to_string(), "Splitkick".to_string()),
        )])
    }

    #[test]
    fn finds_digest_text_and_maps_the_project_by_git_remote() {
        let tmp = fixture();
        let options = SessionSearchOptions::default();

        let mut hits = search_instance(tmp.path(), &info(), &local(), "sync", &options);
        hits.sort_by(|a, b| a.session_id.cmp(&b.session_id));

        assert_eq!(hits.len(), 2, "archived session is skipped");
        assert_eq!(hits[0].session_id, "s1");
        assert_eq!(hits[0].project_id, "local-project");
        assert_eq!(hits[0].project_name, "Splitkick");
        assert_eq!(hits[0].worktree_name, "feature-x");
        assert_eq!(hits[0].device_name.as_deref(), Some("mb16"));
        assert_eq!(hits[0].message_id.as_deref(), Some("s1-m1"));
        assert!(hits[0].snippet.contains("sync folder"));
        assert_eq!(hits[1].updated_at, 30);
    }

    #[test]
    fn keeps_the_remote_project_when_no_local_project_matches() {
        let tmp = fixture();
        let hits = search_instance(
            tmp.path(),
            &info(),
            &HashMap::new(),
            "sync folder",
            &SessionSearchOptions::default(),
        );

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].project_id, "remote-project");
        assert_eq!(hits[0].project_name, "jean");
    }

    #[test]
    fn honours_archived_project_and_name_options() {
        let tmp = fixture();
        let archived = SessionSearchOptions {
            include_archived: true,
            ..Default::default()
        };
        assert_eq!(
            search_instance(tmp.path(), &info(), &local(), "sync", &archived).len(),
            3
        );

        let other_project = SessionSearchOptions {
            project_id: Some("someone-else".to_string()),
            ..Default::default()
        };
        assert!(search_instance(tmp.path(), &info(), &local(), "sync", &other_project).is_empty());

        let names = SessionSearchOptions {
            match_names: true,
            ..Default::default()
        };
        let hits = search_instance(tmp.path(), &info(), &local(), "backup design", &names);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].name_match);
        assert!(hits[0].snippet.is_empty());
    }
}
