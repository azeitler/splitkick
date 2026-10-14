use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use tauri::AppHandle;

use super::types::ProjectsData;

/// Global mutex to prevent concurrent read-modify-write races on projects.json.
/// Multiple threads (e.g., fetch_worktrees_status) can call save_projects_data simultaneously,
/// causing race conditions with the atomic write pattern (temp file + rename).
static PROJECTS_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// Get the path to the projects.json data file
pub fn get_projects_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;

    // Ensure the directory exists
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    Ok(app_data_dir.join("projects.json"))
}

/// Get the base directory for all worktrees (~/jean)
///
/// When WSL mode is enabled, the base dir is inside WSL (e.g., `/home/<user>/jean/`)
/// stored as a Windows UNC path: `\\wsl.localhost\<distro>\home\<user>\jean\`
pub fn get_worktrees_base_dir() -> Result<PathBuf, String> {
    let wsl = crate::platform::get_wsl_config();
    if wsl.enabled {
        // Get the WSL home directory and construct the base dir
        let wsl_home = crate::platform::get_wsl_home_dir(&wsl.distro)?;
        let wsl_jean_dir = format!("{wsl_home}/jean");
        // Convert to Windows UNC path for std::fs operations
        let win_path = crate::platform::wsl_to_win_path(&wsl_jean_dir, &wsl.distro);
        let jean_dir = PathBuf::from(&win_path);

        // Ensure the directory exists (via WSL since UNC mkdir can be unreliable)
        let output = crate::platform::silent_command("wsl.exe")
            .args(["-d", &wsl.distro, "--", "mkdir", "-p", &wsl_jean_dir])
            .output()
            .map_err(|e| format!("Failed to create WSL worktrees base dir: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("Failed to create WSL worktrees base dir: {stderr}"));
        }

        return Ok(jean_dir);
    }

    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    let jean_dir = home_dir.join("jean");

    // Ensure the directory exists
    std::fs::create_dir_all(&jean_dir)
        .map_err(|e| format!("Failed to create jean directory: {e}"))?;

    Ok(jean_dir)
}

/// Get the directory for a specific project's worktrees.
/// When `custom_base_dir` is Some, uses that instead of ~/jean as the base.
/// In both cases, `<project-name>` subdirectory is appended.
pub fn get_project_worktrees_dir(
    project_name: &str,
    custom_base_dir: Option<&str>,
) -> Result<PathBuf, String> {
    let base_dir = match custom_base_dir {
        Some(dir) => PathBuf::from(dir),
        None => get_worktrees_base_dir()?,
    };
    let project_dir = base_dir.join(sanitize_directory_name(project_name));

    // Ensure the directory exists
    std::fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create project worktrees directory: {e}"))?;

    Ok(project_dir)
}

/// Sanitize a string for use as a directory name
pub fn sanitize_directory_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Archive every active worktree whose folder no longer exists on disk, and
/// restore one this function archived once its folder is back (a remounted
/// drive). The archive is marked `auto_archived`, so the retention cleanup
/// never deletes it. Base sessions are skipped: they cannot be archived.
/// Worktrees created in the last 5 minutes are skipped (still being set up).
/// Returns the number of worktrees changed.
fn archive_missing_worktrees(
    worktrees: &mut [crate::projects::types::Worktree],
    now_ts: u64,
) -> usize {
    let five_minutes_ago = now_ts.saturating_sub(300);
    let mut changed = 0;
    for w in worktrees.iter_mut() {
        if w.session_type == crate::projects::types::SessionType::Base {
            continue;
        }
        let exists = std::path::Path::new(&w.path).exists();
        if w.auto_archived {
            if exists {
                log::info!("Restoring worktree '{}' - its folder is back", w.name);
                w.archived_at = None;
                w.auto_archived = false;
                changed += 1;
            }
            continue;
        }
        if w.archived_at.is_some() || exists {
            continue;
        }
        if w.created_at > five_minutes_ago {
            log::trace!(
                "Keeping recently created worktree '{}' - path doesn't exist yet (created {}s ago)",
                w.name,
                now_ts - w.created_at
            );
            continue;
        }
        log::warn!(
            "Archiving worktree '{}' - path does not exist: {}",
            w.name,
            w.path
        );
        w.archived_at = Some(now_ts);
        w.auto_archived = true;
        changed += 1;
    }
    changed
}

/// Load projects data from disk (internal, no locking)
fn load_projects_data_internal(app: &AppHandle) -> Result<ProjectsData, String> {
    log::trace!("Loading projects data from disk");
    let path = get_projects_path(app)?;

    if !path.exists() {
        log::trace!("Projects file not found, returning empty data");
        return Ok(ProjectsData::default());
    }

    let contents = std::fs::read_to_string(&path).map_err(|e| {
        log::error!("Failed to read projects file: {e}");
        format!("Failed to read projects file: {e}")
    })?;

    let mut data: ProjectsData = serde_json::from_str(&contents).map_err(|e| {
        log::error!("Failed to parse projects JSON: {e}");
        format!("Failed to parse projects data: {e}")
    })?;

    for worktree in &mut data.worktrees {
        worktree.normalize_labels();
    }

    // A worktree whose folder is missing is archived, never dropped: dropping
    // the record made its session history an "orphan" that the next startup
    // cleanup deleted. Archiving keeps the history readable and restorable.
    // Skip recently created worktrees (< 5 min) - they may still be initializing in a background thread
    let now_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let changed_count = archive_missing_worktrees(&mut data.worktrees, now_ts);

    // Save if any worktree was archived or restored
    if changed_count > 0 {
        log::trace!("Archived or restored {changed_count} worktree(s) by folder presence");
        save_projects_data_internal(app, &data)?;
    }

    log::trace!(
        "Loaded {} projects and {} worktrees",
        data.projects.len(),
        data.worktrees.len()
    );
    crate::auto_fix::scheduler::refresh_auto_fix_scan_cache(&data.projects);
    Ok(data)
}

/// Load projects data from disk (with locking for thread safety)
pub fn load_projects_data(app: &AppHandle) -> Result<ProjectsData, String> {
    let _lock = PROJECTS_LOCK.lock().unwrap();
    load_projects_data_internal(app)
}

/// Save projects data to disk (internal, no locking - atomic write: temp file + rename)
fn save_projects_data_internal(app: &AppHandle, data: &ProjectsData) -> Result<(), String> {
    log::trace!("Saving projects data to disk");
    let path = get_projects_path(app)?;

    let json_content = serde_json::to_string_pretty(data).map_err(|e| {
        log::error!("Failed to serialize projects data: {e}");
        format!("Failed to serialize projects data: {e}")
    })?;

    // Write to a temporary file first, then rename (atomic operation)
    let temp_path = path.with_extension("tmp");

    std::fs::write(&temp_path, json_content).map_err(|e| {
        log::error!("Failed to write projects file: {e}");
        format!("Failed to write projects file: {e}")
    })?;

    std::fs::rename(&temp_path, &path).map_err(|e| {
        log::error!("Failed to finalize projects file: {e}");
        format!("Failed to finalize projects file: {e}")
    })?;

    log::trace!(
        "Saved {} projects and {} worktrees to {path:?}",
        data.projects.len(),
        data.worktrees.len()
    );
    crate::auto_fix::scheduler::refresh_auto_fix_scan_cache(&data.projects);
    Ok(())
}

/// Save projects data to disk (with locking for thread safety)
pub fn save_projects_data(app: &AppHandle, data: &ProjectsData) -> Result<(), String> {
    let _lock = PROJECTS_LOCK.lock().unwrap();
    save_projects_data_internal(app, data)
}

/// Load, mutate and save projects data under one lock hold.
///
/// Use this instead of `load_projects_data` + `save_projects_data` for a
/// read-modify-write: two separate lock holds let a concurrent writer slip in
/// between and lose its update. `mutate` returns whether it changed anything;
/// the file is only rewritten when it did. Returns that flag.
pub fn update_projects_data<F>(app: &AppHandle, mutate: F) -> Result<bool, String>
where
    F: FnOnce(&mut ProjectsData) -> bool,
{
    let _lock = PROJECTS_LOCK.lock().unwrap();
    let mut data = load_projects_data_internal(app)?;
    let changed = mutate(&mut data);
    if changed {
        save_projects_data_internal(app, &data)?;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::types::Worktree;

    /// Concurrent writers must not drop each other's new worktrees (#34).
    #[test]
    fn concurrent_updates_keep_every_new_worktree() {
        let temp = tempfile::tempdir().unwrap();
        let app = AppHandle::new(temp.path().into(), temp.path().into()).unwrap();
        save_projects_data(&app, &ProjectsData::default()).unwrap();

        let threads: Vec<_> = (0..16)
            .map(|i| {
                let app = app.clone();
                let path = temp.path().join(format!("wt-{i}"));
                std::fs::create_dir_all(&path).unwrap();
                std::thread::spawn(move || {
                    let worktree: crate::projects::types::Worktree =
                        serde_json::from_value(serde_json::json!({
                            "id": format!("wt-{i}"),
                            "project_id": "p1",
                            "name": format!("wt-{i}"),
                            "path": path,
                            "branch": format!("wt-{i}"),
                            "created_at": 0,
                        }))
                        .unwrap();
                    update_projects_data(&app, |data| {
                        data.add_worktree(worktree);
                        true
                    })
                    .unwrap();
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }

        assert_eq!(load_projects_data(&app).unwrap().worktrees.len(), 16);
    }

    /// A worktree whose folder vanished is archived, not dropped, so its
    /// session history is never treated as an orphan and deleted.
    #[test]
    fn missing_worktree_folder_is_archived_not_dropped() {
        let temp = tempfile::tempdir().unwrap();
        let app = AppHandle::new(temp.path().into(), temp.path().into()).unwrap();
        let present = temp.path().join("present");
        std::fs::create_dir_all(&present).unwrap();
        let worktree = |id: &str, path: &std::path::Path, created_at: u64| {
            serde_json::from_value::<crate::projects::types::Worktree>(serde_json::json!({
                "id": id, "project_id": "p1", "name": id, "path": path,
                "branch": id, "created_at": created_at,
            }))
            .unwrap()
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let mut data = ProjectsData::default();
        data.add_worktree(worktree("present", &present, 0));
        data.add_worktree(worktree("gone", &temp.path().join("gone"), 0));
        data.add_worktree(worktree("fresh", &temp.path().join("fresh"), now));
        save_projects_data(&app, &data).unwrap();

        let loaded = load_projects_data(&app).unwrap();
        assert_eq!(loaded.worktrees.len(), 3);
        let by_id = |id: &str| loaded.worktrees.iter().find(|w| w.id == id).unwrap();
        assert!(by_id("present").archived_at.is_none());
        assert!(by_id("gone").archived_at.is_some());
        assert!(by_id("gone").auto_archived);
        assert!(by_id("fresh").archived_at.is_none());
    }

    fn worktree_json(id: &str, path: &std::path::Path, extra: serde_json::Value) -> Worktree {
        let mut value = serde_json::json!({
            "id": id, "project_id": "p1", "name": id, "path": path,
            "branch": id, "created_at": 0,
        });
        value
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        serde_json::from_value(value).unwrap()
    }

    /// Drive unmounted at one start, back at the next: the app restores what
    /// it archived itself, and only that.
    #[test]
    fn an_auto_archived_worktree_is_restored_when_its_folder_returns() {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("on-drive");
        let mut worktrees = vec![
            worktree_json("auto", &folder, serde_json::json!({})),
            worktree_json("user", &folder, serde_json::json!({ "archived_at": 5 })),
        ];

        assert_eq!(archive_missing_worktrees(&mut worktrees, 1_000_000), 1);
        assert!(worktrees[0].auto_archived);
        assert_eq!(worktrees[0].archived_at, Some(1_000_000));
        assert!(
            !worktrees[1].auto_archived,
            "a user archive stays the user's"
        );

        std::fs::create_dir_all(&folder).unwrap();
        assert_eq!(archive_missing_worktrees(&mut worktrees, 1_000_100), 1);
        assert_eq!(worktrees[0].archived_at, None);
        assert!(!worktrees[0].auto_archived);
        // A user archive is never undone by the folder coming back.
        assert_eq!(worktrees[1].archived_at, Some(5));
    }

    #[test]
    fn a_base_session_is_never_auto_archived() {
        let temp = tempfile::tempdir().unwrap();
        let mut worktrees = vec![worktree_json(
            "base",
            &temp.path().join("unmounted-project"),
            serde_json::json!({ "session_type": "base" }),
        )];

        assert_eq!(archive_missing_worktrees(&mut worktrees, 1_000_000), 0);
        assert_eq!(worktrees[0].archived_at, None);
        assert!(!worktrees[0].auto_archived);
    }

    #[test]
    fn the_flag_is_omitted_from_json_when_false() {
        let temp = tempfile::tempdir().unwrap();
        let worktree = worktree_json("w", temp.path(), serde_json::json!({}));
        let json = serde_json::to_string(&worktree).unwrap();
        assert!(!json.contains("auto_archived"), "{json}");
    }

    #[test]
    fn test_sanitize_directory_name() {
        assert_eq!(sanitize_directory_name("my-project"), "my-project");
        assert_eq!(sanitize_directory_name("my project"), "my-project");
        assert_eq!(sanitize_directory_name("my/project"), "my-project");
        assert_eq!(sanitize_directory_name("my_project"), "my_project");
        assert_eq!(sanitize_directory_name("MyProject123"), "MyProject123");
    }
}
