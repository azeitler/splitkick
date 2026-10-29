//! Links to Splitkick objects: `splitkick://session/<id>`,
//! `splitkick://worktree/<id>` and `splitkick://project/<id>` (#44).
//!
//! Ids are only valid in the instance that made them, so a link resolves
//! against the backend of the window that shows it.

use serde::Serialize;
use tauri::AppHandle;

use crate::brand::LINK_SCHEME;

/// The link to a session, worktree or project.
pub fn splitkick_link(kind: &str, id: &str) -> String {
    format!("{LINK_SCHEME}://{kind}/{id}")
}

/// What a link points to, for chat to show its name and open it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkTarget {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub project_id: String,
    pub project_name: String,
    pub worktree_id: Option<String>,
    pub worktree_name: Option<String>,
    pub worktree_path: Option<String>,
    /// The target, or the worktree it lives in, is archived.
    pub archived: bool,
}

/// Resolve a link target. `None` when the id is unknown here (deleted, or made
/// by another instance).
pub fn resolve_splitkick_link(
    app: &AppHandle,
    kind: &str,
    id: &str,
) -> Result<Option<LinkTarget>, String> {
    let data = crate::projects::storage::load_projects_data(app)?;

    let (session, worktree_id) = match kind {
        "session" => match crate::chat::storage::load_metadata(app, id)? {
            Some(metadata) => {
                let worktree_id = metadata.worktree_id.clone();
                (Some(metadata), worktree_id)
            }
            None => return Ok(None),
        },
        "worktree" => (None, id.to_string()),
        "project" => {
            return Ok(data.find_project(id).map(|project| LinkTarget {
                kind: kind.to_string(),
                id: id.to_string(),
                name: project.name.clone(),
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                worktree_id: None,
                worktree_name: None,
                worktree_path: None,
                archived: false,
            }));
        }
        other => return Err(format!("Unknown link kind: {other}")),
    };

    let Some(worktree) = data.find_worktree(&worktree_id) else {
        return Ok(None);
    };
    let Some(project) = data.find_project(&worktree.project_id) else {
        return Ok(None);
    };
    let session_archived = session.as_ref().is_some_and(|s| s.archived_at.is_some());

    Ok(Some(LinkTarget {
        kind: kind.to_string(),
        id: id.to_string(),
        name: session
            .map(|s| s.name)
            .unwrap_or_else(|| worktree.name.clone()),
        project_id: project.id.clone(),
        project_name: project.name.clone(),
        worktree_id: Some(worktree.id.clone()),
        worktree_name: Some(worktree.name.clone()),
        worktree_path: Some(worktree.path.clone()),
        archived: session_archived || worktree.archived_at.is_some(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (tempfile::TempDir, AppHandle) {
        let temp = tempfile::tempdir().unwrap();
        let app = AppHandle::new(temp.path().into(), temp.path().into()).unwrap();
        // A worktree whose folder is missing is archived on load.
        std::fs::create_dir_all(temp.path().join("wt")).unwrap();
        let data: crate::projects::types::ProjectsData = serde_json::from_value(json!({
            "projects": [{
                "id": "p1", "name": "jean", "path": temp.path().join("repo"),
                "default_branch": "main", "added_at": 0, "order": 0,
            }],
            "worktrees": [
                { "id": "wt", "project_id": "p1", "name": "fuzzy-tiger",
                  "path": temp.path().join("wt"), "branch": "feature", "created_at": 0 },
                { "id": "wt-old", "project_id": "p1", "name": "old-fox",
                  "path": temp.path().join("old"), "branch": "old", "created_at": 0,
                  "archived_at": 5 },
            ],
        }))
        .unwrap();
        crate::projects::storage::save_projects_data(&app, &data).unwrap();
        (temp, app)
    }

    fn save_session(app: &AppHandle, id: &str, worktree_id: &str, archived_at: Option<u64>) {
        let mut metadata = crate::chat::types::SessionMetadata::new(
            id.to_string(),
            worktree_id.to_string(),
            format!("session {id}"),
            0,
        );
        metadata.archived_at = archived_at;
        crate::chat::storage::save_metadata(app, &metadata).unwrap();
    }

    #[test]
    fn builds_links_with_the_brand_scheme() {
        assert_eq!(splitkick_link("session", "s1"), "splitkick://session/s1");
        assert_eq!(splitkick_link("project", "p1"), "splitkick://project/p1");
    }

    #[test]
    fn resolves_a_live_session_with_its_worktree_and_project() {
        let (_temp, app) = fixture();
        save_session(&app, "s1", "wt", None);

        let target = resolve_splitkick_link(&app, "session", "s1")
            .unwrap()
            .unwrap();
        assert_eq!(target.name, "session s1");
        assert_eq!(target.project_id, "p1");
        assert_eq!(target.project_name, "jean");
        assert_eq!(target.worktree_id.as_deref(), Some("wt"));
        assert_eq!(target.worktree_name.as_deref(), Some("fuzzy-tiger"));
        assert!(!target.archived);
    }

    #[test]
    fn an_archived_session_or_worktree_marks_the_target_archived() {
        let (_temp, app) = fixture();
        save_session(&app, "s-arch", "wt", Some(9));
        save_session(&app, "s-in-old", "wt-old", None);

        for id in ["s-arch", "s-in-old"] {
            let target = resolve_splitkick_link(&app, "session", id)
                .unwrap()
                .unwrap();
            assert!(target.archived, "{id} should be archived");
        }
        let worktree = resolve_splitkick_link(&app, "worktree", "wt-old")
            .unwrap()
            .unwrap();
        assert!(worktree.archived);
        assert_eq!(worktree.name, "old-fox");
    }

    #[test]
    fn resolves_a_project() {
        let (_temp, app) = fixture();
        let target = resolve_splitkick_link(&app, "project", "p1")
            .unwrap()
            .unwrap();
        assert_eq!(target.name, "jean");
        assert_eq!(target.worktree_id, None);
    }

    #[test]
    fn an_unknown_id_resolves_to_none() {
        let (_temp, app) = fixture();
        for kind in ["session", "worktree", "project"] {
            assert_eq!(resolve_splitkick_link(&app, kind, "nope").unwrap(), None);
        }
        assert!(resolve_splitkick_link(&app, "folder", "p1").is_err());
    }
}
